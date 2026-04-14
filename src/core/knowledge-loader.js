/**
 * Knowledge system loader — structured check rules, domain gotchas, Shopify awareness.
 *
 * Loads knowledge.json once at startup and provides lookup functions:
 *   getCheckKnowledge(checkName, context) — hint + Shopify detection for a check
 *   getTriggeredGotchas(domain, triggers)  — domain gotchas matching current code state
 *   isShopifyObject(name)                 — true if name is a Shopify-only object
 *   isShopifyFilter(name)                 — true if name is a Shopify-only filter
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_LOCATIONS = [
  join(__dirname, '..', 'data', 'knowledge.json'),
  join(__dirname, '..', '..', 'data', 'knowledge.json'),
];

let _knowledge = null;
let _shopifyObjects = null;
let _shopifyFilters = null;
let _shopifyContamination = null;

const DEFAULT_SHOPIFY_CONTAMINATION_LOCATIONS = [
  join(__dirname, '..', 'data', 'shopify-contamination.json'),
  join(__dirname, '..', '..', 'data', 'shopify-contamination.json'),
];

function loadShopifyContamination() {
  if (_shopifyContamination) return _shopifyContamination;
  const path = DEFAULT_SHOPIFY_CONTAMINATION_LOCATIONS.find(p => existsSync(p));
  if (!path) return null;
  try {
    _shopifyContamination = JSON.parse(readFileSync(path, 'utf8'));
    return _shopifyContamination;
  } catch {
    return null;
  }
}

/**
 * Load knowledge.json (lazy, cached).
 */
function load() {
  if (_knowledge) return _knowledge;
  const path = DEFAULT_LOCATIONS.find(p => existsSync(p));
  if (!path) return null;
  try {
    _knowledge = JSON.parse(readFileSync(path, 'utf8'));
    // Build lookup sets for Shopify awareness
    _shopifyObjects = new Set();
    _shopifyFilters = new Set();
    const uo = _knowledge.checks?.UndefinedObject;
    if (uo?.shopify_objects) uo.shopify_objects.forEach(o => _shopifyObjects.add(o));
    const uf = _knowledge.checks?.UnknownFilter;
    if (uf?.shopify_filters) uf.shopify_filters.forEach(f => _shopifyFilters.add(f));
    return _knowledge;
  } catch {
    return null;
  }
}

/**
 * Get structured knowledge for a check type.
 *
 * @param {string} checkName — e.g., 'UndefinedObject'
 * @param {'page'|'partial'|'default'|null} context — file context for context-aware hints
 * @returns {{ summary: string, hint: string, shopify_guidance?: string }|null}
 */
export function getCheckKnowledge(checkName, context = 'default') {
  const kb = load();
  if (!kb?.checks?.[checkName]) return null;
  const check = kb.checks[checkName];
  const hint = check.hint?.[context] ?? check.hint?.default ?? null;
  const result = { summary: check.summary, hint };
  if (check.shopify_guidance) result.shopify_guidance = check.shopify_guidance;
  return result;
}

/**
 * Evaluate triggered gotchas for a domain given the current code state.
 *
 * @param {string} domain — e.g., 'pages', 'partials'
 * @param {object} triggers — { checks: Set<string>, tags: Set<string>, filters: Set<string> }
 * @returns {{ rule: string, gotchas: Array<{ id, message, severity }> }}
 */
export function getTriggeredGotchas(domain, triggers = {}) {
  const kb = load();
  if (!kb?.domains?.[domain]) return null;
  const domainDef = kb.domains[domain];
  const checks = triggers.checks ?? new Set();
  const tags = triggers.tags ?? new Set();
  const filters = triggers.filters ?? new Set();

  const matched = [];
  for (const g of domainDef.gotchas ?? []) {
    if (evaluateTrigger(g.trigger, checks, tags, filters)) {
      matched.push({ id: g.id, message: g.message, severity: g.severity });
    }
  }

  return { rule: domainDef.rule, gotchas: matched };
}

