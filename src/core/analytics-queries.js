/**
 * Analytics queries — scorecards, association rules, and cohort analysis.
 *
 * All functions take an opened analytics store and return structured results.
 * Bayesian posteriors use Beta-binomial with prior Beta(2,2) — weakly
 * informative, symmetric. Surface the 95% lower bound so low-sample checks
 * don't appear artificially confident.
 */

const MIN_COHORT = 10;

/**
 * Beta-binomial posterior: given `successes` out of `total` trials
 * with prior Beta(a, b), return { mean, lower95, upper95 }.
 */
export function betaPosterior(successes, total, a = 2, b = 2) {
  const postA = a + successes;
  const postB = b + (total - successes);
  const mean = postA / (postA + postB);

  const lower = betaQuantile(0.025, postA, postB);
  const upper = betaQuantile(0.975, postA, postB);

  return { mean, lower95: lower, upper95: upper };
}

/**
 * Approximate Beta quantile using the normal approximation to the Beta
 * distribution. Exact quantile computation requires the regularized
 * incomplete beta function; the normal approximation is adequate for
 * dashboard display at the sample sizes we deal with (n > 10).
 */
function betaQuantile(p, a, b) {
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const sd = Math.sqrt(variance);
  const z = normalQuantile(p);
  return Math.max(0, Math.min(1, mean + z * sd));
}

function normalQuantile(p) {
  // Rational approximation (Abramowitz & Stegun 26.2.23)
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const sign = p < 0.5 ? -1 : 1;
  const t = p < 0.5 ? p : 1 - p;
  const x = Math.sqrt(-2 * Math.log(t));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return sign * (x - (c0 + c1 * x + c2 * x * x) / (1 + d1 * x + d2 * x * x + d3 * x * x * x));
}

/**
 * Per-check scorecard: emitted count, resolution rate, mislead rate,
 * adoption rate, average collateral.
 *
 * @param {object} store - Opened analytics store
 * @param {object} [opts]
 * @param {number} [opts.minCohort=10] - Minimum sample size for inclusion
 * @param {string} [opts.sessionId] - Limit to specific session
 * @returns {Array<CheckScorecard>}
 */
export function checkScorecards(store, { minCohort = MIN_COHORT, sessionId } = {}) {
  const sessionFilter = sessionId ? 'AND d.session_id = ?' : '';
  const params = sessionId ? [sessionId] : [];

  const emittedRows = store.query(`
    SELECT d.check_name, COUNT(*) as emitted
    FROM diagnostics d
    WHERE d.suppressed = 0 ${sessionFilter}
    GROUP BY d.check_name
    HAVING COUNT(*) >= ?
  `, [...params, minCohort]);

  const scorecards = [];

  for (const row of emittedRows) {
    const check = row.check_name;
    const emitted = row.emitted;

    const outcomeParams = sessionId ? [check, sessionId] : [check];
    const outcomeFilter = sessionId ? 'AND o.fp IN (SELECT fp FROM diagnostics WHERE session_id = ?)' : '';

    const outcomeRows = store.query(`
      SELECT o.outcome, COUNT(*) as cnt
      FROM outcomes o
      WHERE o.fp IN (SELECT fp FROM diagnostics WHERE check_name = ?) ${outcomeFilter}
      GROUP BY o.outcome
    `, outcomeParams);

    const outcomes = {};
    for (const r of outcomeRows) outcomes[r.outcome] = r.cnt;

    const totalOutcomes = Object.values(outcomes).reduce((s, v) => s + v, 0);
    const resolved = outcomes.resolved ?? 0;
    const regressed = outcomes.regressed ?? 0;

    const resolution = totalOutcomes > 0
      ? betaPosterior(resolved, totalOutcomes)
      : { mean: 0, lower95: 0, upper95: 0 };

    const mislead = totalOutcomes > 0
      ? betaPosterior(regressed, totalOutcomes)
      : { mean: 0, lower95: 0, upper95: 0 };

    const fixRows = store.query(`
      SELECT o.fix_applied, COUNT(*) as cnt
      FROM outcomes o
      WHERE o.fp IN (SELECT fp FROM diagnostics WHERE check_name = ?)
        AND o.fix_applied IS NOT NULL
      GROUP BY o.fix_applied
    `, [check]);

    const fixCounts = {};
    for (const r of fixRows) fixCounts[r.fix_applied] = r.cnt;
    const totalFixes = Object.values(fixCounts).reduce((s, v) => s + v, 0);
    const verbatim = fixCounts.verbatim ?? 0;

    const adoption = totalFixes > 0
      ? betaPosterior(verbatim, totalFixes)
      : { mean: 0, lower95: 0, upper95: 0 };

    const collateralRow = store.queryOne(`
      SELECT AVG(o.collateral_added) as avg_collateral
      FROM outcomes o
      WHERE o.fp IN (SELECT fp FROM diagnostics WHERE check_name = ?)
        AND o.outcome = 'regressed'
    `, [check]);

    scorecards.push({
      check,
      emitted,
      resolution_rate: resolution,
      mislead_rate: mislead,
      adoption_rate: adoption,
      avg_collateral: collateralRow?.avg_collateral ?? 0,
      sample_size: totalOutcomes,
    });
  }

  scorecards.sort((a, b) => b.mislead_rate.mean - a.mislead_rate.mean);
  return scorecards;
}

