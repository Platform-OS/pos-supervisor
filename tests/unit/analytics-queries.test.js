import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import {
  betaPosterior,
  checkScorecards,
  toolSequenceBigrams,
  sessionSummaries,
  recommendations,
} from '../../src/core/analytics-queries.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-queries-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function emitEvent(store, sessionId, fp, check, ts = '2026-04-17T10:00:00Z') {
  store.ingestEvent({
    v: 1, session_id: sessionId, ts, kind: 'validator_emit',
    fp, file: 'app/views/pages/index.html.liquid',
    hint_rule_id: check, proposed_fixes: [],
  });
}

function toolCallEvent(store, sessionId, tool, ts = '2026-04-17T10:00:00Z') {
  store.ingestEvent({
    v: 1, session_id: sessionId, ts, kind: 'tool_call',
    tool, duration_ms: 100, success: true,
  });
}

let store;
let dbPath;

beforeEach(() => {
  dbPath = tmpPath();
  store = openAnalyticsStore(dbPath);
});

afterEach(() => {
  try { store.close(); } catch {}
  try { rmSync(dbPath, { force: true }); } catch {}
  try { rmSync(dbPath + '-wal', { force: true }); } catch {}
  try { rmSync(dbPath + '-shm', { force: true }); } catch {}
});

describe('betaPosterior', () => {
  test('uniform prior with no data returns ~0.5', () => {
    const { mean } = betaPosterior(0, 0);
    expect(mean).toBeCloseTo(0.5, 2);
  });

  test('all successes → high mean', () => {
    const { mean, lower95 } = betaPosterior(20, 20);
    expect(mean).toBeGreaterThan(0.85);
    expect(lower95).toBeGreaterThan(0.7);
  });

  test('no successes → low mean', () => {
    const { mean, upper95 } = betaPosterior(0, 20);
    expect(mean).toBeLessThan(0.15);
    expect(upper95).toBeLessThan(0.3);
  });

  test('50/50 data → mean near 0.5', () => {
    const { mean } = betaPosterior(50, 100);
    expect(mean).toBeCloseTo(0.5, 1);
  });

  test('confidence interval narrows with more data', () => {
    const small = betaPosterior(5, 10);
    const large = betaPosterior(50, 100);
    const smallWidth = small.upper95 - small.lower95;
    const largeWidth = large.upper95 - large.lower95;
    expect(largeWidth).toBeLessThan(smallWidth);
  });
});

describe('checkScorecards', () => {
  test('returns empty for insufficient data', () => {
    for (let i = 0; i < 5; i++) {
      emitEvent(store, 's1', `fp${i}`, 'MissingPartial', `2026-04-17T10:0${i}:00Z`);
    }
    const cards = checkScorecards(store, { minCohort: 10 });
    expect(cards).toHaveLength(0);
  });

  test('returns scorecard when cohort met', () => {
    for (let i = 0; i < 12; i++) {
      emitEvent(store, 's1', `fp${i}`, 'MissingPartial', `2026-04-17T10:${String(i).padStart(2, '0')}:00Z`);
    }
    const cards = checkScorecards(store, { minCohort: 10 });
    expect(cards).toHaveLength(1);
    expect(cards[0].check).toBe('MissingPartial');
    expect(cards[0].emitted).toBe(12);
  });

  test('includes outcome rates when outcomes exist', () => {
    for (let i = 0; i < 15; i++) {
      emitEvent(store, 's1', `fp${i}`, 'UndefinedObject', `2026-04-17T10:${String(i).padStart(2, '0')}:00Z`);
    }

    const windowId = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:15:00Z',
    });

    for (let i = 0; i < 10; i++) {
      store.insertOutcome({
        fp: `fp${i}`, window_id: windowId,
        outcome: i < 7 ? 'resolved' : 'unchanged',
      });
    }

    const cards = checkScorecards(store, { minCohort: 10 });
    expect(cards).toHaveLength(1);
    expect(cards[0].resolution_rate.mean).toBeGreaterThan(0.5);
    expect(cards[0].sample_size).toBe(10);
  });

  test('filters by sessionId', () => {
    for (let i = 0; i < 12; i++) {
      emitEvent(store, 's1', `a${i}`, 'CheckA', `2026-04-17T10:${String(i).padStart(2, '0')}:00Z`);
    }
    for (let i = 0; i < 12; i++) {
      emitEvent(store, 's2', `b${i}`, 'CheckA', `2026-04-17T11:${String(i).padStart(2, '0')}:00Z`);
    }

    const allCards = checkScorecards(store, { minCohort: 10 });
    expect(allCards).toHaveLength(1);
    expect(allCards[0].emitted).toBe(24);

    const s1Cards = checkScorecards(store, { minCohort: 10, sessionId: 's1' });
    expect(s1Cards).toHaveLength(1);
    expect(s1Cards[0].emitted).toBe(12);
  });
});

