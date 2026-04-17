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