/**
 * Tool-call sequence bigrams within a session. Computes lift and confidence
 * for each bigram vs baseline frequency.
 *
 * @param {object} store - Opened analytics store
 * @param {object} [opts]
 * @param {string} [opts.sessionId] - Limit to specific session
 * @returns {Array<{bigram: [string,string], count, lift, confidence}>}
 */
export function toolSequenceBigrams(store, { sessionId } = {}) {
  const filter = sessionId ? 'WHERE session_id = ?' : '';
  const params = sessionId ? [sessionId] : [];

  const events = store.query(`
    SELECT kind, payload FROM events
    ${filter}
    ORDER BY ts ASC
  `, params);

  const toolCalls = [];
  for (const e of events) {
    if (e.kind !== 'tool_call') continue;
    try {
      const payload = JSON.parse(e.payload);
      toolCalls.push(payload.tool);
    } catch { continue; }
  }

  if (toolCalls.length < 2) return [];

  const bigramCounts = new Map();
  const unigramCounts = new Map();

  for (let i = 0; i < toolCalls.length; i++) {
    unigramCounts.set(toolCalls[i], (unigramCounts.get(toolCalls[i]) ?? 0) + 1);
    if (i < toolCalls.length - 1) {
      const key = `${toolCalls[i]}→${toolCalls[i + 1]}`;
      bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1);
    }
  }

  const total = toolCalls.length;
  const totalBigrams = toolCalls.length - 1;

  const results = [];
  for (const [key, count] of bigramCounts) {
    const [a, b] = key.split('→');
    const pA = (unigramCounts.get(a) ?? 0) / total;
    const pB = (unigramCounts.get(b) ?? 0) / total;
    const pAB = count / totalBigrams;
    const expected = pA * pB;
    const lift = expected > 0 ? pAB / expected : 0;
    const confidence = (unigramCounts.get(a) ?? 0) > 0 ? count / unigramCounts.get(a) : 0;
    results.push({ bigram: [a, b], count, lift, confidence });
  }

  results.sort((a, b) => b.lift - a.lift);
  return results;
}

/**
 * Session-level summary: key metrics per session for cohort comparison.
 *
 * @param {object} store - Opened analytics store
 * @returns {Array<SessionSummary>}
 */