describe('toolSequenceBigrams', () => {
  test('computes bigrams from tool calls', () => {
    toolCallEvent(store, 's1', 'project_map', '2026-04-17T10:00:00Z');
    toolCallEvent(store, 's1', 'scaffold', '2026-04-17T10:01:00Z');
    toolCallEvent(store, 's1', 'validate_intent', '2026-04-17T10:02:00Z');
    toolCallEvent(store, 's1', 'validate_code', '2026-04-17T10:03:00Z');
    toolCallEvent(store, 's1', 'validate_code', '2026-04-17T10:04:00Z');

    const bigrams = toolSequenceBigrams(store, { sessionId: 's1' });
    expect(bigrams.length).toBeGreaterThan(0);

    const pmScaffold = bigrams.find(b => b.bigram[0] === 'project_map' && b.bigram[1] === 'scaffold');
    expect(pmScaffold).toBeDefined();
    expect(pmScaffold.count).toBe(1);
    expect(pmScaffold.confidence).toBeGreaterThan(0);
  });

  test('returns empty for < 2 calls', () => {
    toolCallEvent(store, 's1', 'validate_code', '2026-04-17T10:00:00Z');
    expect(toolSequenceBigrams(store, { sessionId: 's1' })).toHaveLength(0);
  });

  test('repeated sequences have higher counts', () => {
    for (let i = 0; i < 5; i++) {
      toolCallEvent(store, 's1', 'validate_code', `2026-04-17T10:${String(i * 2).padStart(2, '0')}:00Z`);
      toolCallEvent(store, 's1', 'validate_code', `2026-04-17T10:${String(i * 2 + 1).padStart(2, '0')}:00Z`);
    }
    const bigrams = toolSequenceBigrams(store, { sessionId: 's1' });
    const vcVc = bigrams.find(b => b.bigram[0] === 'validate_code' && b.bigram[1] === 'validate_code');
    expect(vcVc).toBeDefined();
    expect(vcVc.count).toBeGreaterThanOrEqual(5);
  });
});

describe('sessionSummaries', () => {
  test('returns summary per session', () => {
    store.ingestEvent({
      v: 1, session_id: 's1', ts: '2026-04-17T10:00:00Z',
      kind: 'server_start', project_dir: '/tmp', version: '1.0', started_at: '2026-04-17T10:00:00Z',
    });
    toolCallEvent(store, 's1', 'validate_code', '2026-04-17T10:01:00Z');
    toolCallEvent(store, 's1', 'validate_intent', '2026-04-17T10:02:00Z');
    emitEvent(store, 's1', 'fp1', 'Check1', '2026-04-17T10:03:00Z');

    const summaries = sessionSummaries(store);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].session_id).toBe('s1');
    expect(summaries[0].event_count).toBe(4);
    expect(summaries[0].tool_calls).toBe(2);
    expect(summaries[0].validate_code_calls).toBe(1);
    expect(summaries[0].used_validate_intent).toBe(true);
    expect(summaries[0].diagnostics_emitted).toBe(1);
  });

  test('detects when validate_intent is not used', () => {
    toolCallEvent(store, 's2', 'validate_code', '2026-04-17T10:00:00Z');
    const summaries = sessionSummaries(store);
    const s = summaries.find(s => s.session_id === 's2');
    expect(s.used_validate_intent).toBe(false);
  });
});

describe('recommendations', () => {
  test('flags checks with high mislead rate', () => {
    for (let i = 0; i < 20; i++) {
      emitEvent(store, 's1', `fp${i}`, 'BadCheck', `2026-04-17T10:${String(i).padStart(2, '0')}:00Z`);
    }

    const windowId = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:20:00Z',
    });

    for (let i = 0; i < 15; i++) {
      store.insertOutcome({
        fp: `fp${i}`, window_id: windowId,
        outcome: i < 10 ? 'regressed' : 'resolved',
      });
    }

    const recs = recommendations(store, 0.3);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].check).toBe('BadCheck');
    expect(recs[0].recommendation).toContain('misleads');
  });

  test('returns empty when no checks exceed threshold', () => {
    for (let i = 0; i < 20; i++) {
      emitEvent(store, 's1', `fp${i}`, 'GoodCheck', `2026-04-17T10:${String(i).padStart(2, '0')}:00Z`);
    }

    const windowId = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:20:00Z',
    });

    for (let i = 0; i < 15; i++) {
      store.insertOutcome({
        fp: `fp${i}`, window_id: windowId,
        outcome: i < 12 ? 'resolved' : 'unchanged',
      });
    }

    const recs = recommendations(store, 0.3);
    expect(recs).toHaveLength(0);
  });
});
