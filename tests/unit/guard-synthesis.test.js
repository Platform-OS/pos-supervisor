import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import { synthesizeGuardPredicate, generateRuleTemplate } from '../../src/core/case-base.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-guard-synth-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function seedDiagnostics(store, rows) {
  for (const d of rows) {
    store.db.prepare(`
      INSERT INTO diagnostics (fp, template_fp, session_id, file, check_name, severity, ts, hint_rule_id, suppressed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.fp, d.template_fp ?? 'tpl1', d.session_id ?? 'sess-1',
      d.file ?? 'app/views/pages/index.html.liquid',
      d.check_name ?? 'TestCheck', d.severity ?? 'error',
      d.ts ?? '2026-04-20T10:00:00Z', d.hint_rule_id ?? null, d.suppressed ?? 0,
    );
  }
}

function seedEvents(store, rows) {
  for (const e of rows) {
    const payload = {
      fp: e.fp,
      template_fp: e.template_fp ?? 'tpl1',
      file: e.file ?? 'app/views/pages/index.html.liquid',
      check: e.check ?? 'TestCheck',
      ...(e.params && Object.keys(e.params).length > 0 ? { params: e.params } : {}),
    };
    store.db.prepare(`
      INSERT INTO events (session_id, kind, ts, payload)
      VALUES (?, ?, ?, ?)
    `).run(e.session_id ?? 'sess-1', 'validator_emit', e.ts ?? '2026-04-20T10:00:00Z', JSON.stringify(payload));
  }
}

describe('synthesizeGuardPredicate', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  test('returns empty when object with no data', () => {
    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when).toEqual({});
  });

  test('returns empty when below minSamples', () => {
    seedDiagnostics(store, [
      { fp: 'fp1', file: 'app/views/pages/a.liquid' },
      { fp: 'fp2', file: 'app/views/pages/b.liquid' },
    ]);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1', { minSamples: 5 });
    expect(when).toEqual({});
  });

  test('infers file_type when ≥80% share type', () => {
    seedDiagnostics(store, [
      { fp: 'fp1', file: 'app/views/pages/a.liquid' },
      { fp: 'fp2', file: 'app/views/pages/b.liquid' },
      { fp: 'fp3', file: 'app/views/pages/c.liquid' },
      { fp: 'fp4', file: 'app/views/pages/d.liquid' },
      { fp: 'fp5', file: 'app/views/partials/e.liquid' },
    ]);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when.file_type).toBe('page');
  });

  test('skips file_type when no dominant type', () => {
    seedDiagnostics(store, [
      { fp: 'fp1', file: 'app/views/pages/a.liquid' },
      { fp: 'fp2', file: 'app/views/pages/b.liquid' },
      { fp: 'fp3', file: 'app/views/partials/c.liquid' },
      { fp: 'fp4', file: 'app/views/partials/d.liquid' },
      { fp: 'fp5', file: 'app/lib/commands/e.liquid' },
    ]);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when.file_type).toBeUndefined();
  });

  test('skips file_type=unknown even if dominant', () => {
    seedDiagnostics(store, [
      { fp: 'fp1', file: 'other/a.liquid' },
      { fp: 'fp2', file: 'other/b.liquid' },
      { fp: 'fp3', file: 'other/c.liquid' },
      { fp: 'fp4', file: 'other/d.liquid' },
      { fp: 'fp5', file: 'other/e.liquid' },
    ]);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when.file_type).toBeUndefined();
  });

  test('infers param_equals when ≥90% identical', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        fp: `fp${i}`,
        check: 'UndefinedObject',
        params: { variable: i < 9 ? 'product' : 'collection' },
      });
    }
    seedDiagnostics(store, events.map(e => ({ fp: e.fp, check_name: 'UndefinedObject' })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'UndefinedObject', 'tpl1');
    expect(when.param_equals).toEqual({ variable: 'product' });
  });

  test('skips param_equals when below 90% threshold', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        fp: `fp${i}`,
        check: 'UndefinedObject',
        params: { variable: i < 8 ? 'product' : 'collection' },
      });
    }
    seedDiagnostics(store, events.map(e => ({ fp: e.fp, check_name: 'UndefinedObject' })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'UndefinedObject', 'tpl1');
    expect(when.param_equals).toBeUndefined();
  });

  test('infers param_startsWith when ≥80% share prefix', () => {
    const events = [
      { fp: 'fp0', check: 'MissingPartial', params: { partial: 'modules/core/widget' } },
      { fp: 'fp1', check: 'MissingPartial', params: { partial: 'modules/core/header' } },
      { fp: 'fp2', check: 'MissingPartial', params: { partial: 'modules/core/footer' } },
      { fp: 'fp3', check: 'MissingPartial', params: { partial: 'modules/core/sidebar' } },
      { fp: 'fp4', check: 'MissingPartial', params: { partial: 'products/card' } },
    ];
    seedDiagnostics(store, events.map(e => ({ fp: e.fp, check_name: 'MissingPartial' })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'MissingPartial', 'tpl1');
    expect(when.param_startsWith).toBeDefined();
    expect(when.param_startsWith.partial).toBe('modules/core/');
    expect(when.param_equals).toBeUndefined();
  });

  test('infers param_contains when ≥80% contain substring', () => {
    const events = [
      { fp: 'fp0', check: 'UnknownFilter', params: { filter: 'asset_img_url' } },
      { fp: 'fp1', check: 'UnknownFilter', params: { filter: 'product_img_url' } },
      { fp: 'fp2', check: 'UnknownFilter', params: { filter: 'collection_img_url' } },
      { fp: 'fp3', check: 'UnknownFilter', params: { filter: 'variant_img_url' } },
      { fp: 'fp4', check: 'UnknownFilter', params: { filter: 'img_url' } },
    ];
    seedDiagnostics(store, events.map(e => ({ fp: e.fp, check_name: 'UnknownFilter' })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'UnknownFilter', 'tpl1');
    expect(when.param_contains).toBeDefined();
    expect(when.param_contains.filter).toBe('img_url');
  });

  test('combines file_type and param guards', () => {
    const events = [];
    for (let i = 0; i < 6; i++) {
      events.push({
        fp: `fp${i}`,
        check: 'UndefinedObject',
        file: `app/views/pages/page${i}.liquid`,
        params: { variable: 'product' },
      });
    }
    seedDiagnostics(store, events.map(e => ({ fp: e.fp, check_name: 'UndefinedObject', file: e.file })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'UndefinedObject', 'tpl1');
    expect(when.file_type).toBe('page');
    expect(when.param_equals).toEqual({ variable: 'product' });
  });

  test('works with file_type only when no params in events', () => {
    seedDiagnostics(store, [
      { fp: 'fp1', file: 'app/views/partials/a.liquid' },
      { fp: 'fp2', file: 'app/views/partials/b.liquid' },
      { fp: 'fp3', file: 'app/views/partials/c.liquid' },
      { fp: 'fp4', file: 'app/views/partials/d.liquid' },
      { fp: 'fp5', file: 'app/views/partials/e.liquid' },
    ]);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when.file_type).toBe('partial');
    expect(when.param_equals).toBeUndefined();
    expect(when.param_startsWith).toBeUndefined();
    expect(when.param_contains).toBeUndefined();
  });

  test('respects minSamples for param analysis', () => {
    const events = [
      { fp: 'fp0', check: 'TestCheck', params: { key: 'same' } },
      { fp: 'fp1', check: 'TestCheck', params: { key: 'same' } },
      { fp: 'fp2', check: 'TestCheck', params: { key: 'same' } },
    ];
    seedDiagnostics(store, events.map(e => ({ fp: e.fp })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1', { minSamples: 5 });
    expect(when.param_equals).toBeUndefined();
  });

  test('ignores suppressed diagnostics for file_type', () => {
    seedDiagnostics(store, [
      { fp: 'fp1', file: 'app/views/pages/a.liquid', suppressed: 0 },
      { fp: 'fp2', file: 'app/views/pages/b.liquid', suppressed: 0 },
      { fp: 'fp3', file: 'app/views/pages/c.liquid', suppressed: 0 },
      { fp: 'fp4', file: 'app/views/pages/d.liquid', suppressed: 0 },
      { fp: 'fp5', file: 'app/views/pages/e.liquid', suppressed: 0 },
      { fp: 'fp6', file: 'app/lib/commands/x.liquid', suppressed: 1 },
      { fp: 'fp7', file: 'app/lib/commands/y.liquid', suppressed: 1 },
      { fp: 'fp8', file: 'app/lib/commands/z.liquid', suppressed: 1 },
    ]);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when.file_type).toBe('page');
  });

  test('prefers param_equals over param_startsWith', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({ fp: `fp${i}`, check: 'TestCheck', params: { key: 'exactly_the_same' } });
    }
    seedDiagnostics(store, events.map(e => ({ fp: e.fp })));
    seedEvents(store, events);

    const when = synthesizeGuardPredicate(store, 'TestCheck', 'tpl1');
    expect(when.param_equals).toEqual({ key: 'exactly_the_same' });
    expect(when.param_startsWith).toBeUndefined();
    expect(when.param_contains).toBeUndefined();
  });
});

describe('generateRuleTemplate with guards', () => {
  const baseSuggestion = {
    check: 'UnknownFilter',
    template_fp: 'abcdef1234567890',
    resolution_rate: 0.85,
    total_outcomes: 20,
    sample_file: 'app/views/partials/test.liquid',
  };

  test('renders TODO when no guards', () => {
    const template = generateRuleTemplate(baseSuggestion);
    expect(template).toContain('TODO: Add guard predicate');
    expect(template).toContain('return true;');
  });

  test('renders file_type guard', () => {
    const template = generateRuleTemplate(baseSuggestion, { file_type: 'page' });
    expect(template).toContain("diag.file?.includes(\"/pages/\")");
    expect(template).not.toContain('TODO: Add guard predicate');
  });

  test('renders param_equals guard', () => {
    const template = generateRuleTemplate(baseSuggestion, { param_equals: { filter: 'asset_url' } });
    expect(template).toContain("diag.params?.filter === \"asset_url\"");
  });

  test('renders param_startsWith guard', () => {
    const template = generateRuleTemplate(baseSuggestion, { param_startsWith: { partial: 'modules/' } });
    expect(template).toContain("diag.params?.partial?.startsWith(\"modules/\")");
  });

  test('renders param_contains guard', () => {
    const template = generateRuleTemplate(baseSuggestion, { param_contains: { filter: 'img_url' } });
    expect(template).toContain("diag.params?.filter?.includes(\"img_url\")");
  });

  test('renders combined guards with &&', () => {
    const guards = {
      file_type: 'partial',
      param_equals: { variable: 'product' },
    };
    const template = generateRuleTemplate(baseSuggestion, guards);
    expect(template).toContain('&&');
    expect(template).toContain("diag.params?.variable === \"product\"");
    expect(template).toContain("diag.file?.includes(\"/partials/\")");
  });

  test('preserves existing template fields', () => {
    const template = generateRuleTemplate(baseSuggestion, { file_type: 'page' });
    expect(template).toContain("id: 'UnknownFilter.case_abcdef12'");
    expect(template).toContain("check: 'UnknownFilter'");
    expect(template).toContain('confidence: 0.85');
    expect(template).toContain('85% across 20 outcomes');
  });
});
