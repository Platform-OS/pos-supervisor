/**
 * Case base — closed-loop learning from diagnostic outcomes.
 *
 * F1: Case retrieval — given a (check, template_fp), what fixes have been
 *     applied and what were their outcomes? Returns ranked candidates.
 *
 * F2: Rule scoring — per-rule rolling stats (emitted, adopted, resolved,
 *     regressed). Rules can query this to adjust confidence. Rules below
 *     threshold are flagged for disabling.
 *
 * F3: Suggested-rule synthesis — identify diagnostics with no matching rule
 *     but a clear case-base signal. Output: structured suggestion for human
 *     review (never auto-applied).
 *
 * All functions take an opened analytics store. Case base is a read-only
 * view over the existing tables — no additional schema needed.
 */

import { classifyFileType } from './rules/queries.js';

const MIN_CASES = 3;
const RULE_DISABLE_THRESHOLD = 0.15;
const GUARD_MIN_SAMPLES = 5;

/**
 * F1: Retrieve cases for a diagnostic template.
 *
 * "For diagnostics matching (check, template_fp), what fixes were applied
 * and how did they turn out?"
 *
 * @param {object} store - Opened analytics store
 * @param {string} check - Check name (e.g. 'UnknownFilter')
 * @param {string} templateFp - Template fingerprint
 * @param {object} [opts]
 * @param {number} [opts.minCases=3] - Minimum cases to include a fix
 * @returns {CaseResult}
 */
export function retrieveCases(store, check, templateFp, { minCases = MIN_CASES } = {}) {
  const totalRow = store.queryOne(`
    SELECT COUNT(*) as cnt FROM diagnostics
    WHERE check_name = ? AND template_fp = ? AND suppressed = 0
  `, [check, templateFp]);

  const total = totalRow?.cnt ?? 0;
  if (total === 0) return { check, template_fp: templateFp, total: 0, cases: [] };

  const outcomeRows = store.query(`
    SELECT o.outcome, o.fix_applied, o.collateral_added, COUNT(*) as cnt
    FROM outcomes o
    JOIN diagnostics d ON o.fp = d.fp
    WHERE d.check_name = ? AND d.template_fp = ?
    GROUP BY o.outcome, o.fix_applied
    ORDER BY cnt DESC
  `, [check, templateFp]);

  const byFix = new Map();
  for (const row of outcomeRows) {
    const key = row.fix_applied ?? '__none__';
    if (!byFix.has(key)) {
      byFix.set(key, { fix_applied: row.fix_applied, resolved: 0, regressed: 0, unchanged: 0, moved: 0, total: 0, collateral: 0 });
    }
    const entry = byFix.get(key);
    entry[row.outcome] = (entry[row.outcome] ?? 0) + row.cnt;
    entry.total += row.cnt;
    if (row.outcome === 'regressed') entry.collateral += row.collateral_added * row.cnt;
  }

  const cases = [...byFix.values()]
    .filter(c => c.total >= minCases)
    .map(c => ({
      fix_applied: c.fix_applied,
      total: c.total,
      resolved: c.resolved,
      regressed: c.regressed,
      resolution_rate: c.total > 0 ? c.resolved / c.total : 0,
      regression_rate: c.total > 0 ? c.regressed / c.total : 0,
      avg_collateral: c.regressed > 0 ? c.collateral / c.regressed : 0,
    }))
    .sort((a, b) => b.resolution_rate - a.resolution_rate || a.regression_rate - b.regression_rate);

  return { check, template_fp: templateFp, total, cases };
}

/**
 * F1 (batch): Retrieve top cases for all templates of a given check.
 */
export function retrieveCasesByCheck(store, check, { minCases = MIN_CASES, limit = 20 } = {}) {
  const templates = store.query(`
    SELECT DISTINCT template_fp FROM diagnostics
    WHERE check_name = ? AND template_fp IS NOT NULL AND suppressed = 0
  `, [check]);

  const results = [];
  for (const { template_fp } of templates) {
    const caseResult = retrieveCases(store, check, template_fp, { minCases });
    if (caseResult.cases.length > 0) results.push(caseResult);
  }

  results.sort((a, b) => b.total - a.total);
  return results.slice(0, limit);
}

