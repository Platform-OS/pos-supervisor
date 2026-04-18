/**
 * Rule registry — auto-loads all rule modules from this directory.
 *
 * Each module exports `rules: Rule[]`. Call `loadAllRules()` once at startup
 * to populate the engine. Individual rule modules can also be loaded manually
 * via `registerRules()`.
 */
import { registerRules, clearRules, ruleCount } from './engine.js';
import { rules as MissingPartialRules } from './MissingPartial.js';
import { rules as UndefinedObjectRules } from './UndefinedObject.js';
import { rules as UnknownFilterRules } from './UnknownFilter.js';
import { rules as TranslationKeyExistsRules } from './TranslationKeyExists.js';
import { rules as UnusedAssignRules } from './UnusedAssign.js';
import { rules as MissingRenderPartialArgumentsRules } from './MissingRenderPartialArguments.js';
import { rules as UnknownPropertyRules } from './UnknownProperty.js';
import { rules as MetadataParamsCheckRules } from './MetadataParamsCheck.js';
import { rules as GraphQLCheckRules } from './GraphQLCheck.js';

const ALL_RULE_MODULES = [
  MissingPartialRules,
  UndefinedObjectRules,
  UnknownFilterRules,
  TranslationKeyExistsRules,
  UnusedAssignRules,
  MissingRenderPartialArgumentsRules,
  UnknownPropertyRules,
  MetadataParamsCheckRules,
  GraphQLCheckRules,
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
