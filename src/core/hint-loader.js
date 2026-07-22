/**
 * Reference-driven error hint loader.
 * Loads hint files from data/hints/ at first access and caches them.
 * Each file is named after a linter check (e.g., GraphQLCheck.md) with
 * optional variants (e.g., UndefinedObject-partial.md).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default locations — used when no explicit dataDir is configured
const DEFAULT_LOCATIONS = [
  join(__dirname, '..', 'data', 'hints'),       // src/data/hints/
  join(__dirname, '..', '..', 'data', 'hints'),  // pos-supervisor/data/hints/
];

/** @type {Map<string, string>} */
const cache = new Map();
let loaded = false;
let _hintsDir = null;

/**
 * Set the hints directory explicitly. Call this at startup when
 * the data directory is resolved from pos-cli's installation path.
 */
export function setHintsDir(dir) {
  _hintsDir = dir;
  cache.clear();
  loaded = false;
}

function loadAll() {
  if (loaded) return;
  loaded = true;
  const dir = _hintsDir
    ? join(_hintsDir, 'hints')
    : DEFAULT_LOCATIONS.find(d => existsSync(d));
  if (!dir || !existsSync(dir)) return;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const key = basename(file, '.md');
      cache.set(key, readFileSync(join(dir, file), 'utf-8').trim());
    }
  } catch {
    // hints directory may not exist
  }
}

/**
 * Get a hint for a linter check name, with optional template variable substitution.
 * Template variables use {{varName}} syntax. Unresolved variables are left as-is.
 * Supports conditional blocks:
 *   {{#if var}}...{{else}}...{{/if}}
 *   {{#if var}}...{{/if}}
 *   {{#unless var}}...{{/unless}}
 *
 * @param {string} checkName - e.g., 'GraphQLCheck', 'UndefinedObject'
 * @param {string|null} [variant] - e.g., 'partial' for UndefinedObject-partial
 * @param {object} [vars] - template variables, e.g. { object: 'partial', name: 'blog_posts/index' }
 * @returns {string|null}
 */
export function getHint(checkName, variant = null, vars = {}) {
  loadAll();
  // Hint filenames are bare check names (no `pos-supervisor:` prefix) so they
  // stay portable on Windows / NTFS where `:` is reserved. The runtime check
  // ID may carry the prefix; strip it before the cache lookup.
  const key = checkName.replace(/^pos-supervisor:/, '');
  let hint = null;
  if (variant) {
    hint = cache.get(`${key}-${variant}`) ?? null;
  }
  if (!hint) {
    hint = cache.get(key) ?? null;
  }
  if (!hint) return hint;

  const hasVars = Object.keys(vars).length > 0;
  const hasConditionals = /\{\{#(?:if|unless)\s+\w+\}\}/.test(hint);

  // When no vars provided, strip unresolved template tokens to produce a safe generic hint
  if (!hasVars && !hasConditionals) {
    return hint.replace(/\{\{(\w+)\}\}/g, '').replace(/  +/g, ' ').replace(/ ([.,])/g, '$1').trim();
  }

  // Apply conditionals BEFORE simple substitution

  // 1. {{#if var}}...{{else}}...{{/if}} (with else — more specific, apply first)
  hint = hint.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, truePart, falsePart) => {
    const val = vars[key];
    const isTruthy = val !== false && val !== null && val !== undefined && val !== '';
    return isTruthy ? truePart : falsePart;
  });

  // 2. {{#if var}}...{{/if}} (without else)
  hint = hint.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
    const val = vars[key];
    const isTruthy = val !== false && val !== null && val !== undefined && val !== '';
    return isTruthy ? body : '';
  });

  // 3. {{#unless var}}...{{/unless}}
  hint = hint.replace(/\{\{#unless (\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_, key, body) => {
    const val = vars[key];
    const isTruthy = val !== false && val !== null && val !== undefined && val !== '';
    return isTruthy ? '' : body;
  });

  // 4. Simple {{var}} substitution
  if (!hasVars) return hint;
  return hint.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in vars ? vars[key] : ''))
    .replace(/  +/g, ' ').replace(/ ([.,])/g, '$1').trim();
}

/** Reset the cache (for testing). */
export function _resetCache() {
  cache.clear();
  loaded = false;
  _hintsDir = null;
}
