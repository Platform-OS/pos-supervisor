import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import {
  diagnosticJourney,
  confidenceCalibration,
  fixAdoptionFunnel,
  knowledgeGaps,
} from '../../src/core/analytics-queries.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-queries-k-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function emitDiag(store, { fp, template_fp, session_id, check, confidence, file }) {
  store.ingestEvent({
    v: 1,
    session_id: session_id ?? 'sess-1',
    ts: '2026-04-17T10:00:00Z',
    kind: 'validator_emit',
    fp,
    template_fp,
    file: file ?? 'app/views/pages/index.html.liquid',
    hint_rule_id: check ?? null,
    confidence: confidence ?? null,
    proposed_fixes: [],
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

// ── K2: Diagnostic Journey ──────────────────────────────────────────────

describe('K2: diagnosticJourney', () => {
  test('returns empty for unknown template_fp', () => {
    const journey = diagnosticJourney(store, 'nonexistent');
    expect(journey.session_count).toBe(0);
    expect(journey.timeline).toEqual([]);
    expect(journey.check).toBeNull();
  });

  test('returns journey across multiple sessions', () => {
    emitDiag(store, { fp: 'fp1', template_fp: 'tpl-a', session_id: 's1', check: 'MissingPartial' });
    emitDiag(store, { fp: 'fp2', template_fp: 'tpl-a', session_id: 's2', check: 'MissingPartial' });
    emitDiag(store, { fp: 'fp3', template_fp: 'tpl-a', session_id: 's3', check: 'MissingPartial' });

    const wid = store.insertWindow({ session_id: 's1', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z' });
    store.insertOutcome({ fp: 'fp1', window_id: wid, outcome: 'unchanged' });

    const wid2 = store.insertWindow({ session_id: 's2', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T11:00:00Z', ts_end: '2026-04-17T11:01:00Z' });
    store.insertOutcome({ fp: 'fp2', window_id: wid2, outcome: 'resolved', fix_applied: 'verbatim' });

    const journey = diagnosticJourney(store, 'tpl-a');
    expect(journey.check).toBe('MissingPartial');
    expect(journey.session_count).toBe(3);
    expect(journey.timeline).toHaveLength(3);

    const s1 = journey.timeline.find(t => t.session_id === 's1');
    expect(s1.dominant_outcome).toBe('unchanged');
    expect(s1.rule_id).toBe('MissingPartial');

    const s2 = journey.timeline.find(t => t.session_id === 's2');
    expect(s2.dominant_outcome).toBe('resolved');
    expect(s2.fix_applied).toBe('verbatim');

    const s3 = journey.timeline.find(t => t.session_id === 's3');
    expect(s3.dominant_outcome).toBeNull();
  });

  test('counts occurrences per session', () => {
    emitDiag(store, { fp: 'fp1', template_fp: 'tpl-b', session_id: 's1', check: 'Check' });
    emitDiag(store, { fp: 'fp2', template_fp: 'tpl-b', session_id: 's1', check: 'Check' });
    emitDiag(store, { fp: 'fp3', template_fp: 'tpl-b', session_id: 's1', check: 'Check' });

    const journey = diagnosticJourney(store, 'tpl-b');
    expect(journey.timeline).toHaveLength(1);
    expect(journey.timeline[0].occurrences).toBe(3);
  });
});

// ── K3: Confidence Calibration ──────────────────────────────────────────

describe('K3: confidenceCalibration', () => {
  test('returns empty when no diagnostics have confidence', () => {
    emitDiag(store, { fp: 'fp1', template_fp: 'tpl', session_id: 's1', check: 'X' });
    const wid = store.insertWindow({ session_id: 's1', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z' });
    store.insertOutcome({ fp: 'fp1', window_id: wid, outcome: 'resolved' });

    const cal = confidenceCalibration(store);
    expect(cal).toEqual([]);
  });

  test('buckets diagnostics by confidence and computes resolution rate', () => {
    const wid = store.insertWindow({ session_id: 's1', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z' });

    for (let i = 0; i < 10; i++) {
      emitDiag(store, { fp: `hi-${i}`, template_fp: 'tpl', session_id: 's1', check: 'X', confidence: 0.85 });
      store.insertOutcome({ fp: `hi-${i}`, window_id: wid, outcome: i < 8 ? 'resolved' : 'unchanged' });
    }
    for (let i = 0; i < 10; i++) {
      emitDiag(store, { fp: `lo-${i}`, template_fp: 'tpl', session_id: 's1', check: 'X', confidence: 0.25 });
      store.insertOutcome({ fp: `lo-${i}`, window_id: wid, outcome: i < 3 ? 'resolved' : 'unchanged' });
    }

    const cal = confidenceCalibration(store, { buckets: 10 });
    expect(cal.length).toBeGreaterThanOrEqual(2);

    const highBucket = cal.find(b => b.predicted >= 0.8);
    const lowBucket = cal.find(b => b.predicted <= 0.3);
    expect(highBucket).toBeDefined();
    expect(lowBucket).toBeDefined();
    expect(highBucket.actual_resolution).toBeGreaterThan(lowBucket.actual_resolution);
  });

  test('respects custom bucket count', () => {
    const wid = store.insertWindow({ session_id: 's1', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z' });

    for (let i = 0; i < 20; i++) {
      const conf = (i % 5) * 0.2 + 0.1;
      emitDiag(store, { fp: `fp-${i}`, template_fp: 'tpl', session_id: 's1', check: 'X', confidence: conf });
      store.insertOutcome({ fp: `fp-${i}`, window_id: wid, outcome: 'resolved' });
    }

    const cal5 = confidenceCalibration(store, { buckets: 5 });
    expect(cal5.length).toBeLessThanOrEqual(5);
  });
});

// ── K4: Fix Adoption Funnel ─────────────────────────────────────────────

describe('K4: fixAdoptionFunnel', () => {
  test('returns zeroes for empty store', () => {
    const funnel = fixAdoptionFunnel(store);
    expect(funnel.emitted).toBe(0);
    expect(funnel.rule_matched).toBe(0);
    expect(funnel.fix_proposed).toBe(0);
    expect(funnel.resolved).toBe(0);
  });

  test('computes full funnel with data', () => {
    for (let i = 0; i < 20; i++) {
      const check = i < 15 ? 'TestCheck' : null;
      emitDiag(store, { fp: `fp-${i}`, template_fp: 'tpl', session_id: 's1', check });
    }

    for (let i = 0; i < 10; i++) {
      store.db.prepare(`
        INSERT INTO proposed_fixes (fp, session_id, ts, kind) VALUES (?, ?, ?, ?)
      `).run(`fp-${i}`, 's1', '2026-04-17T10:00:00Z', 'replace');
    }

    const wid = store.insertWindow({ session_id: 's1', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z' });

    for (let i = 0; i < 8; i++) {
      store.insertOutcome({
        fp: `fp-${i}`, window_id: wid,
        outcome: i < 5 ? 'resolved' : 'unchanged',
        fix_applied: i < 3 ? 'verbatim' : (i < 5 ? 'partial' : null),
      });
    }
    store.insertOutcome({ fp: 'fp-8', window_id: wid, outcome: 'regressed' });

    const funnel = fixAdoptionFunnel(store);
    expect(funnel.emitted).toBe(20);
    expect(funnel.rule_matched).toBe(15);
    expect(funnel.fix_proposed).toBe(10);
    expect(funnel.fix_adopted_verbatim).toBe(3);
    expect(funnel.fix_adopted_partial).toBe(2);
    expect(funnel.resolved).toBe(5);
    expect(funnel.regressed).toBe(1);
  });
});

// ── K5: Knowledge Gaps ──────────────────────────────────────────────────

describe('K5: knowledgeGaps', () => {
  test('returns empty for insufficient data', () => {
    emitDiag(store, { fp: 'fp1', template_fp: 'tpl', session_id: 's1', check: 'X' });
    const gaps = knowledgeGaps(store);
    expect(gaps).toEqual([]);
  });

  test('identifies checks with low rule coverage', () => {
    for (let i = 0; i < 10; i++) {
      emitDiag(store, { fp: `covered-${i}`, template_fp: 'tpl-c', session_id: 's1', check: 'CoveredCheck' });
    }
    for (let i = 0; i < 10; i++) {
      emitDiag(store, { fp: `uncov-${i}`, template_fp: 'tpl-u', session_id: 's1', check: i < 3 ? 'UncoveredCheck' : null });
    }

    const gaps = knowledgeGaps(store);
    const covered = gaps.find(g => g.check === 'CoveredCheck');
    const uncovered = gaps.find(g => g.check === 'unknown');

    expect(covered).toBeDefined();
    expect(covered.coverage_rate).toBe(1);
    expect(uncovered).toBeDefined();
    expect(uncovered.unmatched_count).toBe(7);
  });

  test('includes resolution rate per check', () => {
    for (let i = 0; i < 5; i++) {
      emitDiag(store, { fp: `fp-${i}`, template_fp: 'tpl', session_id: 's1', check: 'ResCheck' });
    }

    const wid = store.insertWindow({ session_id: 's1', file: 'test.liquid', idx: 0, ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z' });
    for (let i = 0; i < 5; i++) {
      store.insertOutcome({ fp: `fp-${i}`, window_id: wid, outcome: i < 4 ? 'resolved' : 'unchanged' });
    }

    const gaps = knowledgeGaps(store);
    const resCheck = gaps.find(g => g.check === 'ResCheck');
    expect(resCheck).toBeDefined();
    expect(resCheck.avg_resolution_rate).toBe(0.8);
  });
});
