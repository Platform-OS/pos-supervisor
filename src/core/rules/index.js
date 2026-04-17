/**
 * Rule registry — auto-loads all rule modules from this directory.
 *
 * Each module exports `rules: Rule[]`. Call `loadAllRules()` once at startup
 * to populate the engine. Individual rule modules can also be loaded manually
 * via `registerRules()`.
 */
import { registerRules, clearRules, ruleCount } from './engine.js';
import { rules as MissingPartialRules } from './MissingPartial.js';

const ALL_RULE_MODULES = [
  MissingPartialRules,
];

let _loaded = false;

export function loadAllRules() {
  if (_loaded) return;
  for (const rules of ALL_RULE_MODULES) {
    registerRules(rules);
  }
  _loaded = true;
}

export function reloadRules() {
  clearRules();
  _loaded = false;
  loadAllRules();
}

export { ruleCount };
