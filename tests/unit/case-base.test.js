import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import { retrieveCases, retrieveCasesByCheck, ruleScores, scoreRule, suggestedRules, generateRuleTemplate } from '../../src/core/case-base.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-case-base-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function seedStore(store, diagnostics, outcomes) {
  for (const d of diagnostics) {
    store.db.prepare(`
      INSERT INTO diagnostics (fp, template_fp, session_id, file, check_name, severity, ts, hint_rule_id, content_hash, suppressed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.fp, d.template_fp ?? null, d.session_id ?? 'sess-1', d.file ?? 'test.liquid',
      d.check_name, d.severity ?? 'error', d.ts ?? '2026-04-17T10:00:00Z',
      d.hint_rule_id ?? null, d.content_hash ?? null, d.suppressed ?? 0);
  }

  for (const w of (outcomes.windows || [])) {
    store.db.prepare(`
      INSERT INTO windows (id, session_id, file, idx, ts_start, ts_end)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(w.id, w.session_id ?? 'sess-1', w.file ?? 'test.liquid', w.idx ?? 0,
      w.ts_start ?? '2026-04-17T10:00:00Z', w.ts_end ?? '2026-04-17T10:01:00Z');
  }

  for (const o of (outcomes.outcomes || [])) {
    store.db.prepare(`
      INSERT INTO outcomes (fp, window_id, outcome, fix_applied, collateral_added)
      VALUES (?, ?, ?, ?, ?)
    `).run(o.fp, o.window_id ?? 1, o.outcome, o.fix_applied ?? null, o.collateral_added ?? 0);
  }
}

describe('Case base — F1: retrieveCases', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  test('returns empty when no diagnostics match', () => {
    const result = retrieveCases(store, 'UnknownFilter', 'nonexistent');
    expect(result.total).toBe(0);
    expect(result.cases).toEqual([]);
  });

  test('aggregates outcomes by fix_applied', () => {
    seedStore(store,
      [
        { fp: 'fp1', template_fp: 'tpl1', check_name: 'UnknownFilter' },
        { fp: 'fp2', template_fp: 'tpl1', check_name: 'UnknownFilter' },
        { fp: 'fp3', template_fp: 'tpl1', check_name: 'UnknownFilter' },
        { fp: 'fp4', template_fp: 'tpl1', check_name: 'UnknownFilter' },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'fp1', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp2', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp3', outcome: 'regressed', fix_applied: 'verbatim' },
          { fp: 'fp4', outcome: 'unchanged', fix_applied: null },
        ],
      }
    );

    const result = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 1 });
    expect(result.total).toBe(4);
    expect(result.cases.length).toBe(2);

    const verbatim = result.cases.find(c => c.fix_applied === 'verbatim');
    expect(verbatim.resolved).toBe(2);
    expect(verbatim.regressed).toBe(1);
    expect(verbatim.resolution_rate).toBeCloseTo(2 / 3, 2);
  });

  test('filters by minCases', () => {
    seedStore(store,
      [
        { fp: 'fp1', template_fp: 'tpl1', check_name: 'UnknownFilter' },
        { fp: 'fp2', template_fp: 'tpl1', check_name: 'UnknownFilter' },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'fp1', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp2', outcome: 'resolved', fix_applied: 'partial' },
        ],
      }
    );

    const result = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 3 });
    expect(result.cases.length).toBe(0);
  });

  test('sorts by resolution rate descending', () => {
    seedStore(store,
      Array.from({ length: 6 }, (_, i) => ({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'Check1' })),
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'fp0', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp1', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp2', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp3', outcome: 'resolved', fix_applied: 'partial' },
          { fp: 'fp4', outcome: 'regressed', fix_applied: 'partial' },
          { fp: 'fp5', outcome: 'regressed', fix_applied: 'partial' },
        ],
      }
    );

    const result = retrieveCases(store, 'Check1', 'tpl1', { minCases: 1 });
    expect(result.cases[0].fix_applied).toBe('verbatim');
    expect(result.cases[0].resolution_rate).toBe(1);
    expect(result.cases[1].fix_applied).toBe('partial');
    expect(result.cases[1].resolution_rate).toBeCloseTo(1 / 3, 2);
  });
});

