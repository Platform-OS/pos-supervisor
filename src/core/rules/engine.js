/**
 * Rule engine — pure functions (facts, diag) → HintResult | null.
 *
 * Each check has 1..N rules in priority order. Default: first match wins.
 * Rules are auto-loaded from per-check modules in this directory.
 *
 * A rule object:
 *   {
 *     id:    'MissingPartial.suggest_nearest',
 *     check: 'MissingPartial',
 *     priority: 10,                    // lower = higher priority
 *     when:  (diag, facts) => boolean, // guard predicate
 *     apply: (diag, facts) => HintResult | null,
 *   }
 *
 * HintResult:
 *   {
 *     rule_id: string,
 *     hint_md: string,                 // markdown hint for the agent
 *     fixes: ProposedFix[],            // optional fix proposals
 *     confidence: number,              // 0..1
 *     see_also?: { tool, args, reason },
 *     case_base_signal?: { sample_size, resolution_rate, regression_rate?, hint },
 *   }
 */

import { scoreRule } from '../case-base.js';
import { isAdaptive } from '../engine-mode.js';

const _registry = new Map();
const _disabledRules = new Set();
// Operator overrides (plan I4). force_enable beats _disabledRules; force_disable
// wins over registration entirely. Both sets are the authoritative in-memory
// view — persistence is owned by rule-overrides.js and loaded/synced via
// server.js. Empty sets mean "no overrides in effect", which is the default.
const _forceEnabled = new Set();
const _forceDisabled = new Set();
// Per-rule metadata for dashboard display: why a rule is in _disabledRules.
// Populated by syncDisabledRules via setDisabledRuleDetails. Keyed by rule_id.
let _disabledRuleDetails = new Map();

export function registerRule(rule) {
  if (!rule?.id || !rule?.check || !rule?.when || !rule?.apply) {
    throw new Error(`registerRule: rule must have id, check, when, apply`);
  }
  const entry = {
    id: rule.id,
    check: rule.check,
    priority: rule.priority ?? 100,
    when: rule.when,
    apply: rule.apply,
  };
  if (!_registry.has(rule.check)) _registry.set(rule.check, []);
  _registry.get(rule.check).push(entry);
  _registry.get(rule.check).sort((a, b) => a.priority - b.priority);
}

export function registerRules(rules) {
  for (const rule of rules) registerRule(rule);
}

/**
 * Decide whether a rule is active for a given call. Order:
 *   1. force_disable  → skip always (operator kill-switch).
 *   2. force_enable   → run even if case-base disabled it.
 *   3. _disabledRules → skip.
 *   4. otherwise      → run.
 */
function ruleIsActive(ruleId) {
  if (_forceDisabled.has(ruleId)) return false;
  if (_forceEnabled.has(ruleId))  return true;
  return !_disabledRules.has(ruleId);
}

export function runRules(diag, facts, { multiMatch = false } = {}) {
  const rules = _registry.get(diag.check);
  if (!rules || rules.length === 0) return null;

  if (multiMatch) {
    const results = [];
    for (const rule of rules) {
      if (!ruleIsActive(rule.id)) continue;
      try {
        if (rule.when(diag, facts)) {
          const result = rule.apply(diag, facts);
          if (result) {
            applyCaseBaseScoring(result, diag, facts);
            results.push(result);
          }
        }
      } catch { /* rule failure is non-fatal */ }
    }
    return results.length > 0 ? results : null;
  }

  for (const rule of rules) {
    if (!ruleIsActive(rule.id)) continue;
    try {
      if (rule.when(diag, facts)) {
        const result = rule.apply(diag, facts);
        if (result) {
          applyCaseBaseScoring(result, diag, facts);
          return result;
        }
      }
    } catch { /* rule failure is non-fatal */ }
  }
  return null;
}

function applyCaseBaseScoring(result, diag, facts) {
  if (!isAdaptive()) return;
  if (!facts.analyticsStore || !result.rule_id) return;
  try {
    const templateFp = diag.template_fp ?? null;
    if (!templateFp) return;

    const score = scoreRule(facts.analyticsStore, result.rule_id, templateFp);
    if (!score) return;

    if (score.adjustment !== 0 && result.confidence != null) {
      result.confidence = Math.max(0, Math.min(1, result.confidence + score.adjustment));
    }
    result.case_base_signal = {
      adjustment: score.adjustment,
      reason: score.reason,
    };
  } catch { /* case-base scoring failure is non-fatal */ }
}