/**
 * F2: Per-rule rolling stats.
 *
 * For each rule_id, compute (emitted, adopted, resolved, regressed) from
 * the diagnostics + outcomes tables.
 *
 * @param {object} store
 * @param {object} [opts]
 * @param {number} [opts.minEmitted=5] - Minimum emissions to include
 * @returns {Array<RuleScore>}
 */
export function ruleScores(store, { minEmitted = 5 } = {}) {
  const ruleRows = store.query(`
    SELECT d.hint_rule_id as rule_id,
           COUNT(DISTINCT d.fp) as emitted,
           d.check_name as check_name
    FROM diagnostics d
    WHERE d.hint_rule_id IS NOT NULL AND d.hint_rule_id != 'unknown' AND d.suppressed = 0
    GROUP BY d.hint_rule_id
    HAVING COUNT(DISTINCT d.fp) >= ?
  `, [minEmitted]);

  const scores = [];

  for (const row of ruleRows) {
    const outcomeRows = store.query(`
      SELECT o.outcome, o.fix_applied, COUNT(*) as cnt
      FROM outcomes o
      JOIN diagnostics d ON o.fp = d.fp
      WHERE d.hint_rule_id = ?
      GROUP BY o.outcome, o.fix_applied
    `, [row.rule_id]);

    let resolved = 0, regressed = 0, unchanged = 0, moved = 0;
    let adopted = 0, totalOutcomes = 0;

    for (const o of outcomeRows) {
      totalOutcomes += o.cnt;
      if (o.outcome === 'resolved') resolved += o.cnt;
      else if (o.outcome === 'regressed') regressed += o.cnt;
      else if (o.outcome === 'unchanged') unchanged += o.cnt;
      else if (o.outcome === 'moved') moved += o.cnt;
      if (o.fix_applied === 'verbatim') adopted += o.cnt;
    }

    const resolutionRate = totalOutcomes > 0 ? resolved / totalOutcomes : 0;
    const regressionRate = totalOutcomes > 0 ? regressed / totalOutcomes : 0;
    const adoptionRate = totalOutcomes > 0 ? adopted / totalOutcomes : 0;
    const effectivenessScore = resolutionRate - regressionRate;

    scores.push({
      rule_id: row.rule_id,
      check: row.check_name,
      emitted: row.emitted,
      total_outcomes: totalOutcomes,
      resolved,
      regressed,
      unchanged,
      moved,
      adopted,
      resolution_rate: resolutionRate,
      regression_rate: regressionRate,
      adoption_rate: adoptionRate,
      effectiveness: effectivenessScore,
      disabled: effectivenessScore < RULE_DISABLE_THRESHOLD && totalOutcomes >= 10,
    });
  }

  scores.sort((a, b) => a.effectiveness - b.effectiveness);
  return scores;
}

/**
 * F2: Compute confidence adjustment for a specific rule given a template_fp.
 *
 * Rules call this during `apply()` to boost or reduce their confidence
 * based on historical outcomes.
 *
 * @param {object} store
 * @param {string} ruleId
 * @param {string} templateFp
 * @returns {{ adjustment: number, reason: string } | null}
 */
export function scoreRule(store, ruleId, templateFp) {
  const stats = store.queryOne(`
    SELECT COUNT(DISTINCT d.fp) as emitted
    FROM diagnostics d
    WHERE d.hint_rule_id = ? AND d.template_fp = ? AND d.suppressed = 0
  `, [ruleId, templateFp]);

  if (!stats || stats.emitted < MIN_CASES) return null;

  const outcomes = store.query(`
    SELECT o.outcome, COUNT(*) as cnt
    FROM outcomes o
    JOIN diagnostics d ON o.fp = d.fp
    WHERE d.hint_rule_id = ? AND d.template_fp = ?
    GROUP BY o.outcome
  `, [ruleId, templateFp]);

  let resolved = 0, regressed = 0, total = 0;
  for (const o of outcomes) {
    total += o.cnt;
    if (o.outcome === 'resolved') resolved += o.cnt;
    if (o.outcome === 'regressed') regressed += o.cnt;
  }

  if (total === 0) return null;

  const resRate = resolved / total;
  const regRate = regressed / total;

  if (resRate >= 0.7) {
    return { adjustment: +0.1, reason: `${(resRate * 100).toFixed(0)}% resolution rate for this template` };
  }
  if (regRate >= 0.3) {
    return { adjustment: -0.2, reason: `${(regRate * 100).toFixed(0)}% regression rate — hint may be harmful` };
  }
  return { adjustment: 0, reason: 'insufficient signal' };
}

