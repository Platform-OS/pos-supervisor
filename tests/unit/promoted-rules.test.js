import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPromotedRules,
  readPromotedRulesRaw,
  addPromotedRule,
  removePromotedRule,
  listPromotedRules,
} from '../../src/core/rules/promoted-rules.js';
import { clearRules, getRulesForCheck, runRules, ruleCount } from '../../src/core/rules/engine.js';

let tmpDir;

function setup() {
  tmpDir = join(tmpdir(), `promoted-rules-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpDir, '.pos-supervisor'), { recursive: true });
}

function teardown() {
  clearRules();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

function writeRules(rules) {
  writeFileSync(
    join(tmpDir, '.pos-supervisor', 'promoted-rules.json'),
    JSON.stringify(rules, null, 2),
  );
}

// ── Loading + compilation ────────────────────────────────────────────────────

describe('promoted-rules: loadPromotedRules', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns empty when file does not exist', () => {
    rmSync(join(tmpDir, '.pos-supervisor', 'promoted-rules.json'), { force: true });
    const result = loadPromotedRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty for malformed JSON', () => {
    writeFileSync(join(tmpDir, '.pos-supervisor', 'promoted-rules.json'), 'not json');
    const result = loadPromotedRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty for non-array JSON', () => {
    writeFileSync(join(tmpDir, '.pos-supervisor', 'promoted-rules.json'), '{"a":1}');
    const result = loadPromotedRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('loads and compiles a valid rule', () => {
    writeRules([{
      id: 'MissingPartial.test_rule',
      check: 'MissingPartial',
      priority: 55,
      when: { param_startsWith: { name: 'modules/' } },
      apply: { hint_md: 'Module partial `{{name}}` not found.', confidence: 0.7 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].id).toBe('MissingPartial.test_rule');
    expect(compiled[0].check).toBe('MissingPartial');
    expect(compiled[0].priority).toBe(55);
    expect(typeof compiled[0].when).toBe('function');
    expect(typeof compiled[0].apply).toBe('function');
  });

  it('registers compiled rules with the engine', () => {
    writeRules([{
      id: 'MissingPartial.promoted_test',
      check: 'MissingPartial',
      priority: 55,
      when: {},
      apply: { hint_md: 'Test hint.', confidence: 0.5 },
    }]);
    loadPromotedRules(tmpDir);
    const rules = getRulesForCheck('MissingPartial');
    expect(rules.some(r => r.id === 'MissingPartial.promoted_test')).toBe(true);
  });

  it('skips invalid entries without blocking valid ones', () => {
    writeRules([
      { id: 'valid_rule', check: 'MissingPartial', apply: { hint_md: 'Works.' } },
      { id: 'bad_rule' },
      { id: 'valid_rule_2', check: 'UnknownFilter', apply: { hint_md: 'Also works.' } },
    ]);
    const compiled = loadPromotedRules(tmpDir);
    expect(compiled).toHaveLength(2);
    expect(compiled.map(r => r.id)).toEqual(['valid_rule', 'valid_rule_2']);
  });

  it('defaults priority to 55 when not specified', () => {
    writeRules([{
      id: 'test_default_priority',
      check: 'MissingPartial',
      apply: { hint_md: 'Test.' },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    expect(compiled[0].priority).toBe(55);
  });
});

// ── Guard predicates (when) ────────────────────────────────────────────────

describe('promoted-rules: when guards', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('param_startsWith matches correctly', () => {
    writeRules([{
      id: 'test_startsWith',
      check: 'MissingPartial',
      when: { param_startsWith: { name: 'modules/' } },
      apply: { hint_md: 'Module partial.', confidence: 0.7 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ params: { name: 'modules/user/form' } })).toBe(true);
    expect(guard({ params: { name: 'blog_posts/list' } })).toBe(false);
    expect(guard({ params: { name: 123 } })).toBe(false);
    expect(guard({ params: {} })).toBe(false);
  });

  it('param_equals matches correctly', () => {
    writeRules([{
      id: 'test_equals',
      check: 'UnknownFilter',
      when: { param_equals: { filter: 'to_json' } },
      apply: { hint_md: 'Use json filter.', confidence: 0.9 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ params: { filter: 'to_json' } })).toBe(true);
    expect(guard({ params: { filter: 'downcase' } })).toBe(false);
  });

  it('param_contains matches correctly', () => {
    writeRules([{
      id: 'test_contains',
      check: 'MissingPartial',
      when: { param_contains: { name: 'blog' } },
      apply: { hint_md: 'Blog partial.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ params: { name: 'blog_posts/form' } })).toBe(true);
    expect(guard({ params: { name: 'user/profile' } })).toBe(false);
  });

  it('file_glob matches correctly', () => {
    writeRules([{
      id: 'test_glob',
      check: 'MissingPartial',
      when: { file_glob: 'app/views/partials/**' },
      apply: { hint_md: 'In partials dir.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ file: 'app/views/partials/blog/form.liquid' })).toBe(true);
    expect(guard({ file: 'app/views/pages/index.html.liquid' })).toBe(false);
    expect(guard({ file: undefined })).toBe(false);
  });

  it('file_type matches correctly', () => {
    writeRules([{
      id: 'test_filetype',
      check: 'MissingPartial',
      when: { file_type: 'page' },
      apply: { hint_md: 'In a page.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ file: 'app/views/pages/index.html.liquid' })).toBe(true);
    expect(guard({ file: 'app/views/partials/card.liquid' })).toBe(false);
    expect(guard({ file: null })).toBe(false);
  });

  it('multiple guards must all match (AND)', () => {
    writeRules([{
      id: 'test_multi_guard',
      check: 'MissingPartial',
      when: {
        param_startsWith: { name: 'modules/' },
        file_type: 'page',
      },
      apply: { hint_md: 'Module partial in page.', confidence: 0.8 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ params: { name: 'modules/user/form' }, file: 'app/views/pages/index.html.liquid' })).toBe(true);
    expect(guard({ params: { name: 'modules/user/form' }, file: 'app/views/partials/x.liquid' })).toBe(false);
    expect(guard({ params: { name: 'blog/form' }, file: 'app/views/pages/index.html.liquid' })).toBe(false);
  });

  it('empty when matches everything', () => {
    writeRules([{
      id: 'test_empty_when',
      check: 'MissingPartial',
      when: {},
      apply: { hint_md: 'Generic.', confidence: 0.3 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ params: {}, file: 'anything.liquid' })).toBe(true);
    expect(guard({})).toBe(true);
  });
});

// ── Apply (hint generation) ──────────────────────────────────────────────

describe('promoted-rules: apply', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('interpolates {{param}} in hint_md', () => {
    writeRules([{
      id: 'test_interpolate',
      check: 'MissingPartial',
      when: {},
      apply: { hint_md: 'Partial `{{name}}` not found. Check `{{path}}`.', confidence: 0.7 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const result = compiled[0].apply({ params: { name: 'blog/form', path: 'app/views/partials' } });

    expect(result.rule_id).toBe('test_interpolate');
    expect(result.hint_md).toBe('Partial `blog/form` not found. Check `app/views/partials`.');
    expect(result.confidence).toBe(0.7);
  });

  it('preserves unmatched template vars', () => {
    writeRules([{
      id: 'test_unmatched',
      check: 'MissingPartial',
      when: {},
      apply: { hint_md: 'Missing `{{name}}` at `{{location}}`.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const result = compiled[0].apply({ params: { name: 'form' } });

    expect(result.hint_md).toBe('Missing `form` at `{{location}}`.');
  });

  it('includes see_also when specified', () => {
    writeRules([{
      id: 'test_see_also',
      check: 'MissingPartial',
      when: {},
      apply: {
        hint_md: 'Check modules.',
        confidence: 0.6,
        see_also: { tool: 'module_info', args: { aspect: 'api' } },
      },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const result = compiled[0].apply({ params: {} });

    expect(result.see_also).toEqual({ tool: 'module_info', args: { aspect: 'api' } });
  });

  it('defaults confidence to 0.5 when not specified', () => {
    writeRules([{
      id: 'test_default_confidence',
      check: 'MissingPartial',
      when: {},
      apply: { hint_md: 'Test.' },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const result = compiled[0].apply({ params: {} });

    expect(result.confidence).toBe(0.5);
  });
});

// ── Engine integration ────────────────────────────────────────────────────

describe('promoted-rules: engine integration', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('promoted rule fires via runRules', () => {
    writeRules([{
      id: 'MissingPartial.promoted_module',
      check: 'MissingPartial',
      priority: 55,
      when: { param_startsWith: { name: 'modules/' } },
      apply: { hint_md: 'Module partial `{{name}}` not found.', confidence: 0.7 },
    }]);
    loadPromotedRules(tmpDir);

    const diag = { check: 'MissingPartial', params: { name: 'modules/user/form' } };
    const result = runRules(diag, {});

    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('MissingPartial.promoted_module');
    expect(result.hint_md).toBe('Module partial `modules/user/form` not found.');
  });

  it('promoted rule does not fire when guard fails', () => {
    writeRules([{
      id: 'MissingPartial.promoted_module_only',
      check: 'MissingPartial',
      priority: 55,
      when: { param_startsWith: { name: 'modules/' } },
      apply: { hint_md: 'Module partial.', confidence: 0.7 },
    }]);
    loadPromotedRules(tmpDir);

    const diag = { check: 'MissingPartial', params: { name: 'blog_posts/list' } };
    const result = runRules(diag, {});

    expect(result).toBeNull();
  });
});

// ── CRUD operations ──────────────────────────────────────────────────────

describe('promoted-rules: CRUD', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('addPromotedRule creates the file and persists the rule', () => {
    const entry = {
      id: 'Test.new_rule',
      check: 'Test',
      apply: { hint_md: 'New rule hint.' },
    };
    addPromotedRule(tmpDir, entry);

    const raw = readPromotedRulesRaw(tmpDir);
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe('Test.new_rule');
  });

  it('addPromotedRule rejects duplicate IDs', () => {
    const entry = { id: 'Test.dup', check: 'Test', apply: { hint_md: 'Dup.' } };
    addPromotedRule(tmpDir, entry);

    expect(() => addPromotedRule(tmpDir, entry)).toThrow('already exists');
  });

  it('addPromotedRule validates the entry before persisting', () => {
    expect(() => addPromotedRule(tmpDir, { id: 'bad' })).toThrow('missing required fields');
  });

  it('removePromotedRule removes an existing rule', () => {
    addPromotedRule(tmpDir, { id: 'Test.removeme', check: 'Test', apply: { hint_md: 'Remove me.' } });
    removePromotedRule(tmpDir, 'Test.removeme');

    const raw = readPromotedRulesRaw(tmpDir);
    expect(raw).toHaveLength(0);
  });

  it('removePromotedRule throws for unknown rule', () => {
    expect(() => removePromotedRule(tmpDir, 'Test.nonexistent')).toThrow('not found');
  });

  it('listPromotedRules returns all raw rules', () => {
    addPromotedRule(tmpDir, { id: 'A.rule1', check: 'A', apply: { hint_md: 'One.' } });
    addPromotedRule(tmpDir, { id: 'B.rule2', check: 'B', apply: { hint_md: 'Two.' } });

    const list = listPromotedRules(tmpDir);
    expect(list).toHaveLength(2);
    expect(list.map(r => r.id)).toEqual(['A.rule1', 'B.rule2']);
  });

  it('listPromotedRules returns empty when no file exists', () => {
    rmSync(join(tmpDir, '.pos-supervisor', 'promoted-rules.json'), { force: true });
    expect(listPromotedRules(tmpDir)).toEqual([]);
  });
});

// ── Internal helpers ───────────────────────────────────────────────────────

describe('promoted-rules: file_type classification', () => {
  beforeEach(setup);
  afterEach(teardown);

  const testCases = [
    ['app/views/pages/index.html.liquid', 'page'],
    ['app/views/partials/card.liquid', 'partial'],
    ['app/views/layouts/main.liquid', 'layout'],
    ['app/lib/commands/blog/create.liquid', 'command'],
    ['app/lib/queries/blog/search.liquid', 'query'],
    ['app/graphql/blog/create.graphql', 'graphql'],
    ['app/schema/blog.yml', 'schema'],
    ['modules/user/form.liquid', 'module'],
  ];

  for (const [path, expectedType] of testCases) {
    it(`classifies ${path} as ${expectedType}`, () => {
      writeRules([{
        id: `test_classify_${expectedType}`,
        check: 'TestCheck',
        when: { file_type: expectedType },
        apply: { hint_md: 'Match.' },
      }]);
      const compiled = loadPromotedRules(tmpDir);
      expect(compiled[0].when({ file: path })).toBe(true);
    });
  }
});

describe('promoted-rules: glob patterns', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('** matches nested directories', () => {
    writeRules([{
      id: 'test_globstar',
      check: 'Test',
      when: { file_glob: 'app/views/**/*.liquid' },
      apply: { hint_md: 'Match.' },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    expect(compiled[0].when({ file: 'app/views/pages/blog/index.html.liquid' })).toBe(true);
    expect(compiled[0].when({ file: 'app/lib/commands/x.liquid' })).toBe(false);
  });

  it('* matches single path segment', () => {
    writeRules([{
      id: 'test_star',
      check: 'Test',
      when: { file_glob: 'app/views/pages/*.liquid' },
      apply: { hint_md: 'Match.' },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    expect(compiled[0].when({ file: 'app/views/pages/index.liquid' })).toBe(true);
    expect(compiled[0].when({ file: 'app/views/pages/blog/index.liquid' })).toBe(false);
  });
});

// ── Graph-aware guards ──────────────────────────────────────────────────────

function mockGraph(nodes = {}, edges = {}) {
  return {
    referencedBy(filePath) {
      return edges[filePath] ?? [];
    },
    hasNode(filePath) {
      return filePath in nodes;
    },
    nodeByPath(filePath) {
      return nodes[filePath] ?? null;
    },
  };
}

describe('promoted-rules: graph-aware guards', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('has_callers: true matches when file has callers', () => {
    writeRules([{
      id: 'test_has_callers_true',
      check: 'TestCheck',
      when: { has_callers: true },
      apply: { hint_md: 'Has callers.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/card.liquid': { type: 'partial', key: 'card' } },
      { 'app/views/partials/card.liquid': ['app/views/pages/index.liquid'] },
    );

    expect(guard({ file: 'app/views/partials/card.liquid' }, { graph })).toBe(true);
  });

  it('has_callers: true rejects when file has no callers', () => {
    writeRules([{
      id: 'test_has_callers_true_no_refs',
      check: 'TestCheck',
      when: { has_callers: true },
      apply: { hint_md: 'Has callers.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/orphan.liquid': { type: 'partial', key: 'orphan' } },
      { 'app/views/partials/orphan.liquid': [] },
    );

    expect(guard({ file: 'app/views/partials/orphan.liquid' }, { graph })).toBe(false);
  });

  it('has_callers: false matches when file has no callers', () => {
    writeRules([{
      id: 'test_has_callers_false',
      check: 'TestCheck',
      when: { has_callers: false },
      apply: { hint_md: 'No callers.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/orphan.liquid': { type: 'partial', key: 'orphan' } },
      { 'app/views/partials/orphan.liquid': [] },
    );

    expect(guard({ file: 'app/views/partials/orphan.liquid' }, { graph })).toBe(true);
  });

  it('caller_count_gte matches when callers >= threshold', () => {
    writeRules([{
      id: 'test_caller_count',
      check: 'TestCheck',
      when: { caller_count_gte: 3 },
      apply: { hint_md: 'Many callers.', confidence: 0.7 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/header.liquid': { type: 'partial', key: 'header' } },
      { 'app/views/partials/header.liquid': ['page1.liquid', 'page2.liquid', 'page3.liquid'] },
    );

    expect(guard({ file: 'app/views/partials/header.liquid' }, { graph })).toBe(true);
  });

  it('caller_count_gte rejects when callers < threshold', () => {
    writeRules([{
      id: 'test_caller_count_below',
      check: 'TestCheck',
      when: { caller_count_gte: 3 },
      apply: { hint_md: 'Many callers.', confidence: 0.7 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/header.liquid': { type: 'partial', key: 'header' } },
      { 'app/views/partials/header.liquid': ['page1.liquid', 'page2.liquid'] },
    );

    expect(guard({ file: 'app/views/partials/header.liquid' }, { graph })).toBe(false);
  });

  it('has_params: true matches when file has doc params', () => {
    writeRules([{
      id: 'test_has_params_true',
      check: 'TestCheck',
      when: { has_params: true },
      apply: { hint_md: 'Documented partial.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph({
      'app/views/partials/card.liquid': { type: 'partial', key: 'card', params: ['title', 'image'] },
    });

    expect(guard({ file: 'app/views/partials/card.liquid' }, { graph })).toBe(true);
  });

  it('has_params: false matches when file has no doc params', () => {
    writeRules([{
      id: 'test_has_params_false',
      check: 'TestCheck',
      when: { has_params: false },
      apply: { hint_md: 'Undocumented partial.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph({
      'app/views/partials/card.liquid': { type: 'partial', key: 'card', params: [] },
    });

    expect(guard({ file: 'app/views/partials/card.liquid' }, { graph })).toBe(true);
  });

  it('has_params: true rejects when file has no params', () => {
    writeRules([{
      id: 'test_has_params_true_no_params',
      check: 'TestCheck',
      when: { has_params: true },
      apply: { hint_md: 'Documented.', confidence: 0.6 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph({
      'app/views/partials/card.liquid': { type: 'partial', key: 'card', params: [] },
    });

    expect(guard({ file: 'app/views/partials/card.liquid' }, { graph })).toBe(false);
  });

  it('is_orphan: true matches orphan files', () => {
    writeRules([{
      id: 'test_is_orphan_true',
      check: 'TestCheck',
      when: { is_orphan: true },
      apply: { hint_md: 'Orphan file.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/dead.liquid': { type: 'partial', key: 'dead' } },
      { 'app/views/partials/dead.liquid': [] },
    );

    expect(guard({ file: 'app/views/partials/dead.liquid' }, { graph })).toBe(true);
  });

  it('is_orphan: false matches non-orphan files', () => {
    writeRules([{
      id: 'test_is_orphan_false',
      check: 'TestCheck',
      when: { is_orphan: false },
      apply: { hint_md: 'Not orphan.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/used.liquid': { type: 'partial', key: 'used' } },
      { 'app/views/partials/used.liquid': ['page.liquid'] },
    );

    expect(guard({ file: 'app/views/partials/used.liquid' }, { graph })).toBe(true);
  });

  it('is_orphan: true rejects when file has callers', () => {
    writeRules([{
      id: 'test_is_orphan_true_has_callers',
      check: 'TestCheck',
      when: { is_orphan: true },
      apply: { hint_md: 'Orphan.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/used.liquid': { type: 'partial', key: 'used' } },
      { 'app/views/partials/used.liquid': ['caller.liquid'] },
    );

    expect(guard({ file: 'app/views/partials/used.liquid' }, { graph })).toBe(false);
  });

  it('graph guards degrade gracefully when no graph provided', () => {
    writeRules([{
      id: 'test_no_graph',
      check: 'TestCheck',
      when: { has_callers: true },
      apply: { hint_md: 'Needs callers.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;

    expect(guard({ file: 'app/views/partials/card.liquid' }, {})).toBe(false);
    expect(guard({ file: 'app/views/partials/card.liquid' }, null)).toBe(false);
    expect(guard({ file: 'app/views/partials/card.liquid' })).toBe(false);
  });

  it('graph guards degrade gracefully when no diag.file', () => {
    writeRules([{
      id: 'test_no_file',
      check: 'TestCheck',
      when: { is_orphan: true },
      apply: { hint_md: 'Orphan.', confidence: 0.5 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph({ 'app/views/partials/x.liquid': { type: 'partial' } });

    expect(guard({}, { graph })).toBe(false);
    expect(guard({ file: null }, { graph })).toBe(false);
    expect(guard({ file: undefined }, { graph })).toBe(false);
  });

  it('combines graph guards with param guards (AND semantics)', () => {
    writeRules([{
      id: 'test_combined_graph_param',
      check: 'MissingPartial',
      when: {
        param_startsWith: { name: 'modules/' },
        has_callers: true,
        is_orphan: false,
      },
      apply: { hint_md: 'Module partial with callers.', confidence: 0.8 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/mod.liquid': { type: 'partial', key: 'mod' } },
      { 'app/views/partials/mod.liquid': ['page.liquid'] },
    );

    expect(guard(
      { params: { name: 'modules/user/form' }, file: 'app/views/partials/mod.liquid' },
      { graph },
    )).toBe(true);

    expect(guard(
      { params: { name: 'blog/form' }, file: 'app/views/partials/mod.liquid' },
      { graph },
    )).toBe(false);

    expect(guard(
      { params: { name: 'modules/user/form' }, file: 'app/views/partials/mod.liquid' },
      {},
    )).toBe(false);
  });

  it('combines file_type + graph guards', () => {
    writeRules([{
      id: 'test_filetype_graph',
      check: 'TestCheck',
      when: {
        file_type: 'partial',
        caller_count_gte: 2,
        has_params: true,
      },
      apply: { hint_md: 'Popular documented partial.', confidence: 0.9 },
    }]);
    const compiled = loadPromotedRules(tmpDir);
    const guard = compiled[0].when;
    const graph = mockGraph(
      { 'app/views/partials/card.liquid': { type: 'partial', key: 'card', params: ['title'] } },
      { 'app/views/partials/card.liquid': ['page1.liquid', 'page2.liquid'] },
    );

    expect(guard(
      { file: 'app/views/partials/card.liquid' },
      { graph },
    )).toBe(true);

    const graphFewCallers = mockGraph(
      { 'app/views/partials/card.liquid': { type: 'partial', key: 'card', params: ['title'] } },
      { 'app/views/partials/card.liquid': ['page1.liquid'] },
    );
    expect(guard(
      { file: 'app/views/partials/card.liquid' },
      { graph: graphFewCallers },
    )).toBe(false);
  });

  it('engine integration: graph-aware rule fires via runRules', () => {
    writeRules([{
      id: 'TestCheck.graph_rule',
      check: 'TestCheck',
      priority: 55,
      when: { has_callers: true, caller_count_gte: 1 },
      apply: { hint_md: 'File has callers.', confidence: 0.7 },
    }]);
    loadPromotedRules(tmpDir);

    const diag = { check: 'TestCheck', file: 'app/views/partials/card.liquid' };
    const graph = mockGraph(
      { 'app/views/partials/card.liquid': { type: 'partial', key: 'card' } },
      { 'app/views/partials/card.liquid': ['page.liquid'] },
    );
    const result = runRules(diag, { graph });

    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('TestCheck.graph_rule');
  });

  it('engine integration: graph-aware rule skipped when guard fails', () => {
    writeRules([{
      id: 'TestCheck.graph_only_callers',
      check: 'TestCheck',
      priority: 55,
      when: { caller_count_gte: 5 },
      apply: { hint_md: 'Very popular.', confidence: 0.9 },
    }]);
    loadPromotedRules(tmpDir);

    const diag = { check: 'TestCheck', file: 'app/views/partials/card.liquid' };
    const graph = mockGraph(
      { 'app/views/partials/card.liquid': { type: 'partial', key: 'card' } },
      { 'app/views/partials/card.liquid': ['page.liquid', 'page2.liquid'] },
    );
    const result = runRules(diag, { graph });

    expect(result).toBeNull();
  });
});

// ── Query helpers ───────────────────────────────────────────────────────────

import { callerCount, isOrphan, hasDocParams, classifyFileType } from '../../src/core/rules/queries.js';

describe('queries: callerCount', () => {
  it('returns caller count from graph', () => {
    const graph = mockGraph({}, { 'a.liquid': ['b.liquid', 'c.liquid'] });
    expect(callerCount(graph, 'a.liquid')).toBe(2);
  });

  it('returns 0 for file with no callers', () => {
    const graph = mockGraph({}, { 'a.liquid': [] });
    expect(callerCount(graph, 'a.liquid')).toBe(0);
  });

  it('returns 0 when graph is null', () => {
    expect(callerCount(null, 'a.liquid')).toBe(0);
  });

  it('returns 0 when filePath is null', () => {
    const graph = mockGraph({}, {});
    expect(callerCount(graph, null)).toBe(0);
  });
});

describe('queries: isOrphan', () => {
  it('returns true for file in graph with no callers', () => {
    const graph = mockGraph(
      { 'a.liquid': { type: 'partial' } },
      { 'a.liquid': [] },
    );
    expect(isOrphan(graph, 'a.liquid')).toBe(true);
  });

  it('returns false for file with callers', () => {
    const graph = mockGraph(
      { 'a.liquid': { type: 'partial' } },
      { 'a.liquid': ['b.liquid'] },
    );
    expect(isOrphan(graph, 'a.liquid')).toBe(false);
  });

  it('returns false for file not in graph', () => {
    const graph = mockGraph({}, {});
    expect(isOrphan(graph, 'unknown.liquid')).toBe(false);
  });

  it('returns false when graph is null', () => {
    expect(isOrphan(null, 'a.liquid')).toBe(false);
  });
});

describe('queries: hasDocParams', () => {
  it('returns true when node has params array with entries', () => {
    const graph = mockGraph({ 'a.liquid': { params: ['title', 'image'] } });
    expect(hasDocParams(graph, 'a.liquid')).toBe(true);
  });

  it('returns false when node has empty params array', () => {
    const graph = mockGraph({ 'a.liquid': { params: [] } });
    expect(hasDocParams(graph, 'a.liquid')).toBe(false);
  });

  it('returns false when node has no params field', () => {
    const graph = mockGraph({ 'a.liquid': { type: 'partial' } });
    expect(hasDocParams(graph, 'a.liquid')).toBe(false);
  });

  it('returns false when node not found', () => {
    const graph = mockGraph({});
    expect(hasDocParams(graph, 'unknown.liquid')).toBe(false);
  });

  it('returns false when graph is null', () => {
    expect(hasDocParams(null, 'a.liquid')).toBe(false);
  });
});

describe('queries: classifyFileType', () => {
  const cases = [
    ['app/views/pages/index.html.liquid', 'page'],
    ['app/views/partials/card.liquid', 'partial'],
    ['app/views/layouts/main.liquid', 'layout'],
    ['app/lib/commands/blog/create.liquid', 'command'],
    ['app/lib/queries/blog/search.liquid', 'query'],
    ['app/graphql/blog/create.graphql', 'graphql'],
    ['app/schema/blog.yml', 'schema'],
    ['modules/user/form.liquid', 'module'],
    ['some/other/path.liquid', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ];

  for (const [input, expected] of cases) {
    it(`classifies ${JSON.stringify(input)} as ${expected}`, () => {
      expect(classifyFileType(input)).toBe(expected);
    });
  }
});
