#!/usr/bin/env node
/**
 * Semantic validation test.
 *
 * Runs validate_code (mode: full) on every file in the broken project and
 * checks that hints, fixes, and suggestions are semantically correct —
 * not just present, but containing the RIGHT information.
 *
 * Usage:
 *   node tests/parity/semantic-validation.js
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BIN = join(ROOT, 'bin', 'pos-supervisor.js');
const PROJECT = join(ROOT, 'tests', 'fixtures', 'broken-project');

// ── Semantic rules per check type ────────────────────────────────────────────
// Each rule defines what the hint/fix MUST contain and MUST NOT contain.

const SEMANTIC_RULES = {
  UnknownFilter: {
    hint_must_contain: ['filter'],
    hint_must_not_contain: ['platformos_explain', 'platformos_search', /* {{word}} checked globally */ "?'"],
    fix_type: ['text_edit', 'guidance'],
  },
  UndefinedObject: {
    hint_must_contain: [],
    hint_must_not_contain: ['platformos_explain', /* {{word}} checked globally */ "?'"],
    // Shopify objects should have suggestion mentioning Shopify
    custom: (diag) => {
      // Only exact Shopify global objects (singular) — not plurals like 'products'
      const varName = diag.message?.match(/['"`](\w+)['"`]/)?.[1];
      const shopifyNames = new Set(['cart', 'shop', 'customer', 'product', 'collection', 'checkout', 'all_products']);
      if (varName && shopifyNames.has(varName) && (!diag.suggestion || !/shopify/i.test(diag.suggestion))) {
        return `Shopify object "${varName}" missing Shopify suggestion`;
      }
      return null;
    },
  },
  MissingPartial: {
    hint_must_contain: [],
    hint_must_not_contain: ['platformos_search', 'platformos_explain', /* {{word}} checked globally */ "?'"],
    fix_type: ['create_file', 'guidance'],
  },
  MissingRenderPartialArguments: {
    hint_must_not_contain: ['platformos_explain', /* {{word}} checked globally */ "?'"],
    custom: (diag) => {
      // Hint must contain the actual param name, not '?'
      if (diag.hint?.includes("'?'")) {
        return 'Hint contains "?" instead of actual parameter name';
      }
      return null;
    },
  },
  MetadataParamsCheck: {
    hint_must_not_contain: ['platformos_explain', /* {{word}} checked globally */ "?'"],
    custom: (diag) => {
      const isFunctionCall = /function call/i.test(diag.message);
      const isRenderCall = /render call/i.test(diag.message);
      if (isFunctionCall && diag.hint?.includes("partial's")) {
        return 'Function call error but hint mentions "partial" — should say query/command';
      }
      if (isRenderCall && diag.hint?.includes('query wrapper')) {
        return 'Render call error but hint mentions "query wrapper" — should say partial';
      }
      return null;
    },
  },
  DeprecatedTag: {
    hint_must_not_contain: ['platformos_explain', /* {{word}} checked globally */ "?'", "{% the "],
    custom: (diag) => {
      // Include deprecation should mention render as replacement
      if (diag.message?.includes('include') && diag.hint && !diag.hint.includes('render')) {
        return 'Include deprecation hint does not mention render as replacement';
      }
      return null;
    },
  },
  GraphQLCheck: {
    hint_must_not_contain: ['platformos_schema', 'platformos_ref', '{{'],
    hint_must_contain: [],
  },
  LiquidHTMLSyntaxError: {
    hint_must_not_contain: [/* {{word}} checked globally */ "?'"],
  },
  OrphanedPartial: {
    // Should not appear for commands/queries — our suppression handles this
    custom: (diag, filePath) => {
      if (/\/lib\/(commands|queries)\//.test(filePath)) {
        return 'OrphanedPartial should be suppressed for commands/queries';
      }
      return null;
    },
  },
  MissingAsset: {
    hint_must_not_contain: ['platformos_search', 'linter re-checks automatically', '{{'],
  },
  TranslationKeyExists: {
    hint_must_not_contain: ['platformos_explain', /* {{word}} checked globally */ "?'"],
  },
  NestedGraphQLQuery: {
    // Hint contains Liquid code examples with {{ }} — that's expected
  },
  ImgWidthAndHeight: {
    // Hint contains HTML/Liquid code examples with {{ }} — that's expected
  },
  UnknownProperty: {
    hint_must_not_contain: ['platformos_explain', /* {{word}} checked globally */ "?'"],
  },
  UnusedAssign: {},
  UnusedDocParam: {},
  MissingSlug: {},
  ParserBlockingScript: {},
};

// ── Global rules (apply to ALL diagnostics) ──────────────────────────────────

const GLOBAL_MUST_NOT = [
  'platformos_explain',
  'platformos_search',
  'platformos_map',
  'platformos_ref',
  'platformos_schema',
];

// ── Run ──────────────────────────────────────────────────────────────────────

console.log('\n🔬 Semantic validation test');
console.log(`   Project: ${PROJECT}\n`);

// Start server
const proc = spawn('node', [BIN], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, POS_SUPERVISOR_PROJECT_DIR: PROJECT, POS_SUPERVISOR_HTTP_PORT: '13776' },
});
proc.stderr.on('data', () => {});
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');

