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

const _registry = new Map();
const _disabledRules = new Set();

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

export function runRules(diag, facts, { multiMatch = false } = {}) {
  const rules = _registry.get(diag.check);
  if (!rules || rules.length === 0) return null;

  if (multiMatch) {
    const results = [];
    for (const rule of rules) {
      if (_disabledRules.has(rule.id)) continue;
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
    if (_disabledRules.has(rule.id)) continue;
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

export function clearRules() {
  _registry.clear();
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

export function getDisabledRules() {
  return new Set(_disabledRules);
}
