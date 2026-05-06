import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { registerRules, clearRules, runRules } from '../../src/core/rules/engine.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';
import { setEngineMode, resetEngineMode } from '../../src/core/engine-mode.js';

function buildMinimalGraph() {
  return buildFactGraph({
    pages: {}, partials: {}, commands: {}, queries: {},
    graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
  });
}

const testRule = {
  id: 'TestCheck.basic',
  check: 'TestCheck',
  priority: 10,
  when: () => true,
  apply: () => ({
    rule_id: 'TestCheck.basic',
    hint_md: 'test hint',
    fixes: [],
    confidence: 0.7,
  }),
};

describe('Phase H: Case-base scoring in rule engine', () => {
  beforeEach(() => {
    resetEngineMode();
    setEngineMode('adaptive');
    clearRules();
    registerRules([testRule]);
  });
  afterEach(() => { resetEngineMode(); });

  it('runs without analytics store (no scoring applied)', () => {
    const graph = buildMinimalGraph();
    const diag = { check: 'TestCheck', params: {}, message: 'test', file: 'test.liquid', line: 1 };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.confidence).toBe(0.7);
    expect(result.case_base_signal).toBeUndefined();
  });

  it('runs with analytics store but no template_fp (no scoring)', () => {
    const graph = buildMinimalGraph();
    const mockStore = {};
    const diag = { check: 'TestCheck', params: {}, message: 'test', file: 'test.liquid', line: 1 };
    const result = runRules(diag, { graph, analyticsStore: mockStore });
    expect(result).not.toBeNull();
    expect(result.confidence).toBe(0.7);
    expect(result.case_base_signal).toBeUndefined();
  });

  it('applies positive adjustment from case-base scoring', () => {
    const graph = buildMinimalGraph();
    const mockStore = {
      queryOne: (sql, params) => {
        if (sql.includes('emitted')) return { emitted: 10 };
        return null;
      },
      query: (sql, params) => {
        return [
          { outcome: 'resolved', cnt: 8 },
          { outcome: 'unchanged', cnt: 2 },
        ];
      },
    };
    const diag = {
      check: 'TestCheck', params: {}, message: 'test',
      file: 'test.liquid', line: 1, template_fp: 'abc123',
    };
    const result = runRules(diag, { graph, analyticsStore: mockStore });
    expect(result).not.toBeNull();
    expect(result.confidence).toBeCloseTo(0.8, 10);
    expect(result.case_base_signal).toBeDefined();
    expect(result.case_base_signal.adjustment).toBe(0.1);
    expect(result.case_base_signal.reason).toContain('resolution rate');
  });

  it('applies negative adjustment for high regression rate', () => {
    const graph = buildMinimalGraph();
    const mockStore = {
      queryOne: (sql, params) => {
        if (sql.includes('emitted')) return { emitted: 10 };
        return null;
      },
      query: (sql, params) => {
        return [
          { outcome: 'resolved', cnt: 2 },
          { outcome: 'regressed', cnt: 5 },
          { outcome: 'unchanged', cnt: 3 },
        ];
      },
    };
    const diag = {
      check: 'TestCheck', params: {}, message: 'test',
      file: 'test.liquid', line: 1, template_fp: 'abc123',
    };
    const result = runRules(diag, { graph, analyticsStore: mockStore });
    expect(result).not.toBeNull();
    expect(result.confidence).toBeCloseTo(0.5, 10);
    expect(result.case_base_signal).toBeDefined();
    expect(result.case_base_signal.adjustment).toBe(-0.2);
    expect(result.case_base_signal.reason).toContain('regression rate');
  });

  it('clamps confidence to [0, 1] range', () => {
    clearRules();
    registerRules([{
      ...testRule,
      apply: () => ({ rule_id: 'TestCheck.basic', hint_md: 'test', fixes: [], confidence: 0.95 }),
    }]);

    const graph = buildMinimalGraph();
    const mockStore = {
      queryOne: () => ({ emitted: 10 }),
      query: () => [{ outcome: 'resolved', cnt: 8 }, { outcome: 'unchanged', cnt: 2 }],
    };
    const diag = {
      check: 'TestCheck', params: {}, message: 'test',
      file: 'test.liquid', line: 1, template_fp: 'abc123',
    };
    const result = runRules(diag, { graph, analyticsStore: mockStore });
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBe(1); // 0.95 + 0.1 clamped
  });

  it('survives analytics store errors gracefully', () => {
    const graph = buildMinimalGraph();
    const brokenStore = {
      queryOne: () => { throw new Error('db locked'); },
      query: () => { throw new Error('db locked'); },
    };
    const diag = {
      check: 'TestCheck', params: {}, message: 'test',
      file: 'test.liquid', line: 1, template_fp: 'abc123',
    };
    const result = runRules(diag, { graph, analyticsStore: brokenStore });
    expect(result).not.toBeNull();
    expect(result.confidence).toBe(0.7); // original, no adjustment
    expect(result.case_base_signal).toBeUndefined();
  });

  it('applies scoring in multiMatch mode', () => {
    const graph = buildMinimalGraph();
    const mockStore = {
      queryOne: () => ({ emitted: 10 }),
      query: () => [{ outcome: 'resolved', cnt: 8 }, { outcome: 'unchanged', cnt: 2 }],
    };
    const diag = {
      check: 'TestCheck', params: {}, message: 'test',
      file: 'test.liquid', line: 1, template_fp: 'abc123',
    };
    const results = runRules(diag, { graph, analyticsStore: mockStore }, { multiMatch: true });
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBeCloseTo(0.8, 10);
    expect(results[0].case_base_signal).toBeDefined();
  });
});
