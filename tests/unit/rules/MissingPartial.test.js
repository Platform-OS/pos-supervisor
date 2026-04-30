import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules, parseModulePath } from '../../../src/core/rules/MissingPartial.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

const FIXTURE_MAP = {
  pages: {
    'blog_posts:get': { path: 'app/views/pages/blog_posts/index.html.liquid', slug: 'blog_posts', method: 'get', renders: ['blog_posts/list'], function_calls: [] },
  },
  partials: {
    'blog_posts/list': { path: 'app/views/partials/blog_posts/list.liquid', params: [], renders: ['blog_posts/card'], function_calls: [], rendered_by: [] },
    'blog_posts/card': { path: 'app/views/partials/blog_posts/card.liquid', params: [], renders: [], function_calls: [], rendered_by: [] },
    'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid', params: [], renders: [], function_calls: [], rendered_by: [] },
  },
  commands: {},
  queries: {},
  graphql: {},
  schema: {},
  layouts: {},
  translations: {},
  assets: [],
};

const graph = buildFactGraph(FIXTURE_MAP);
const facts = { graph };

beforeEach(() => {
  clearRules();
  registerRules(rules);
});

describe('MissingPartial.module_path', () => {
  test('fires for module partial paths', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/user/helpers/auth' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
    expect(result.see_also.tool).toBe('module_info');
    expect(result.see_also.args.name).toBe('user');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('does not fire for project partials', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/missing' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('MissingPartial.module_path');
  });
});

describe('MissingPartial.module_path — projectDir-aware behavior', () => {
  let projectDir;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mp-modpath-'));

    const writeFile = (rel) => {
      const abs = join(projectDir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, '');
    };

    // core: only `execute` is exported as a command, plus a deeper helper tree
    writeFile('modules/core/public/lib/commands/execute.liquid');
    writeFile('modules/core/public/lib/commands/email/send/build.liquid');
    writeFile('modules/core/public/lib/commands/email/send/check.liquid');
    writeFile('modules/core/public/lib/queries/users/find.liquid');
    writeFile('modules/core/public/lib/helpers/auth_token.liquid');

    // user: only helpers
    writeFile('modules/user/public/lib/helpers/current.liquid');
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test('build/check special case: explains they are inline phases of caller command', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/core/commands/build' } };
    const result = runRules(diag, { ...facts, projectDir });
    expect(result.rule_id).toBe('MissingPartial.module_path');
    expect(result.hint_md).toContain('inline phases of your own command');
    expect(result.hint_md).toContain('modules/core/commands/execute');
    // closest matches block must enumerate live exports
    expect(result.hint_md).toContain('modules/core/commands/execute');
    // exported categories summary
    expect(result.hint_md).toContain('Exported categories:');
    expect(result.hint_md).toMatch(/commands \(\d+\)/);
  });

  test('build/check special case fires for `check` symmetrically', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/core/commands/check' } };
    const result = runRules(diag, { ...facts, projectDir });
    expect(result.hint_md).toContain('inline phases of your own command');
    expect(result.fixes[0].description).toContain('inline the build/check logic');
  });

  test('non-existing path inside an installed module: lists Levenshtein candidates', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/core/queries/users/fnd' } };
    const result = runRules(diag, { ...facts, projectDir });
    expect(result.rule_id).toBe('MissingPartial.module_path');
    expect(result.hint_md).toContain('not exported by module `core`');
    expect(result.hint_md).toContain('modules/core/queries/users/find');
    expect(result.fixes[0].description).toContain('modules/core/queries/users/find');
    expect(result.confidence).toBe(0.9);
  });

  test('module not installed: suggests the closest installed module', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/cre/commands/execute' } };
    const result = runRules(diag, { ...facts, projectDir });
    expect(result.rule_id).toBe('MissingPartial.module_path');
    expect(result.hint_md).toContain('Module `cre` is not installed');
    expect(result.hint_md).toContain('Installed modules:');
    expect(result.hint_md).toContain('Did you mean `core`');
    expect(result.see_also.tool).toBe('project_map');
  });

  test('module not installed and no modules dir: still produces a hint', () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), 'mp-empty-'));
    try {
      const diag = { check: 'MissingPartial', params: { partial: 'modules/anything/commands/execute' } };
      const result = runRules(diag, { ...facts, projectDir: isolatedDir });
      expect(result.rule_id).toBe('MissingPartial.module_path');
      expect(result.hint_md).toContain('Module `anything` is not installed');
      expect(result.hint_md).toContain('No modules are installed');
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('no projectDir in facts: rule still fires with degraded hint (no exports)', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/core/commands/build' } };
    const result = runRules(diag, facts); // no projectDir
    expect(result.rule_id).toBe('MissingPartial.module_path');
    expect(result.hint_md).toContain('inline phases of your own command');
    // no live exports → no closest matches
    expect(result.hint_md).toContain('(no close matches in this module)');
  });

  test('parseModulePath: splits into moduleName / category / rest', () => {
    expect(parseModulePath('modules/core/commands/email/send/build'))
      .toEqual({ moduleName: 'core', category: 'commands', rest: 'email/send/build' });
    expect(parseModulePath('modules/core/commands/build'))
      .toEqual({ moduleName: 'core', category: 'commands', rest: 'build' });
    expect(parseModulePath('modules/core/commands'))
      .toEqual({ moduleName: 'core', category: 'commands', rest: null });
    expect(parseModulePath('modules/core'))
      .toEqual({ moduleName: 'core', category: null, rest: null });
    expect(parseModulePath(''))
      .toEqual({ moduleName: null, category: null, rest: null });
    expect(parseModulePath('app/lib/commands/foo'))
      .toEqual({ moduleName: null, category: null, rest: null });
  });
});