export function sessionSummaries(store) {
  const sessions = store.query(`
    SELECT session_id,
           MIN(ts) as first_event,
           MAX(ts) as last_event,
           COUNT(*) as event_count
    FROM events
    GROUP BY session_id
    ORDER BY MIN(ts) DESC
  `);

  return sessions.map(s => {
    const toolCalls = store.queryOne(`
      SELECT COUNT(*) as cnt FROM events
      WHERE session_id = ? AND kind = 'tool_call'
    `, [s.session_id]);

    const vcCalls = store.queryOne(`
      SELECT COUNT(*) as cnt FROM events
      WHERE session_id = ? AND kind = 'tool_call'
        AND payload LIKE '%"tool":"validate_code"%'
    `, [s.session_id]);

    const diagCount = store.queryOne(`
      SELECT COUNT(*) as cnt FROM diagnostics
      WHERE session_id = ?
    `, [s.session_id]);

    const outcomeRow = store.queryOne(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome = 'resolved' THEN 1 ELSE 0 END) as resolved,
             SUM(CASE WHEN outcome = 'regressed' THEN 1 ELSE 0 END) as regressed
      FROM outcomes o
      JOIN windows w ON o.window_id = w.id
      WHERE w.session_id = ?
    `, [s.session_id]);

    const usedIntent = store.queryOne(`
      SELECT COUNT(*) as cnt FROM events
      WHERE session_id = ? AND kind = 'tool_call'
        AND payload LIKE '%"tool":"validate_intent"%'
    `, [s.session_id]);

    return {
      session_id: s.session_id,
      first_event: s.first_event,
      last_event: s.last_event,
      event_count: s.event_count,
      tool_calls: toolCalls?.cnt ?? 0,
      validate_code_calls: vcCalls?.cnt ?? 0,
      used_validate_intent: (usedIntent?.cnt ?? 0) > 0,
      diagnostics_emitted: diagCount?.cnt ?? 0,
      outcomes_total: outcomeRow?.total ?? 0,
      outcomes_resolved: outcomeRow?.resolved ?? 0,
      outcomes_regressed: outcomeRow?.regressed ?? 0,
    };
  });
}

/**
 * Identify checks with high mislead rates that warrant hint rewriting.
 *
 * @param {object} store
 * @param {number} [threshold=0.3] - Mislead rate threshold
 * @returns {Array<{check, mislead_rate, recommendation}>}
 */
export function recommendations(store, threshold = 0.3) {
  const cards = checkScorecards(store, { minCohort: Math.max(MIN_COHORT, 5) });
  const recs = [];

  for (const card of cards) {
    if (card.mislead_rate.mean >= threshold) {
      recs.push({
        check: card.check,
        mislead_rate: card.mislead_rate.mean,
        recommendation: `Check \`${card.check}\` misleads ${(card.mislead_rate.mean * 100).toFixed(0)}% of fixes — consider rewriting hint in \`src/data/hints/${card.check}.md\` or its rule in \`src/core/rules/${card.check}.js\``,
      });
    }
  }

  return recs;
}

/**
 * K2: Diagnostic journey — the full lifecycle of a diagnostic template
 * across sessions. Shows when it first appeared, which rules fired,
 * what outcomes occurred, and whether it was eventually resolved.
 *
 * @param {object} store
 * @param {string} templateFp
 * @returns {{ template_fp, check, first_seen, last_seen, session_count, timeline }}
 */
export function diagnosticJourney(store, templateFp) {
  const meta = store.queryOne(`
    SELECT check_name,
           MIN(ts) as first_seen,
           MAX(ts) as last_seen,
           COUNT(DISTINCT session_id) as session_count
    FROM diagnostics
    WHERE template_fp = ? AND suppressed = 0
  `, [templateFp]);

  if (!meta || !meta.check_name) {
    return { template_fp: templateFp, check: null, first_seen: null, last_seen: null, session_count: 0, timeline: [] };
  }

  const timelineRows = store.query(`
    SELECT d.session_id,
           d.ts,
           d.hint_rule_id,
           d.fp,
           o.outcome,
           o.fix_applied
    FROM diagnostics d
    LEFT JOIN outcomes o ON o.fp = d.fp
    WHERE d.template_fp = ? AND d.suppressed = 0
    ORDER BY d.ts ASC
  `, [templateFp]);

  const bySession = new Map();
  for (const row of timelineRows) {
    if (!bySession.has(row.session_id)) {
      bySession.set(row.session_id, {
        session_id: row.session_id,
        ts: row.ts,
        occurrences: 0,
        rule_id: null,
        outcomes: [],
      });
    }
    const entry = bySession.get(row.session_id);
    entry.occurrences++;
    if (row.hint_rule_id && row.hint_rule_id !== 'unknown') entry.rule_id = row.hint_rule_id;
    if (row.outcome) entry.outcomes.push({ outcome: row.outcome, fix_applied: row.fix_applied ?? null });
  }

  const timeline = [...bySession.values()].map(s => {
    const resolved = s.outcomes.filter(o => o.outcome === 'resolved').length;
    const regressed = s.outcomes.filter(o => o.outcome === 'regressed').length;
    const dominant = resolved > 0 ? 'resolved'
      : regressed > 0 ? 'regressed'
      : s.outcomes.length > 0 ? 'unchanged'
      : null;

    return {
      session_id: s.session_id,
      ts: s.ts,
      occurrences: s.occurrences,
      rule_id: s.rule_id,
      dominant_outcome: dominant,
      fix_applied: s.outcomes.find(o => o.fix_applied)?.fix_applied ?? null,
    };
  });

  return {
    template_fp: templateFp,
    check: meta.check_name,
    first_seen: meta.first_seen,
    last_seen: meta.last_seen,
    session_count: meta.session_count,
    timeline,
  };
}