/**
 * Evaluate a trigger condition string.
 *
 * Supported formats:
 *   "always"                    — always true
 *   "has_check:CheckName"       — true if CheckName in checks set
 *   "uses_tag:tagname"          — true if tagname in tags set
 *   "uses_filter:filtername"    — true if filtername in filters set
 */
function evaluateTrigger(trigger, checks, tags, filters) {
  if (!trigger) return false;
  if (trigger === 'always') return true;
  if (trigger.startsWith('has_check:')) {
    return checks.has(trigger.slice('has_check:'.length));
  }
  if (trigger.startsWith('uses_tag:')) {
    return tags.has(trigger.slice('uses_tag:'.length));
  }
  if (trigger.startsWith('uses_filter:')) {
    return filters.has(trigger.slice('uses_filter:'.length));
  }
  return false;
}

/**
 * Check if a variable name is a Shopify-only object.
 */
export function isShopifyObject(name) {
  load();
  return _shopifyObjects?.has(name) ?? false;
}

/**
 * Return the set of module partial paths KNOWN to be missing {% doc %} blocks.
 *
 * Used by diagnostic-pipeline.js:suppressModuleTargetParams to distinguish
 * "known offender — silently suppressed" from "new offender — surface in the
 * module_doc_missing advisory so the agent can report upstream." Empty set
 * when knowledge.json lacks the list entirely.
 */
export function getKnownModulesMissingDocs() {
  const kb = load();
  const list = kb?.modules_missing_docs?.known ?? [];
  return new Set(list);
}

/**
 * Check if a filter name is a Shopify-only filter.
 */
export function isShopifyFilter(name) {
  load();
  return _shopifyFilters?.has(name) ?? false;
}

/**
 * Get rich replacement/note data for a Shopify object name.
 * Returns { replacement, note } or null if not in the contamination map.
 */
export function getShopifyObject(name) {
  const data = loadShopifyContamination();
  return data?.objects?.[name] ?? null;
}

/**
 * Get rich replacement/note data for a Shopify filter name.
 * Returns { replacement, note } or null if not in the contamination map.
 */
export function getShopifyFilter(name) {
  const data = loadShopifyContamination();
  return data?.filters?.[name] ?? null;
}

/**
 * Get rich replacement/note data for a Shopify tag name.
 * Returns { replacement, note } or null if not in the contamination map.
 */
export function getShopifyTag(name) {
  const data = loadShopifyContamination();
  return data?.tags?.[name] ?? null;
}

/**
 * Check if a tag name is a Shopify-only tag (not valid in platformOS).
 */
export function isShopifyTag(name) {
  const data = loadShopifyContamination();
  return !!(data?.tags?.[name]);
}

/**
 * Get the domain rule one-liner.
 */
export function getDomainRule(domain) {
  const kb = load();
  return kb?.domains?.[domain]?.rule ?? null;
}

/**
 * Get a language feature entry (try_catch, theme_render_rc, liquid_doc, etc.).
 */
export function getLanguageFeature(featureId) {
  const kb = load();
  return kb?.language_features?.[featureId] ?? null;
}

/**
 * Evaluate content-based triggers against file content and domain.
 * Returns proactive knowledge tips for patterns detected in the code.
 *
 * @param {string} content — file content to scan
 * @param {string} domain — domain from path detection (pages, partials, etc.)
 * @returns {Array<{ id: string, message: string, severity: string }>}
 */
export function getContentTriggers(content, domain) {
  const kb = load();
  if (!kb?.content_triggers || !content || !domain) return [];

  const matched = [];
  for (const trigger of kb.content_triggers) {
    // Skip if this trigger doesn't apply to the current domain
    if (trigger.domains && !trigger.domains.includes(domain)) continue;

    try {
      const re = new RegExp(trigger.pattern);
      if (re.test(content)) {
        matched.push({
          id: trigger.id,
          message: trigger.message,
          severity: trigger.severity,
        });
      }
    } catch {
      // Invalid regex in knowledge.json — skip silently
    }
  }

  return matched;
}

/** Reset cache (for testing). */
export function _resetKnowledge() {
  _knowledge = null;
  _shopifyObjects = null;
  _shopifyFilters = null;
  _shopifyContamination = null;
}