export function hasRules(check) {
  const rules = _registry.get(check);
  return !!(rules && rules.length > 0);
}

export function getRulesForCheck(check) {
  return [...(_registry.get(check) ?? [])];
}

export function getAllChecksWithRules() {
  return [..._registry.keys()];
}

/**
 * Reset the rule engine to a known-clean state.
 *
 * Clears the rule registry AND every flavour of disabled / override set the
 * engine carries. The previous behaviour cleared only `_registry`, which
 * leaked override state across consecutive test files: a force-disable set
 * by test file A would silently skip rules in file B even after B's
 * beforeEach re-registered them. The leak surfaced as priority-5 rules
 * never firing and a priority-1000 catch-all "winning" because the higher
 * rule was being filtered by `ruleIsActive`.
 *
 * If the historical "registry-only" semantics are ever needed back, prefer
 * a separate helper rather than a flag — splitting clear vs. reset reads
 * better at every call site.
 */
export function clearRules() {
  _registry.clear();
  _disabledRules.clear();
  _disabledRuleDetails = new Map();
  _forceEnabled.clear();
  _forceDisabled.clear();
}

export function ruleCount() {
  let n = 0;
  for (const rules of _registry.values()) n += rules.length;
  return n;
}

export function updateDisabledRules(ruleIds) {
  _disabledRules.clear();
  if (ruleIds) {
    for (const id of ruleIds) _disabledRules.add(id);
  }
}

/**
 * Replace metadata (score, outcome counts, reason) for the disabled set.
 * Consumed by the dashboard. `details` is an array of `{ rule_id, score,
 * ... }` produced by `ruleScores()`; the engine stores it as-is without
 * re-interpreting the fields so the shape can evolve without a schema bump.
 */
export function setDisabledRuleDetails(details) {
  _disabledRuleDetails = new Map();
  if (!Array.isArray(details)) return;
  for (const row of details) {
    if (row?.rule_id) _disabledRuleDetails.set(row.rule_id, row);
  }
}

export function getDisabledRules() {
  return new Set(_disabledRules);
}

/**
 * Full per-rule disabled-state summary. Returns one entry per currently
 * disabled rule_id with whatever metadata setDisabledRuleDetails was given.
 * `force_enabled: true` means the operator has re-enabled it; it still
 * appears here so the dashboard can show "disabled by analytics but running
 * due to manual override".
 */
export function getDisabledRuleDetails() {
  const out = [];
  for (const ruleId of _disabledRules) {
    const detail = _disabledRuleDetails.get(ruleId) ?? { rule_id: ruleId };
    out.push({ ...detail, force_enabled: _forceEnabled.has(ruleId) });
  }
  return out;
}

export function updateForceOverrides({ force_enable, force_disable } = {}) {
  _forceEnabled.clear();
  if (force_enable) for (const id of force_enable) _forceEnabled.add(id);
  _forceDisabled.clear();
  if (force_disable) for (const id of force_disable) _forceDisabled.add(id);
}

export function getForceEnabledRules() {
  return new Set(_forceEnabled);
}

export function getForceDisabledRules() {
  return new Set(_forceDisabled);
}

/**
 * True if a **check name** should be suppressed entirely (diagnostic never
 * reaches the agent). Distinct from `ruleIsActive(ruleId)`, which only gates
 * rule-engine registrations — this also covers structural checks
 * (`pos-supervisor:*`) and LSP checks without registered rule modules.
 *
 * The force-disable set is a single flat namespace: it can contain either a
 * rule_id (e.g. "UnknownFilter.suggest_nearest") or a bare check name
 * (e.g. "pos-supervisor:HtmlInPage"). The filter in validate-code.js calls
 * this with `d.check`; `runRules()` above calls the rule_id-aware path.
 */
export function isCheckForceDisabled(checkName) {
  return !!checkName && _forceDisabled.has(checkName);
}