/**
 * F3: Identify diagnostics with no matching rule but a clear case-base
 * signal (high resolution rate on some fix pattern). These are candidates
 * for new rules.
 *
 * @param {object} store
 * @param {Set<string>} [existingRuleChecks] - Checks that already have rules
 * @param {object} [opts]
 * @param {number} [opts.minCases=5] - Minimum outcome count
 * @param {number} [opts.minResolutionRate=0.6] - Minimum resolution rate
 * @returns {Array<SuggestedRule>}
 */
export function suggestedRules(store, existingRuleChecks = new Set(), { minCases = 5, minResolutionRate = 0.6 } = {}) {
  const candidates = store.query(`
    SELECT d.check_name, d.template_fp,
           COUNT(DISTINCT d.fp) as emitted,
           GROUP_CONCAT(DISTINCT d.hint_rule_id) as rule_ids
    FROM diagnostics d
    WHERE d.suppressed = 0 AND d.template_fp IS NOT NULL
    GROUP BY d.check_name, d.template_fp
    HAVING COUNT(DISTINCT d.fp) >= ?
  `, [minCases]);

  const suggestions = [];

  for (const c of candidates) {
    const hasRule = c.rule_ids && c.rule_ids !== 'unknown' && c.rule_ids.split(',').some(r => r !== 'unknown');
    if (hasRule) continue;

    const outcomeRows = store.query(`
      SELECT o.outcome, o.fix_applied, COUNT(*) as cnt
      FROM outcomes o
      JOIN diagnostics d ON o.fp = d.fp
      WHERE d.check_name = ? AND d.template_fp = ?
      GROUP BY o.outcome, o.fix_applied
    `, [c.check_name, c.template_fp]);

    let resolved = 0, total = 0;
    let bestFix = null;
    let bestFixResolved = 0;

    for (const o of outcomeRows) {
      total += o.cnt;
      if (o.outcome === 'resolved') {
        resolved += o.cnt;
        if (o.fix_applied && o.cnt > bestFixResolved) {
          bestFix = o.fix_applied;
          bestFixResolved = o.cnt;
        }
      }
    }

    if (total < minCases) continue;
    const resRate = resolved / total;
    if (resRate < minResolutionRate) continue;

    const sampleDiag = store.queryOne(`
      SELECT file, check_name, fp FROM diagnostics
      WHERE check_name = ? AND template_fp = ? AND suppressed = 0
      ORDER BY ts DESC LIMIT 1
    `, [c.check_name, c.template_fp]);

    suggestions.push({
      check: c.check_name,
      template_fp: c.template_fp,
      emitted: c.emitted,
      total_outcomes: total,
      resolved,
      resolution_rate: resRate,
      best_fix: bestFix,
      best_fix_count: bestFixResolved,
      sample_file: sampleDiag?.file ?? null,
      suggestion: `Check \`${c.check_name}\` (template ${c.template_fp.slice(0, 8)}) has ${(resRate * 100).toFixed(0)}% resolution rate across ${total} outcomes but no rule. Consider adding a rule in \`src/core/rules/${c.check_name}.js\`.`,
    });
  }

  suggestions.sort((a, b) => b.resolution_rate - a.resolution_rate || b.emitted - a.emitted);
  return suggestions;
}

/**
 * F4: Synthesize guard predicates from historical diagnostic data.
 *
 * Analyzes patterns in file paths and diagnostic params to produce a `when`
 * object compatible with promoted-rules JSON format (see compileWhen()).
 *
 * Thresholds:
 *   param_equals   — ≥90% of values identical
 *   param_startsWith — ≥80% share a common prefix (len ≥ 2)
 *   param_contains — ≥80% contain a common substring (len ≥ 3)
 *   file_type      — ≥80% share the same classified type
 *
 * @param {object} store - Analytics store
 * @param {string} check - Check name
 * @param {string} templateFp - Template fingerprint
 * @param {object} [opts]
 * @param {number} [opts.minSamples=5] - Minimum samples to infer a guard
 * @returns {object} JSON `when` object for promoted rules
 */
