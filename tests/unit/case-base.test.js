import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import { retrieveCases, retrieveCasesByCheck, ruleScores, scoreRule, suggestedRules, generateRuleTemplate, synthesizeGuardPredicate } from '../../src/core/case-base.js';
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
    const wid = o.window_id ?? 1;
    const w = (outcomes.windows || []).find(w => w.id === wid);
    const session_id = o.session_id ?? w?.session_id ?? 'sess-1';
    const file = o.file ?? w?.file ?? 'test.liquid';
    store.db.prepare(`
      INSERT OR REPLACE INTO outcomes (fp, window_id, outcome, fix_applied, collateral_added, session_id, file)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(o.fp, wid, o.outcome, o.fix_applied ?? null, o.collateral_added ?? 0, session_id, file);
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

  test('excludes `${check}.unmatched` fallback rule_ids from promotion decisions (A4)', () => {
    // Fallback rule_ids set by the diagnostic pipeline don't correspond to a
    // registered rule — including them in ruleScores would feed noise into
    // syncDisabledRules and probation. Promotion view must stay clean.
    seedStore(store,
      [
        { fp: 'u1', template_fp: 'tpl1', check_name: 'OrphanCheck', hint_rule_id: 'OrphanCheck.unmatched' },
        { fp: 'u2', template_fp: 'tpl1', check_name: 'OrphanCheck', hint_rule_id: 'OrphanCheck.unmatched' },
        { fp: 'u3', template_fp: 'tpl1', check_name: 'OrphanCheck', hint_rule_id: 'OrphanCheck.unmatched' },
        { fp: 'r1', template_fp: 'tpl1', check_name: 'RealCheck', hint_rule_id: 'RealCheck.real_rule' },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'u1', outcome: 'resolved' },
          { fp: 'r1', outcome: 'resolved' },
        ],
      }
    );

    const scores = ruleScores(store, { minEmitted: 1 });
    expect(scores.map(s => s.rule_id)).toEqual(['RealCheck.real_rule']);
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

// ── Reporting baseline (`since`) ─────────────────────────────────────────
//
// case-base reporting paths (retrieveCases*, ruleScores, suggestedRules,
// synthesizeGuardPredicate) accept `opts.since`. Engine paths
// (`scoreRule`, internal `resolveProbation`) MUST NOT — verified by
// observing that scoreRule has no since parameter and engine call sites
// in server.js / server-status.js pass `since: null` explicitly.

describe('Case base — reporting baseline (`since`)', () => {
  let store, dbPath;

  const OLD = '2026-04-01T00:00:00.000Z';
  const NEW = '2026-04-30T00:00:00.000Z';
  const MID = '2026-04-15T00:00:00.000Z';

  beforeEach(() => {
    dbPath = tmpPath();
    store = openAnalyticsStore(dbPath);
  });
  afterEach(() => { store.close(); });

  function seedTwoEras() {
    // Use seedStore's default session_id 'sess-1' / file 'test.liquid' for
    // both diagnostics and the implicit window — case-base joins outcomes
    // back to diagnostics on (fp, session_id, file) so they must match.
    seedStore(store,
      [
        { fp: 'old1', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.typo', ts: OLD },
        { fp: 'old2', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.typo', ts: OLD },
        { fp: 'new1', template_fp: 'tpl1', check_name: 'UnknownFilter', hint_rule_id: 'UnknownFilter.typo', ts: NEW },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'old1', outcome: 'regressed' },
          { fp: 'old2', outcome: 'regressed' },
          { fp: 'new1', outcome: 'resolved', fix_applied: 'verbatim' },
        ],
      }
    );
  }

  test('retrieveCases: ISO since narrows the case set', () => {
    seedTwoEras();
    const all = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 1 });
    expect(all.total).toBe(3);
    const post = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 1, since: MID });
    expect(post.total).toBe(1);
  });

  test('retrieveCases: meta baseline applies when since omitted', () => {
    seedTwoEras();
    store.setBaselineTs(MID);
    const post = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 1 });
    expect(post.total).toBe(1);
    store.clearBaseline();
    const all = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 1 });
    expect(all.total).toBe(3);
  });

  test('retrieveCases: since=null bypasses meta baseline', () => {
    seedTwoEras();
    store.setBaselineTs(MID);
    const all = retrieveCases(store, 'UnknownFilter', 'tpl1', { minCases: 1, since: null });
    expect(all.total).toBe(3);
    store.clearBaseline();
  });

  test('retrieveCasesByCheck: forwards since through to retrieveCases', () => {
    seedTwoEras();
    const all = retrieveCasesByCheck(store, 'UnknownFilter', { minCases: 1 });
    expect(all[0].total).toBe(3);
    const post = retrieveCasesByCheck(store, 'UnknownFilter', { minCases: 1, since: MID });
    expect(post[0].total).toBe(1);
  });

  test('ruleScores: ISO since filters emit + outcome counts', () => {
    seedTwoEras();
    const all = ruleScores(store, { minEmitted: 1 });
    expect(all[0].emitted).toBe(3);
    expect(all[0].total_outcomes).toBe(3);

    const post = ruleScores(store, { minEmitted: 1, since: MID });
    expect(post[0].emitted).toBe(1);
    expect(post[0].total_outcomes).toBe(1);
    expect(post[0].resolved).toBe(1);
  });

  test('ruleScores: since=null is the engine-state bypass', () => {
    seedTwoEras();
    store.setBaselineTs(MID);
    // Default (meta-resolved) sees only post-baseline.
    expect(ruleScores(store, { minEmitted: 1 })[0].emitted).toBe(1);
    // Explicit bypass sees full history — this is what server.js +
    // tools/server-status.js MUST pass for auto-disable / health snapshot.
    expect(ruleScores(store, { minEmitted: 1, since: null })[0].emitted).toBe(3);
    store.clearBaseline();
  });

  test('ruleScores: meta baseline does NOT affect engine bypass call', () => {
    // Belt-and-braces: even with a baseline set, since:null returns full data.
    seedTwoEras();
    store.setBaselineTs(NEW); // narrowest possible — would hide everything
    const out = ruleScores(store, { minEmitted: 1, since: null });
    expect(out[0].emitted).toBe(3);
    store.clearBaseline();
  });

  test('suggestedRules: ISO since narrows candidate templates', () => {
    // Seed a template whose post-baseline emits don't reach minCases — should
    // disappear from suggestions when since=MID.
    seedStore(store,
      [
        { fp: 'old-1', template_fp: 'tpl-old', check_name: 'OldOnlyCheck', hint_rule_id: 'unknown', ts: OLD },
        { fp: 'old-2', template_fp: 'tpl-old', check_name: 'OldOnlyCheck', hint_rule_id: 'unknown', ts: OLD },
        { fp: 'old-3', template_fp: 'tpl-old', check_name: 'OldOnlyCheck', hint_rule_id: 'unknown', ts: OLD },
        { fp: 'old-4', template_fp: 'tpl-old', check_name: 'OldOnlyCheck', hint_rule_id: 'unknown', ts: OLD },
        { fp: 'old-5', template_fp: 'tpl-old', check_name: 'OldOnlyCheck', hint_rule_id: 'unknown', ts: OLD },
      ],
      {
        windows: [{ id: 1 }],
        outcomes: [
          { fp: 'old-1', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'old-2', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'old-3', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'old-4', outcome: 'resolved', fix_applied: 'verbatim' },
          { fp: 'old-5', outcome: 'resolved', fix_applied: 'verbatim' },
        ],
      }
    );

    const all = suggestedRules(store, new Set(), { minCases: 5, minResolutionRate: 0.5 });
    expect(all.find(s => s.check === 'OldOnlyCheck')).toBeDefined();

    const post = suggestedRules(store, new Set(), { minCases: 5, minResolutionRate: 0.5, since: MID });
    expect(post.find(s => s.check === 'OldOnlyCheck')).toBeUndefined();
  });

  test('synthesizeGuardPredicate: ISO since narrows the inferred file_type set', () => {
    // 5+ pages (would induce file_type=pages), then 0 post-baseline → no guard.
    const diags = [];
    for (let i = 0; i < 6; i++) {
      diags.push({
        fp: `g-${i}`, template_fp: 'tplG', check_name: 'GuardCheck',
        file: `app/views/pages/p${i}.liquid`, ts: OLD, hint_rule_id: 'GuardCheck.r',
      });
    }
    seedStore(store, diags, { windows: [], outcomes: [] });

    // classifyFileType returns the singular form ('page', not 'pages').
    const all = synthesizeGuardPredicate(store, 'GuardCheck', 'tplG', { minSamples: 5 });
    expect(all.file_type).toBe('page');

    const post = synthesizeGuardPredicate(store, 'GuardCheck', 'tplG', { minSamples: 5, since: MID });
    expect(post.file_type).toBeUndefined();
  });

  test('scoreRule: NO since parameter — always sees full history', () => {
    // scoreRule's signature deliberately has no since param. Even after the
    // operator sets a baseline, scoreRule sees the full case set so live
    // confidence-adjustment never deteriorates from a narrow window.
    seedTwoEras();
    store.setBaselineTs(NEW);
    const adj = scoreRule(store, 'UnknownFilter.typo', 'tpl1');
    expect(adj).not.toBeNull();
    // 3 cases, 1 resolved, 2 regressed → regression rate 0.67 → harmful adjustment
    expect(adj.adjustment).toBeLessThan(0);
    store.clearBaseline();
  });
});