describe('MissingPartial.file_exists', () => {
  test('fires when target file exists in graph', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/card' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.file_exists');
    expect(result.hint_md).toContain('exists');
  });
});

describe('MissingPartial.suggest_nearest', () => {
  test('suggests similar partials for near-miss names', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/lst' }, file: 'app/views/pages/blog_posts/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.suggest_nearest');
    expect(result.hint_md).toContain('blog_posts/list');
  });

  test('skips for module paths', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/user/lst' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
  });
});

describe('MissingPartial.create_file', () => {
  test('suggests creating a new partial', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'invoices/summary' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.create_file');
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].type).toBe('create_file');
    expect(result.fixes[0].path).toBe('app/views/partials/invoices/summary.liquid');
  });

  test('suggests creating a command', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'commands/products/create' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.create_file');
    expect(result.fixes[0].path).toBe('app/lib/commands/products/create.liquid');
  });

  test('suggests creating a query', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'queries/products/find' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.create_file');
    expect(result.fixes[0].path).toBe('app/lib/queries/products/find.liquid');
  });

  test('does not suggest create for existing files', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/card' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('MissingPartial.create_file');
  });

  test('does not suggest create for module paths', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/core/commands/execute' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
  });
});

describe('MissingPartial.invalid_lib_prefix', () => {
  // Regression: prior code stripped a leading `lib/` everywhere it saw one,
  // collapsing `lib/commands/X` and `commands/X` into the same bucket. That
  // hid the bug from agents (and from us) — `lib/commands/X` is *not* a
  // valid platformOS function-tag path, since paths resolve under
  // `app/views/partials/` and `app/lib/`. The literal prefix expands to
  // `app/lib/lib/...` and never resolves.

  test('fires for `lib/commands/X` with the corrected name in the hint', () => {
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'lib/commands/contact_submissions/create' },
      line: 6,
      column: 20,
      endLine: 6,
      endColumn: 61,
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.invalid_lib_prefix');
    expect(result.hint_md).toContain('lib/commands/contact_submissions/create');
    expect(result.hint_md).toContain('commands/contact_submissions/create');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('emits a text_edit fix that replaces the quoted reference with the corrected form', () => {
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'lib/commands/contact_submissions/create' },
      line: 6,
      column: 20,
      endLine: 6,
      endColumn: 61,
    };
    const result = runRules(diag, facts);
    expect(result.fixes).toHaveLength(1);
    const fix = result.fixes[0];
    expect(fix.type).toBe('text_edit');
    expect(fix.new_text).toBe(`'commands/contact_submissions/create'`);
    expect(fix.range).toEqual({
      start: { line: 6, character: 20 },
      end:   { line: 6, character: 61 },
    });
  });

  test('falls back to a guidance fix when the diagnostic lacks position fields', () => {
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'lib/queries/products/search' },
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.invalid_lib_prefix');
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].type).toBe('guidance');
    expect(result.fixes[0].description).toContain('lib/queries/products/search');
    expect(result.fixes[0].description).toContain('queries/products/search');
  });

  test('handles `lib/queries/X` symmetrically with `lib/commands/X`', () => {
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'lib/queries/products/search' },
      line: 4,
      column: 16,
      endLine: 4,
      endColumn: 47,
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.invalid_lib_prefix');
    expect(result.fixes[0].type).toBe('text_edit');
    expect(result.fixes[0].new_text).toBe(`'queries/products/search'`);
  });

  test('does NOT fire for the bare `commands/X` form (the canonical syntax)', () => {
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'commands/contact_submissions/create' },
      line: 1, column: 0, endLine: 1, endColumn: 35,
    };
    const result = runRules(diag, facts);
    expect(result?.rule_id).not.toBe('MissingPartial.invalid_lib_prefix');
  });

  test('does NOT fire for module paths that happen to contain `lib/`', () => {
    // Module paths look like `modules/core/lib/commands/...` in some tree
    // layouts on disk, but the *call* path is `modules/<name>/...` — never
    // begins with `lib/`. Guard against false positives.
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'modules/core/commands/execute' },
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
  });

  test('beats lower-priority rules: invalid_lib_prefix wins over create_file even when the corrected file would not exist', () => {
    // The `lib/`-stripped path `commands/never/written` resolves to
    // `app/lib/commands/never/written.liquid` — absent from the fact graph.
    // create_file would happily propose creating it; the prefix rule must
    // fire first so the agent is told to fix the path, not create a phantom.
    const diag = {
      check: 'MissingPartial',
      params: { partial: 'lib/commands/never/written' },
      line: 2, column: 10, endLine: 2, endColumn: 39,
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.invalid_lib_prefix');
  });
});

describe('MissingPartial — edge cases', () => {
  test('returns null when partial param is missing', () => {
    const diag = { check: 'MissingPartial', params: {} };
    const result = runRules(diag, facts);
    expect(result).toBeNull();
  });

  test('returns null when params is undefined', () => {
    const diag = { check: 'MissingPartial' };
    const result = runRules(diag, facts);
    expect(result).toBeNull();
  });

  test('rule_id is always set in result', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'invoices/receipt' } };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBeDefined();
    expect(result.rule_id.startsWith('MissingPartial.')).toBe(true);
  });
});