describe('Case base — F1: retrieveCasesByCheck', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  test('returns cases grouped by template_fp', () => {
    seedStore(store,
      [
        { fp: 'fp1', template_fp: 'tplA', check_name: 'Check1' },
        { fp: 'fp2', template_fp: 'tplA', check_name: 'Check1' },
        { fp: 'fp3', template_fp: 'tplA', check_name: 'Check1' },
        { fp: 'fp4', template_fp: 'tplB', check_name: 'Check1' },
        { fp: 'fp5', template_fp: 'tplB', check_name: 'Check1' },
        { fp: 'fp6', template_fp: 'tplB', check_name: 'Check1' },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'fp1', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp2', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp3', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp4', outcome: 'unchanged' },
          { fp: 'fp5', outcome: 'unchanged' },
          { fp: 'fp6', outcome: 'unchanged' },
        ],
      }
    );

    const results = retrieveCasesByCheck(store, 'Check1', { minCases: 1 });
    expect(results.length).toBe(2);
    expect(results[0].template_fp).toBeDefined();
    expect(results[1].template_fp).toBeDefined();
  });
});

describe('Case base — F2: ruleScores', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  test('computes per-rule stats', () => {
    seedStore(store,
      [
        { fp: 'fp1', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.shopify_filter' },
        { fp: 'fp2', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.shopify_filter' },
        { fp: 'fp3', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.shopify_filter' },
        { fp: 'fp4', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.shopify_filter' },
        { fp: 'fp5', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.shopify_filter' },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'fp1', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp2', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'fp3', outcome: 'resolved' },
          { fp: 'fp4', outcome: 'regressed' },
          { fp: 'fp5', outcome: 'unchanged' },
        ],
      }
    );

    const scores = ruleScores(store, { minEmitted: 1 });
    expect(scores.length).toBe(1);

    const s = scores[0];
    expect(s.rule_id).toBe('UnknownFilter.shopify_filter');
    expect(s.emitted).toBe(5);
    expect(s.resolved).toBe(3);
    expect(s.regressed).toBe(1);
    expect(s.adopted).toBe(2);
    expect(s.resolution_rate).toBeCloseTo(0.6, 2);
    expect(s.regression_rate).toBeCloseTo(0.2, 2);
    expect(s.effectiveness).toBeCloseTo(0.4, 2);
    expect(s.disabled).toBe(false);
  });

  test('marks rules below threshold as disabled', () => {
    const diags = [];
    const outs = [];
    for (let i = 0; i < 10; i++) {
      diags.push({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'BadCheck', hint_rule_id: 'BadCheck.bad_rule' });
      outs.push({ fp: `fp${i}`, outcome: i < 1 ? 'resolved' : 'regressed' });
    }

    seedStore(store, diags, { windows: [{ id: 1 }], outcomes: outs });

    const scores = ruleScores(store, { minEmitted: 1 });
    expect(scores.length).toBe(1);
    expect(scores[0].disabled).toBe(true);
    expect(scores[0].effectiveness).toBeLessThan(RULE_DISABLE_THRESHOLD());
  });

  test('excludes rules below minEmitted', () => {
    seedStore(store,
      [{ fp: 'fp1', template_fp: 'tpl1', check_name: 'Check1', hint_rule_id: 'Check1.rule1' }],
      { windows: [{ id: 1 }], outcomes: [{ fp: 'fp1', outcome: 'resolved' }] }
    );

    const scores = ruleScores(store, { minEmitted: 5 });
    expect(scores.length).toBe(0);
  });
});

describe('Case base — F2: scoreRule', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  test('returns null with insufficient data', () => {
    const result = scoreRule(store, 'SomeRule', 'someTpl');
    expect(result).toBeNull();
  });

  test('returns positive adjustment for high resolution', () => {
    const diags = [];
    const outs = [];
    for (let i = 0; i < 5; i++) {
      diags.push({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'Check1', hint_rule_id: 'Check1.rule1' });
      outs.push({ fp: `fp${i}`, outcome: 'resolved' });
    }

    seedStore(store, diags, { windows: [{ id: 1 }], outcomes: outs });

    const result = scoreRule(store, 'Check1.rule1', 'tpl1');
    expect(result).not.toBeNull();
    expect(result.adjustment).toBe(0.1);
  });

  test('returns negative adjustment for high regression', () => {
    const diags = [];
    const outs = [];
    for (let i = 0; i < 5; i++) {
      diags.push({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'Check1', hint_rule_id: 'Check1.rule1' });
      outs.push({ fp: `fp${i}`, outcome: i < 2 ? 'resolved' : 'regressed' });
    }

    seedStore(store, diags, { windows: [{ id: 1 }], outcomes: outs });

    const result = scoreRule(store, 'Check1.rule1', 'tpl1');
    expect(result).not.toBeNull();
    expect(result.adjustment).toBe(-0.2);
  });
});

describe('Case base — F3: suggestedRules', () => {
  let store, dbPath;

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  test('identifies diagnostics without rules but with clear signal', () => {
    const diags = [];
    const outs = [];
    for (let i = 0; i < 6; i++) {
      diags.push({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'NoRuleCheck', hint_rule_id: 'unknown' });
      outs.push({ fp: `fp${i}`, outcome: 'resolved' });
    }

    seedStore(store, diags, { windows: [{ id: 1 }], outcomes: outs });

    const suggestions = suggestedRules(store, new Set(), { minCases: 3, minResolutionRate: 0.5 });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].check).toBe('NoRuleCheck');
    expect(suggestions[0].resolution_rate).toBe(1);
  });

  test('excludes diagnostics that already have rules', () => {
    const diags = [];
    const outs = [];
    for (let i = 0; i < 6; i++) {
      diags.push({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'RuledCheck', hint_rule_id: 'RuledCheck.rule1' });
      outs.push({ fp: `fp${i}`, outcome: 'resolved' });
    }

    seedStore(store, diags, { windows: [{ id: 1 }], outcomes: outs });

    const suggestions = suggestedRules(store, new Set(), { minCases: 3 });
    expect(suggestions.length).toBe(0);
  });

  test('excludes low resolution rate', () => {
    const diags = [];
    const outs = [];
    for (let i = 0; i < 6; i++) {
      diags.push({ fp: `fp${i}`, template_fp: 'tpl1', check_name: 'LowResCheck', hint_rule_id: 'unknown' });
      outs.push({ fp: `fp${i}`, outcome: i < 1 ? 'resolved' : 'unchanged' });
    }

    seedStore(store, diags, { windows: [{ id: 1 }], outcomes: outs });

    const suggestions = suggestedRules(store, new Set(), { minCases: 3, minResolutionRate: 0.5 });
    expect(suggestions.length).toBe(0);
  });
});

describe('Case base — F3: generateRuleTemplate', () => {
  test('produces valid JS code template', () => {
    const suggestion = {
      check: 'UnknownFilter',
      template_fp: 'abcdef1234567890',
      resolution_rate: 0.85,
      total_outcomes: 20,
      sample_file: 'app/views/partials/test.liquid',
    };

    const template = generateRuleTemplate(suggestion);
    expect(template).toContain("id: 'UnknownFilter.case_abcdef12'");
    expect(template).toContain("check: 'UnknownFilter'");
    expect(template).toContain('confidence: 0.85');
    expect(template).toContain('85% across 20 outcomes');
    expect(template).toContain('Never auto-merge');
  });
});

function RULE_DISABLE_THRESHOLD() { return 0.15; }