/**
 * K3: Confidence calibration — compare predicted confidence to actual
 * resolution rates. Buckets confidence values and computes actual
 * outcomes for each bucket.
 *
 * @param {object} store
 * @param {object} [opts]
 * @param {number} [opts.buckets=10]
 * @returns {Array<{ bucket, predicted, actual_resolution, sample_size }>}
 */
export function confidenceCalibration(store, { buckets = 10 } = {}) {
  const rows = store.query(`
    SELECT d.confidence, o.outcome
    FROM diagnostics d
    JOIN outcomes o ON o.fp = d.fp
    WHERE d.confidence IS NOT NULL AND d.suppressed = 0
  `);

  if (rows.length === 0) return [];

  const bucketWidth = 1.0 / buckets;
  const bucketData = Array.from({ length: buckets }, (_, i) => ({
    lower: i * bucketWidth,
    upper: (i + 1) * bucketWidth,
    resolved: 0,
    total: 0,
  }));

  for (const row of rows) {
    const idx = Math.min(Math.floor(row.confidence / bucketWidth), buckets - 1);
    bucketData[idx].total++;
    if (row.outcome === 'resolved') bucketData[idx].resolved++;
  }

  return bucketData
    .filter(b => b.total > 0)
    .map(b => ({
      bucket: +((b.lower + b.upper) / 2).toFixed(2),
      predicted: +((b.lower + b.upper) / 2).toFixed(2),
      actual_resolution: +(b.resolved / b.total).toFixed(4),
      sample_size: b.total,
    }));
}

/**
 * K4: Fix adoption funnel — aggregate flow from diagnostic emission
 * through rule matching, fix proposal, adoption, and resolution.
 *
 * @param {object} store
 * @returns {{ emitted, rule_matched, fix_proposed, fix_adopted_verbatim,
 *             fix_adopted_partial, fix_ignored, resolved, regressed, unchanged }}
 */
export function fixAdoptionFunnel(store) {
  const emittedRow = store.queryOne(`
    SELECT COUNT(*) as cnt FROM diagnostics WHERE suppressed = 0
  `);
  const emitted = emittedRow?.cnt ?? 0;

  const ruleMatchedRow = store.queryOne(`
    SELECT COUNT(*) as cnt FROM diagnostics
    WHERE hint_rule_id IS NOT NULL AND hint_rule_id != 'unknown' AND suppressed = 0
  `);
  const rule_matched = ruleMatchedRow?.cnt ?? 0;

  const fixProposedRow = store.queryOne(`
    SELECT COUNT(DISTINCT pf.fp) as cnt
    FROM proposed_fixes pf
    JOIN diagnostics d ON pf.fp = d.fp
    WHERE d.suppressed = 0
  `);
  const fix_proposed = fixProposedRow?.cnt ?? 0;

  const fixAdoptionRows = store.query(`
    SELECT o.fix_applied, COUNT(*) as cnt
    FROM outcomes o
    JOIN diagnostics d ON o.fp = d.fp
    WHERE d.suppressed = 0 AND o.fix_applied IS NOT NULL
    GROUP BY o.fix_applied
  `);
  let fix_adopted_verbatim = 0, fix_adopted_partial = 0, fix_ignored = 0;
  for (const row of fixAdoptionRows) {
    if (row.fix_applied === 'verbatim') fix_adopted_verbatim += row.cnt;
    else if (row.fix_applied === 'partial') fix_adopted_partial += row.cnt;
    else fix_ignored += row.cnt;
  }

  const outcomeRows = store.query(`
    SELECT o.outcome, COUNT(*) as cnt
    FROM outcomes o
    JOIN diagnostics d ON o.fp = d.fp
    WHERE d.suppressed = 0
    GROUP BY o.outcome
  `);
  let resolved = 0, regressed = 0, unchanged = 0;
  for (const row of outcomeRows) {
    if (row.outcome === 'resolved') resolved += row.cnt;
    else if (row.outcome === 'regressed') regressed += row.cnt;
    else if (row.outcome === 'unchanged') unchanged += row.cnt;
  }

  return {
    emitted,
    rule_matched,
    fix_proposed,
    fix_adopted_verbatim,
    fix_adopted_partial,
    fix_ignored,
    resolved,
    regressed,
    unchanged,
  };
}

