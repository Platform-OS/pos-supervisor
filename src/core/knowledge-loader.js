/**
 * Knowledge system loader — structured check rules, domain gotchas, Shopify awareness.
 *
 * Loads from split data files (per-check YAML, shopify-objects.json, etc.) with
 * fallback to monolithic knowledge.json for backward compatibility. Provides
 * lookup functions:
 *   getCheckKnowledge(checkName, context) — hint + Shopify detection for a check
 *   getTriggeredGotchas(domain, triggers)  — domain gotchas matching current code state
 *   isShopifyObject(name)                 — true if name is a Shopify-only object
 *   isShopifyFilter(name)                 — true if name is a Shopify-only filter
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const FALLBACK_LOCATIONS = [
  join(DATA_DIR, 'knowledge.json'),
  join(__dirname, '..', '..', 'data', 'knowledge.json'),
];

let _knowledge = null;
let _shopifyObjects = null;
let _shopifyFilters = null;
let _shopifyContamination = null;

const DEFAULT_SHOPIFY_CONTAMINATION_LOCATIONS = [
  join(DATA_DIR, 'shopify-contamination.json'),
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

function loadYaml(filePath) {
  if (!existsSync(filePath)) return null;
  try { return yaml.load(readFileSync(filePath, 'utf8')); } catch { return null; }
}

function loadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return null; }
}

function loadFromSplitFiles() {
  const kb = { checks: {}, domains: {}, language_features: {}, content_triggers: [], modules_missing_docs: { known: [] } };

  const checksDir = join(DATA_DIR, 'checks');
  if (existsSync(checksDir)) {
    for (const file of readdirSync(checksDir)) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const check = loadYaml(join(checksDir, file));
      if (check?.name) kb.checks[check.name] = check;
    }
  }
  if (Object.keys(kb.checks).length === 0) return null;

  const shopify = loadJson(join(DATA_DIR, 'shopify-objects.json'));
  if (shopify) {
    if (kb.checks.UndefinedObject) kb.checks.UndefinedObject.shopify_objects = shopify.objects ?? [];
    if (kb.checks.UnknownFilter) kb.checks.UnknownFilter.shopify_filters = shopify.filters ?? [];
  }

  kb.domains = loadYaml(join(DATA_DIR, 'domain-gotchas.yml')) ?? {};
  kb.content_triggers = loadYaml(join(DATA_DIR, 'content-triggers.yml')) ?? [];
  kb.language_features = loadYaml(join(DATA_DIR, 'language-features.yml')) ?? {};
  kb.modules_missing_docs = loadJson(join(DATA_DIR, 'modules-missing-docs.json')) ?? { known: [] };

  return kb;
}

function load() {
  if (_knowledge) return _knowledge;

  _knowledge = loadFromSplitFiles();
  if (!_knowledge) {
    const jsonPath = FALLBACK_LOCATIONS.find(p => existsSync(p));
    if (jsonPath) {
      try { _knowledge = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { _knowledge = null; }
    }
  }
  if (!_knowledge) return null;

  _shopifyObjects = new Set();
  _shopifyFilters = new Set();
  const uo = _knowledge.checks?.UndefinedObject;
  if (uo?.shopify_objects) uo.shopify_objects.forEach(o => _shopifyObjects.add(o));
  const uf = _knowledge.checks?.UnknownFilter;
  if (uf?.shopify_filters) uf.shopify_filters.forEach(f => _shopifyFilters.add(f));

  return _knowledge;
}

/**
 * Get structured knowledge for a check type.
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

function evaluateTrigger(trigger, checks, tags, filters) {
  if (!trigger) return false;
  if (trigger === 'always') return true;
  if (trigger.startsWith('has_check:')) return checks.has(trigger.slice('has_check:'.length));
  if (trigger.startsWith('uses_tag:')) return tags.has(trigger.slice('uses_tag:'.length));
  if (trigger.startsWith('uses_filter:')) return filters.has(trigger.slice('uses_filter:'.length));
  return false;
}

export function isShopifyObject(name) {
  load();
  return _shopifyObjects?.has(name) ?? false;
}

export function getKnownModulesMissingDocs() {
  const kb = load();
  const list = kb?.modules_missing_docs?.known ?? [];
  return new Set(list);
}

export function isShopifyFilter(name) {
  load();
  return _shopifyFilters?.has(name) ?? false;
}

export function getShopifyObject(name) {
  const data = loadShopifyContamination();
  return data?.objects?.[name] ?? null;
}

export function getShopifyFilter(name) {
  const data = loadShopifyContamination();
  return data?.filters?.[name] ?? null;
}

export function getShopifyTag(name) {
  const data = loadShopifyContamination();
  return data?.tags?.[name] ?? null;
}

export function isShopifyTag(name) {
  const data = loadShopifyContamination();
  return !!(data?.tags?.[name]);
}

export function getDomainRule(domain) {
  const kb = load();
  return kb?.domains?.[domain]?.rule ?? null;
}

export function getLanguageFeature(featureId) {
  const kb = load();
  return kb?.language_features?.[featureId] ?? null;
}

export function getContentTriggers(content, domain) {
  const kb = load();
  if (!kb?.content_triggers || !content || !domain) return [];

  const matched = [];
  for (const trigger of kb.content_triggers) {
    if (trigger.domains && !trigger.domains.includes(domain)) continue;
    try {
      if (new RegExp(trigger.pattern).test(content)) {
        matched.push({ id: trigger.id, message: trigger.message, severity: trigger.severity });
      }
    } catch {}
  }

  return matched;
}

export function _resetKnowledge() {
  _knowledge = null;
  _shopifyObjects = null;
  _shopifyFilters = null;
  _shopifyContamination = null;
}