export function synthesizeGuardPredicate(store, check, templateFp, { minSamples = GUARD_MIN_SAMPLES } = {}) {
  const when = {};

  const fileRows = store.query(`
    SELECT DISTINCT file FROM diagnostics
    WHERE check_name = ? AND template_fp = ? AND suppressed = 0
  `, [check, templateFp]);

  if (fileRows.length >= minSamples) {
    const types = fileRows.map(r => classifyFileType(r.file));
    const dominant = dominantValue(types);
    if (dominant && dominant.ratio >= 0.8 && dominant.value !== 'unknown') {
      when.file_type = dominant.value;
    }
  }

  const eventRows = store.query(`
    SELECT payload FROM events
    WHERE kind = 'validator_emit'
    AND json_extract(payload, '$.check') = ?
    AND json_extract(payload, '$.template_fp') = ?
  `, [check, templateFp]);

  const paramSamples = [];
  for (const row of eventRows) {
    try {
      const p = JSON.parse(row.payload);
      if (p.params && typeof p.params === 'object' && Object.keys(p.params).length > 0) {
        paramSamples.push(p.params);
      }
    } catch { /* skip malformed */ }
  }

  if (paramSamples.length >= minSamples) {
    const keys = new Set();
    for (const s of paramSamples) {
      for (const k of Object.keys(s)) keys.add(k);
    }

    for (const key of keys) {
      const values = paramSamples
        .map(s => s[key])
        .filter(v => typeof v === 'string' && v.length > 0);

      if (values.length < minSamples) continue;

      const top = dominantValue(values);
      if (top && top.ratio >= 0.9) {
        if (!when.param_equals) when.param_equals = {};
        when.param_equals[key] = top.value;
        continue;
      }

      const prefix = findDominantPrefix(values, 2);
      if (prefix) {
        if (!when.param_startsWith) when.param_startsWith = {};
        when.param_startsWith[key] = prefix;
        continue;
      }

      const substr = findDominantSubstring(values, 3);
      if (substr) {
        if (!when.param_contains) when.param_contains = {};
        when.param_contains[key] = substr;
      }
    }
  }

  return when;
}

/**
 * F3: Generate a rule template for a suggested rule.
 * Produces a JS code template that can be saved as a draft for human review.
 *
 * @param {object} suggestion - From suggestedRules()
 * @param {object} [guards={}] - Synthesized when clause from synthesizeGuardPredicate()
 */
export function generateRuleTemplate(suggestion, guards = {}) {
  const { check, template_fp } = suggestion;
  const safeCheck = check.replace(/[^a-zA-Z0-9_]/g, '_');
  const shortFp = template_fp.slice(0, 8);

  const whenBody = Object.keys(guards).length > 0
    ? renderGuardsAsJs(guards)
    : '    // TODO: Add guard predicate based on diagnostic params\n    return true;';

  return `// Suggested rule — generated from case-base analysis
// Template fingerprint: ${template_fp}
// Resolution rate: ${(suggestion.resolution_rate * 100).toFixed(0)}% across ${suggestion.total_outcomes} outcomes
// Sample file: ${suggestion.sample_file ?? 'unknown'}
//
// Review this rule before merging. Never auto-merge suggested rules.

{
  id: '${safeCheck}.case_${shortFp}',
  check: '${check}',
  priority: 50,
  when: (diag) => {
${whenBody}
  },
  apply: (diag) => {
    return {
      rule_id: '${safeCheck}.case_${shortFp}',
      hint_md: 'TODO: Write hint based on case-base patterns',
      fixes: [],
      confidence: ${suggestion.resolution_rate.toFixed(2)},
    };
  },
}`;
}

/**
 * J5: Resolve probation for promoted rules.
 *
 * For each rule on probation, check if it has accumulated enough outcomes
 * to make a determination. Compares the promoted rule's effectiveness to
 * the disable threshold.
 *
 * @param {object} store - Analytics store
 * @param {object} [opts]
 * @param {number} [opts.minOutcomes=20] - Minimum outcomes before resolving
 * @returns {Array<{ rule_id, resolution, effectiveness, outcomes }>}
 */