/**
 * L5: Rule effectiveness broken down by file category (pages, partials,
 * commands, queries, graphql). Used by the heatmap visualization.
 *
 * @param {object} store
 * @returns {Array<{ rule_id, check, category, outcomes, resolved, regressed, effectiveness }>}
 */
export function ruleScoresByCategory(store) {
  const rows = store.query(`
    SELECT d.hint_rule_id as rule_id,
           d.check_name,
           d.file,
           o.outcome
    FROM diagnostics d
    JOIN outcomes o ON o.fp = d.fp
    WHERE d.hint_rule_id IS NOT NULL AND d.hint_rule_id != 'unknown' AND d.suppressed = 0
  `);

  const buckets = new Map();
  for (const row of rows) {
    const cat = classifyFilePath(row.file);
    const key = row.rule_id + '::' + cat;
    if (!buckets.has(key)) {
      buckets.set(key, { rule_id: row.rule_id, check: row.check_name, category: cat, outcomes: 0, resolved: 0, regressed: 0 });
    }
    const b = buckets.get(key);
    b.outcomes++;
    if (row.outcome === 'resolved') b.resolved++;
    else if (row.outcome === 'regressed') b.regressed++;
  }

  return [...buckets.values()].map(b => ({
    ...b,
    effectiveness: b.outcomes > 0
      ? +((b.resolved / b.outcomes) - (b.regressed / b.outcomes)).toFixed(4)
      : 0,
  }));
}

function classifyFilePath(file) {
  if (!file) return 'other';
  if (file.includes('/pages/') || file.includes('/layouts/')) return 'pages';
  if (file.includes('/partials/') || file.includes('/lib/')) return 'partials';
  if (file.includes('/commands/') || file.includes('/mutations/')) return 'commands';
  if (file.includes('/queries/')) return 'queries';
  if (file.endsWith('.graphql') || file.includes('/graphql/')) return 'graphql';
  if (file.includes('/schema/') || file.endsWith('.yml') || file.endsWith('.yaml')) return 'schema';
  return 'other';
}

/**
 * K5: Knowledge gaps — identify checks where rule coverage is low
 * (diagnostics with no matching rule). Helps prioritize rule writing.
 *
 * @param {object} store
 * @returns {Array<{ check, unmatched_count, total_emitted, coverage_rate, avg_resolution_rate }>}
 */
export function knowledgeGaps(store) {
  const checkRows = store.query(`
    SELECT check_name,
           COUNT(*) as total_emitted,
           SUM(CASE WHEN hint_rule_id IS NULL OR hint_rule_id = 'unknown' THEN 1 ELSE 0 END) as unmatched
    FROM diagnostics
    WHERE suppressed = 0
    GROUP BY check_name
    HAVING COUNT(*) >= 3
    ORDER BY total_emitted DESC
  `);

  return checkRows.map(row => {
    const resRow = store.queryOne(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN o.outcome = 'resolved' THEN 1 ELSE 0 END) as resolved
      FROM outcomes o
      JOIN diagnostics d ON o.fp = d.fp
      WHERE d.check_name = ? AND d.suppressed = 0
    `, [row.check_name]);

    const totalOutcomes = resRow?.total ?? 0;
    const resolvedCount = resRow?.resolved ?? 0;

    return {
      check: row.check_name,
      unmatched_count: row.unmatched,
      total_emitted: row.total_emitted,
      coverage_rate: row.total_emitted > 0 ? +((row.total_emitted - row.unmatched) / row.total_emitted).toFixed(4) : 0,
      avg_resolution_rate: totalOutcomes > 0 ? +(resolvedCount / totalOutcomes).toFixed(4) : 0,
    };
  });
}