await new Promise((resolve) => {
  const check = async () => {
    try {
      const r = await fetch('http://localhost:13776/health');
      if (r.ok) return resolve();
    } catch {}
    setTimeout(check, 200);
  };
  setTimeout(check, 1000);
  setTimeout(() => { console.error('Server timeout'); process.exit(1); }, 30000);
});

const appDir = join(PROJECT, 'app');
const files = readdirSync(appDir, { recursive: true })
  .filter(f => f.endsWith('.liquid'))
  .map(f => `app/${f}`);

console.log(`   Files: ${files.length}\n`);

const issues = [];
const checksFound = new Set();
let totalDiags = 0;

for (const filePath of files) {
  const content = readFileSync(join(PROJECT, filePath), 'utf8');

  let result;
  try {
    const r = await fetch('http://localhost:13776/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'validate_code', params: { file_path: filePath, content, mode: 'full' } }),
    });
    result = (await r.json()).result;
  } catch (e) {
    issues.push({ file: filePath, check: 'SYSTEM', issue: `validate_code failed: ${e.message}` });
    continue;
  }

  const allDiags = [...(result.errors ?? []), ...(result.warnings ?? []), ...(result.infos ?? [])];
  totalDiags += allDiags.length;

  for (const diag of allDiags) {
    checksFound.add(diag.check);
    const rules = SEMANTIC_RULES[diag.check];

    // Global checks on ALL diagnostics
    for (const forbidden of GLOBAL_MUST_NOT) {
      if (diag.hint?.includes(forbidden)) {
        issues.push({
          file: filePath,
          check: diag.check,
          issue: `Hint references nonexistent tool "${forbidden}"`,
          hint_excerpt: diag.hint?.slice(0, 100),
        });
      }
      if (diag.fix?.description?.includes(forbidden)) {
        issues.push({
          file: filePath,
          check: diag.check,
          issue: `Fix description references nonexistent tool "${forbidden}"`,
        });
      }
    }

    // Check for unresolved template variables in hints
    // {{word}} (no spaces) = template variable. {{ word }} (spaces) = Liquid code example — OK.
    if (diag.hint && /\{\{\w+\}\}/.test(diag.hint)) {
      const match = diag.hint.match(/\{\{(\w+)\}\}/);
      issues.push({
        file: filePath,
        check: diag.check,
        issue: `Hint contains unresolved template variable: {{${match[1]}}}`,
        hint_excerpt: diag.hint?.slice(0, 100),
      });
    }

    // Check for '?' placeholder in hints
    if (diag.hint?.includes("'?'")) {
      issues.push({
        file: filePath,
        check: diag.check,
        issue: `Hint contains '?' placeholder instead of actual value`,
        hint_excerpt: diag.hint?.slice(0, 100),
      });
    }

    if (!rules) continue;

    // Must-contain checks
    for (const required of rules.hint_must_contain ?? []) {
      if (diag.hint && !diag.hint.toLowerCase().includes(required.toLowerCase())) {
        issues.push({
          file: filePath,
          check: diag.check,
          issue: `Hint missing required term "${required}"`,
          hint_excerpt: diag.hint?.slice(0, 100),
        });
      }
    }

    // Must-not-contain checks
    for (const forbidden of rules.hint_must_not_contain ?? []) {
      if (diag.hint?.includes(forbidden)) {
        issues.push({
          file: filePath,
          check: diag.check,
          issue: `Hint contains forbidden term "${forbidden}"`,
          hint_excerpt: diag.hint?.slice(0, 100),
        });
      }
    }

    // Fix type checks
    if (rules.fix_type && diag.fix) {
      if (!rules.fix_type.includes(diag.fix.type)) {
        issues.push({
          file: filePath,
          check: diag.check,
          issue: `Fix type "${diag.fix.type}" not in expected types [${rules.fix_type.join(', ')}]`,
        });
      }
    }

    // Custom validation
    if (rules.custom) {
      const customIssue = rules.custom(diag, filePath);
      if (customIssue) {
        issues.push({
          file: filePath,
          check: diag.check,
          issue: customIssue,
          hint_excerpt: diag.hint?.slice(0, 100),
        });
      }
    }
  }

  process.stdout.write(`\r   Progress: ${files.indexOf(filePath) + 1}/${files.length}`);
}