export function resolveProbation(store, { minOutcomes = 20 } = {}) {
  const onProbation = store.getPromotionsOnProbation();
  const resolutions = [];

  for (const promo of onProbation) {
    const outcomeRows = store.query(`
      SELECT o.outcome, COUNT(*) as cnt
      FROM outcomes o
      JOIN diagnostics d ON o.fp = d.fp
      WHERE d.hint_rule_id = ?
      GROUP BY o.outcome
    `, [promo.rule_id]);

    let resolved = 0, regressed = 0, total = 0;
    for (const o of outcomeRows) {
      total += o.cnt;
      if (o.outcome === 'resolved') resolved += o.cnt;
      if (o.outcome === 'regressed') regressed += o.cnt;
    }

    if (total < minOutcomes) continue;

    const effectiveness = total > 0 ? (resolved - regressed) / total : 0;
    let resolution;

    if (effectiveness < RULE_DISABLE_THRESHOLD) {
      resolution = 'disabled';
    } else {
      resolution = 'kept';
    }

    store.resolvePromotion(promo.rule_id, resolution);
    resolutions.push({
      rule_id: promo.rule_id,
      resolution,
      effectiveness,
      outcomes: total,
    });
  }

  return resolutions;
}

// ── Guard synthesis helpers ────────────────────────────────────────────────

function dominantValue(arr) {
  const freq = new Map();
  for (const v of arr) freq.set(v, (freq.get(v) || 0) + 1);
  let best = null;
  for (const [value, count] of freq) {
    if (!best || count > best.count) best = { value, count };
  }
  return best ? { value: best.value, count: best.count, ratio: best.count / arr.length } : null;
}

function findDominantPrefix(values, minLen) {
  if (values.length === 0) return null;
  const threshold = values.length * 0.8;
  let best = null;
  for (const val of values) {
    for (let len = val.length; len >= minLen; len--) {
      const prefix = val.slice(0, len);
      if (best && prefix.length <= best.length) break;
      const matchCount = values.filter(v => v.startsWith(prefix)).length;
      if (matchCount >= threshold) {
        best = prefix;
        break;
      }
    }
  }
  return best;
}

function findDominantSubstring(values, minLen) {
  if (values.length === 0) return null;
  const shortest = values.reduce((a, b) => a.length <= b.length ? a : b);
  let best = null;
  for (let len = shortest.length; len >= minLen; len--) {
    for (let start = 0; start <= shortest.length - len; start++) {
      const candidate = shortest.slice(start, start + len);
      const matchCount = values.filter(v => v.includes(candidate)).length;
      if (matchCount / values.length >= 0.8) {
        if (!best || candidate.length > best.length) best = candidate;
        return best;
      }
    }
  }
  return best;
}

const FILE_TYPE_PATH_HINT = {
  page: '/pages/',
  partial: '/partials/',
  layout: '/layouts/',
  command: '/commands/',
  query: '/queries/',
  graphql: '/graphql/',
  schema: '/schema/',
  module: 'modules/',
};

function renderGuardsAsJs(guards) {
  const conditions = [];

  if (guards.param_equals) {
    for (const [k, v] of Object.entries(guards.param_equals)) {
      conditions.push(`diag.params?.${k} === ${JSON.stringify(v)}`);
    }
  }

  if (guards.param_startsWith) {
    for (const [k, v] of Object.entries(guards.param_startsWith)) {
      conditions.push(`diag.params?.${k}?.startsWith(${JSON.stringify(v)})`);
    }
  }

  if (guards.param_contains) {
    for (const [k, v] of Object.entries(guards.param_contains)) {
      conditions.push(`diag.params?.${k}?.includes(${JSON.stringify(v)})`);
    }
  }

  if (guards.file_type) {
    const hint = FILE_TYPE_PATH_HINT[guards.file_type];
    if (hint) {
      conditions.push(`diag.file?.includes(${JSON.stringify(hint)})`);
    }
  }

  if (conditions.length === 0) {
    return '    // No guards synthesized — review and narrow this rule\n    return true;';
  }

  if (conditions.length === 1) {
    return `    return ${conditions[0]};`;
  }

  return `    return ${conditions.join(' &&\n           ')};`;
}
