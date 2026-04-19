/**
 * Promoted rules — declarative rules loaded from .pos-supervisor/promoted-rules.json.
 *
 * These are rules promoted from analytics suggestions via the dashboard.
 * Format is declarative JSON (not arbitrary JS) so they're safe to generate
 * from case-base patterns without eval() or dynamic import().
 *
 * Hand-written rules in this directory remain JS for full expressiveness.
 * Promoted rules cover the common guard patterns that analytics can infer:
 * param matching, file glob, file type classification.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerRules } from './engine.js';
import { classifyPath } from './queries.js';

const PROMOTED_RULES_FILE = 'promoted-rules.json';

let _projectDir = null;

function promotedRulesPath(projectDir) {
  return join(projectDir, '.pos-supervisor', PROMOTED_RULES_FILE);
}

function interpolate(template, params) {
  if (!template || !params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`);
}

function compileWhen(when) {
  const guards = [];

  if (when.param_startsWith) {
    for (const [key, prefix] of Object.entries(when.param_startsWith)) {
      guards.push((diag) => typeof diag.params?.[key] === 'string' && diag.params[key].startsWith(prefix));
    }
  }

  if (when.param_equals) {
    for (const [key, value] of Object.entries(when.param_equals)) {
      guards.push((diag) => diag.params?.[key] === value);
    }
  }

  if (when.param_contains) {
    for (const [key, substr] of Object.entries(when.param_contains)) {
      guards.push((diag) => typeof diag.params?.[key] === 'string' && diag.params[key].includes(substr));
    }
  }

  if (when.file_glob) {
    const glob = when.file_glob;
    const re = globToRegex(glob);
    guards.push((diag) => re.test(diag.file ?? ''));
  }

  if (when.file_type) {
    const targetType = when.file_type;
    guards.push((diag) => {
      if (!diag.file) return false;
      const classified = classifyFileType(diag.file);
      return classified === targetType;
    });
  }

  if (guards.length === 0) return () => true;
  return (diag) => guards.every(g => g(diag));
}

function compileApply(id, apply) {
  return (diag) => {
    const result = {
      rule_id: id,
      hint_md: interpolate(apply.hint_md, diag.params),
      fixes: [],
      confidence: apply.confidence ?? 0.5,
    };
    if (apply.see_also) {
      result.see_also = { ...apply.see_also };
    }
    return result;
  };
}

function compileRule(entry) {
  if (!entry.id || !entry.check || !entry.apply?.hint_md) {
    throw new Error(`promoted rule missing required fields: id, check, apply.hint_md`);
  }

  return {
    id: entry.id,
    check: entry.check,
    priority: entry.priority ?? 55,
    when: compileWhen(entry.when ?? {}),
    apply: compileApply(entry.id, entry.apply),
  };
}

export function loadPromotedRules(projectDir) {
  _projectDir = projectDir;
  const filePath = promotedRulesPath(projectDir);
  if (!existsSync(filePath)) return [];

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    // Malformed JSON — log but don't crash. Rules are best-effort.
    return [];
  }

  if (!Array.isArray(raw)) return [];

  const compiled = [];
  for (const entry of raw) {
    try {
      compiled.push(compileRule(entry));
    } catch {
      // Skip invalid entries silently — don't block other rules.
    }
  }

  if (compiled.length > 0) {
    registerRules(compiled);
  }

  return compiled;
}

export function getProjectDir() {
  return _projectDir;
}

export function readPromotedRulesRaw(projectDir) {
  const filePath = promotedRulesPath(projectDir);
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function addPromotedRule(projectDir, entry) {
  const filePath = promotedRulesPath(projectDir);
  const existing = readPromotedRulesRaw(projectDir);

  if (existing.some(r => r.id === entry.id)) {
    throw new Error(`promoted rule '${entry.id}' already exists`);
  }

  // Validate it compiles before persisting.
  compileRule(entry);

  existing.push(entry);
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  return entry;
}

export function removePromotedRule(projectDir, ruleId) {
  const filePath = promotedRulesPath(projectDir);
  const existing = readPromotedRulesRaw(projectDir);
  const filtered = existing.filter(r => r.id !== ruleId);

  if (filtered.length === existing.length) {
    throw new Error(`promoted rule '${ruleId}' not found`);
  }

  writeFileSync(filePath, JSON.stringify(filtered, null, 2) + '\n', 'utf-8');
  return ruleId;
}

export function listPromotedRules(projectDir) {
  return readPromotedRulesRaw(projectDir);
}

// ── Internal helpers ────────────────────────────────────────────────────────

function classifyFileType(filePath) {
  if (!filePath) return 'unknown';
  if (filePath.startsWith('app/views/pages/')) return 'page';
  if (filePath.startsWith('app/views/partials/')) return 'partial';
  if (filePath.startsWith('app/views/layouts/')) return 'layout';
  if (filePath.startsWith('app/lib/commands/')) return 'command';
  if (filePath.startsWith('app/lib/queries/')) return 'query';
  if (filePath.startsWith('app/graphql/')) return 'graphql';
  if (filePath.startsWith('app/schema/')) return 'schema';
  if (filePath.startsWith('modules/')) return 'module';
  return 'unknown';
}

function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§GLOBSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§GLOBSTAR§/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