console.log('\n');

// ── Report ───────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log('  SEMANTIC VALIDATION REPORT');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`  Files tested:     ${files.length}`);
console.log(`  Total diagnostics: ${totalDiags}`);
console.log(`  Check types found: ${checksFound.size}`);
console.log(`  Semantic issues:  ${issues.length}\n`);

// Check coverage — which rules have we NOT tested?
const untestedRules = Object.keys(SEMANTIC_RULES).filter(r => !checksFound.has(r));
if (untestedRules.length > 0) {
  console.log('── Untested check types (no broken file triggers them) ──\n');
  for (const r of untestedRules) {
    console.log(`  ⚠ ${r} — add a broken file that triggers this check`);
  }
  console.log();
}

// Check types found but without semantic rules
const unruledChecks = [...checksFound].filter(c =>
  !SEMANTIC_RULES[c] && !c.startsWith('pos-supervisor:')
);
if (unruledChecks.length > 0) {
  console.log('── Check types without semantic rules ───────────────────\n');
  for (const c of unruledChecks) {
    console.log(`  ℹ ${c} — add semantic rules for this check type`);
  }
  console.log();
}

if (issues.length > 0) {
  console.log('── Semantic issues found ────────────────────────────────\n');
  const grouped = {};
  for (const i of issues) {
    const key = i.check;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(i);
  }
  for (const [check, items] of Object.entries(grouped)) {
    console.log(`  ${check} (${items.length} issue(s))`);
    for (const i of items) {
      console.log(`    ✗ ${i.issue}`);
      console.log(`      File: ${i.file}`);
      if (i.hint_excerpt) console.log(`      Hint: "${i.hint_excerpt}..."`);
    }
    console.log();
  }
}

console.log('═══════════════════════════════════════════════════════════\n');

if (issues.length === 0 && untestedRules.length === 0) {
  console.log('✅ ALL CHECKS PASS — hints, fixes, and suggestions are semantically correct.\n');
} else if (issues.length === 0) {
  console.log(`✅ All tested checks pass. ${untestedRules.length} check type(s) not covered by broken project.\n`);
} else {
  console.log(`✗ ${issues.length} semantic issue(s) found. Fix hints/enrichment for the affected check types.\n`);
}

proc.kill();
