/**
 * Analytics labels — single source of truth for the GOOD / OK / LOW / HARMFUL,
 * AT RISK / UNMATCHED, and INSUFFICIENT_DATA presentation-layer labels.
 *
 * Pure functions, intentionally side-effect-free. The HTTP layer attaches
 * `.label` to each scorecard / rule-performance row before serialising; the
 * dashboard browser code and Markdown report consume that field directly so
 * label logic isn't duplicated (or drifted) between server and client.
 *
 * INSUFFICIENT_DATA gate (`LABEL_MIN_OUTCOMES`) is the load-bearing change.
 * Labels computed from a sample of one — `AT RISK -100%` on a single
 * regression — are statistically meaningless and previously caused operators
 * to chase ghosts of already-fixed rules. Below the threshold we return a
 * neutral label that says "we don't know yet" instead of a confident wrong
 * answer.
 *
 * The threshold is conservative on purpose: 5 outcomes lets a Beta(2,2)
 * posterior collapse from "wide ribbon" to a meaningful interval. Engine-side
 * decisions (auto-disable in case-base.ruleScores) use a stricter gate of 10
 * because promotion/demotion is more consequential than display.
 */

export const LABEL_MIN_OUTCOMES = 5;

/**
 * Normalise a Beta-posterior object or bare number to a scalar in [0, 1].
 * Mirrors the dashboard `rateVal()` helper exactly so the server emits the
 * same labels the browser would have computed inline.
 */
function asRate(r) {
  if (r && typeof r === 'object' && typeof r.mean === 'number') return r.mean;
  if (typeof r === 'number') return r;
  return 0;
}

/**
 * Per-check scorecard label.
 *
 * Accepts a row from `checkScorecards()` carrying `.resolution_rate`,
 * `.mislead_rate`, and either `.sample_size` (preferred) or `.total_outcomes`.
 * Each rate may be a Beta posterior `{ mean, lower95, upper95 }` or a number.
 *
 * Returns one of:
 *   - INSUFFICIENT_DATA — fewer than LABEL_MIN_OUTCOMES outcomes
 *   - GOOD             — effectiveness > 0.5
 *   - OK               — 0.15 < effectiveness <= 0.5
 *   - LOW              — 0    <= effectiveness <= 0.15
 *   - HARMFUL          — effectiveness < 0
 */
export function checkLabel(card) {
  if (!card || typeof card !== 'object') return 'INSUFFICIENT_DATA';
  const sampleSize = Number(card.sample_size ?? card.total_outcomes ?? 0);
  if (!Number.isFinite(sampleSize) || sampleSize < LABEL_MIN_OUTCOMES) {
    return 'INSUFFICIENT_DATA';
  }
  const effectiveness = asRate(card.resolution_rate) - asRate(card.mislead_rate);
  if (effectiveness > 0.5)   return 'GOOD';
  if (effectiveness > 0.15)  return 'OK';
  if (effectiveness >= 0)    return 'LOW';
  return 'HARMFUL';
}

/**
 * Per-rule_id performance label.
 *
 * Accepts a row from `rulePerformance()` / `ruleScores()` carrying
 * `.unmatched`, `.effectiveness`, and `.total_outcomes`.
 *
 * Precedence:
 *   1. UNMATCHED       — `.unmatched === true` always wins. Coverage gap is
 *                        actionable regardless of sample size; one emit on a
 *                        rule-less check still tells the operator a rule needs
 *                        writing.
 *   2. INSUFFICIENT_DATA — `total_outcomes < LABEL_MIN_OUTCOMES`. We don't
 *                          know enough to call the rule risky.
 *   3. AT RISK         — effectiveness < 0.15. Real signal, real concern.
 *   4. OK              — everything else.
 *
 * Note: `effectiveness` here is `resolution_rate - regression_rate`, not the
 * 0..1 percentage the case-base disable-gate uses. A negative number is
 * possible (rule causes more regressions than it resolves).
 */
export function ruleLabel(rule) {
  if (!rule || typeof rule !== 'object') return 'INSUFFICIENT_DATA';
  if (rule.unmatched) return 'UNMATCHED';
  const totalOutcomes = Number(rule.total_outcomes ?? 0);
  if (!Number.isFinite(totalOutcomes) || totalOutcomes < LABEL_MIN_OUTCOMES) {
    return 'INSUFFICIENT_DATA';
  }
  const effectiveness = Number(rule.effectiveness ?? 0);
  if (!Number.isFinite(effectiveness)) return 'INSUFFICIENT_DATA';
  if (effectiveness < 0.15) return 'AT RISK';
  return 'OK';
}

/**
 * Filter scorecards down to the rows that warrant a HARMFUL headline in the
 * Markdown report's executive summary. Honours the same sample-size gate so
 * we don't trumpet "HARMFUL" off a single regression — which is exactly the
 * stale-data trap that motivated this whole module.
 */
export function harmfulSummary(scorecards) {
  if (!Array.isArray(scorecards)) return [];
  return scorecards.filter(c => checkLabel(c) === 'HARMFUL');
}

/**
 * Attach a `.label` field to every row in a scorecard array. Returns a NEW
 * array; rows are shallow-copied so callers can't accidentally mutate the
 * underlying analytics-queries result. HTTP handlers wrap the array with this
 * before sending so the dashboard receives labelled rows it can render
 * without re-computing.
 */
export function withCheckLabels(scorecards) {
  if (!Array.isArray(scorecards)) return [];
  return scorecards.map(card => ({ ...card, label: checkLabel(card) }));
}

/**
 * Attach a `.label` field to every row in a rule-performance / rule-score
 * array. See `withCheckLabels`.
 */
export function withRuleLabels(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map(rule => ({ ...rule, label: ruleLabel(rule) }));
}
