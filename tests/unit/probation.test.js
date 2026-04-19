import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import { resolveProbation } from '../../src/core/case-base.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-probation-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function seedDiagnosticsAndOutcomes(store, ruleId, outcomes) {
  const windowId = store.insertWindow({
    session_id: 'sess-1',
    file: 'test.liquid',
    idx: 0,
    ts_start: '2026-04-17T10:00:00Z',
    ts_end: '2026-04-17T10:01:00Z',
  });

  for (let i = 0; i < outcomes.length; i++) {
    const fp = `fp-${ruleId}-${i}`;
    store.db.prepare(`
      INSERT INTO diagnostics (fp, template_fp, session_id, file, check_name, severity, ts, hint_rule_id, suppressed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fp, 'tpl-1', 'sess-1', 'test.liquid', 'TestCheck', 'error', '2026-04-17T10:00:00Z', ruleId, 0);

    store.insertOutcome({
      fp,
      window_id: windowId,
      outcome: outcomes[i],
      fix_applied: null,
      collateral_added: 0,
    });
  }
}

describe('J5: probation tracking — store operations', () => {
  let store;
  beforeEach(() => { store = openAnalyticsStore(tmpPath()); });
  afterEach(() => { store.close(); });

  test('recordPromotion creates a new entry', () => {
    store.recordPromotion({ rule_id: 'Test.promoted_1', check_name: 'Test', template_fp: 'tpl1' });
    const promo = store.getPromotion('Test.promoted_1');
    expect(promo).not.toBeNull();
    expect(promo.rule_id).toBe('Test.promoted_1');
    expect(promo.check_name).toBe('Test');
    expect(promo.probation).toBe(1);
    expect(promo.resolution).toBeNull();
  });

  test('getPromotionsOnProbation returns only probation=1', () => {
    store.recordPromotion({ rule_id: 'A.rule', check_name: 'A', template_fp: 'tpl-a' });
    store.recordPromotion({ rule_id: 'B.rule', check_name: 'B', template_fp: 'tpl-b' });
    store.resolvePromotion('B.rule', 'kept');

    const onProbation = store.getPromotionsOnProbation();
    expect(onProbation).toHaveLength(1);
    expect(onProbation[0].rule_id).toBe('A.rule');
  });

  test('resolvePromotion sets probation=0 and resolution', () => {
    store.recordPromotion({ rule_id: 'X.rule', check_name: 'X', template_fp: 'tpl-x' });
    store.resolvePromotion('X.rule', 'disabled');

    const promo = store.getPromotion('X.rule');
    expect(promo.probation).toBe(0);
    expect(promo.resolution).toBe('disabled');
    expect(promo.resolved_at).not.toBeNull();
  });
});

describe('J5: probation tracking — resolveProbation', () => {
  let store;
  beforeEach(() => { store = openAnalyticsStore(tmpPath()); });
  afterEach(() => { store.close(); });

  test('does not resolve when outcomes < minOutcomes', () => {
    store.recordPromotion({ rule_id: 'Test.few', check_name: 'Test', template_fp: 'tpl-1' });
    seedDiagnosticsAndOutcomes(store, 'Test.few', Array(5).fill('resolved'));

    const resolutions = resolveProbation(store, { minOutcomes: 20 });
    expect(resolutions).toHaveLength(0);

    const promo = store.getPromotion('Test.few');
    expect(promo.probation).toBe(1);
  });

  test('keeps rule with high effectiveness', () => {
    store.recordPromotion({ rule_id: 'Test.good', check_name: 'Test', template_fp: 'tpl-1' });
    const outcomes = [
      ...Array(15).fill('resolved'),
      ...Array(3).fill('unchanged'),
      ...Array(2).fill('regressed'),
    ];
    seedDiagnosticsAndOutcomes(store, 'Test.good', outcomes);

    const resolutions = resolveProbation(store, { minOutcomes: 20 });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].rule_id).toBe('Test.good');
    expect(resolutions[0].resolution).toBe('kept');
    expect(resolutions[0].effectiveness).toBeGreaterThan(0.15);
  });

  test('disables rule with low effectiveness', () => {
    store.recordPromotion({ rule_id: 'Test.bad', check_name: 'Test', template_fp: 'tpl-1' });
    const outcomes = [
      ...Array(2).fill('resolved'),
      ...Array(10).fill('unchanged'),
      ...Array(8).fill('regressed'),
    ];
    seedDiagnosticsAndOutcomes(store, 'Test.bad', outcomes);

    const resolutions = resolveProbation(store, { minOutcomes: 20 });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].rule_id).toBe('Test.bad');
    expect(resolutions[0].resolution).toBe('disabled');
    expect(resolutions[0].effectiveness).toBeLessThan(0.15);
  });

  test('skips rules already resolved (not on probation)', () => {
    store.recordPromotion({ rule_id: 'Test.done', check_name: 'Test', template_fp: 'tpl-1' });
    store.resolvePromotion('Test.done', 'kept');
    seedDiagnosticsAndOutcomes(store, 'Test.done', Array(25).fill('resolved'));

    const resolutions = resolveProbation(store, { minOutcomes: 20 });
    expect(resolutions).toHaveLength(0);
  });
});
