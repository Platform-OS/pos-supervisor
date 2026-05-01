import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import {
  betaPosterior,
  checkScorecards,
  toolSequenceBigrams,
  sessionSummaries,
  recommendations,
  rulePerformance,
  diagnosticJourney,
  ruleDrilldown,
  fixAdoptionFunnel,
  adaptiveModeImpact,
  fixRulePerformance,
  ruleScoresByCategory,
  knowledgeGaps,
  confidenceCalibration,
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

// ── A4: rulePerformance (reporting view) ───────────────────────────────────

describe('rulePerformance', () => {
  function emitWithRule(store, { fp, sessionId, check, ruleId, file, ts }) {
    store.ingestEvent({
      v: 1,
      session_id: sessionId,
      ts: ts ?? '2026-04-17T10:00:00Z',
      kind: 'validator_emit',
      fp,
      template_fp: `tpl-${fp}`,
      file: file ?? 'app/views/pages/index.html.liquid',
      check,
      hint_rule_id: ruleId,
      proposed_fixes: [],
    });
  }

  test('returns empty when no rule_ids present', () => {
    expect(rulePerformance(store)).toEqual([]);
  });

  test('default threshold of 1 surfaces single-emit rules', () => {
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'UnknownFilter', ruleId: 'UnknownFilter.typo' });
    const out = rulePerformance(store);
    expect(out).toHaveLength(1);
    expect(out[0].rule_id).toBe('UnknownFilter.typo');
    expect(out[0].emitted).toBe(1);
    expect(out[0].unmatched).toBe(false);
  });

  test('includes `${check}.unmatched` fallback rule_ids (reporting coverage)', () => {
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'MissingPartial', ruleId: 'MissingPartial.unmatched' });
    emitWithRule(store, { fp: 'fp2', sessionId: 's1', check: 'MissingPartial', ruleId: 'MissingPartial.unmatched' });
    const out = rulePerformance(store);
    const row = out.find(r => r.rule_id === 'MissingPartial.unmatched');
    expect(row).toBeDefined();
    expect(row.unmatched).toBe(true);
    expect(row.emitted).toBe(2);
  });

  test('excludes rule_id "unknown" sentinel', () => {
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'X', ruleId: 'unknown' });
    expect(rulePerformance(store)).toEqual([]);
  });

  test('minEmitted filter honoured', () => {
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'A', ruleId: 'A.x' });
    emitWithRule(store, { fp: 'fp2', sessionId: 's1', check: 'B', ruleId: 'B.y' });
    emitWithRule(store, { fp: 'fp3', sessionId: 's1', check: 'B', ruleId: 'B.y' });
    const out = rulePerformance(store, { minEmitted: 2 });
    expect(out.map(r => r.rule_id)).toEqual(['B.y']);
  });

  test('EXISTS join does not inflate outcomes by per-emit diagnostic rows', () => {
    // Post-A1: outcomes row per (session, file, fp). The same fp may appear
    // many times in diagnostics (each validator_emit event). rulePerformance
    // must count each outcome row once, not per emitting diagnostic.
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'UnknownFilter', ruleId: 'UnknownFilter.typo', ts: '2026-04-17T10:00:00Z' });
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'UnknownFilter', ruleId: 'UnknownFilter.typo', ts: '2026-04-17T10:01:00Z' });
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'UnknownFilter', ruleId: 'UnknownFilter.typo', ts: '2026-04-17T10:02:00Z' });

    const windowId = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:03:00Z',
    });
    store.insertOutcome({ fp: 'fp1', window_id: windowId, outcome: 'resolved', fix_applied: 'verbatim' });

    const out = rulePerformance(store);
    const row = out.find(r => r.rule_id === 'UnknownFilter.typo');
    expect(row.total_outcomes).toBe(1);
    expect(row.resolved).toBe(1);
    expect(row.adopted).toBe(1);
  });

  test('does not expose `disabled` flag (reporting is not a promotion decision)', () => {
    emitWithRule(store, { fp: 'fp1', sessionId: 's1', check: 'A', ruleId: 'A.x' });
    const out = rulePerformance(store);
    expect(out[0].disabled).toBeUndefined();
  });
});

// ── hint_md_hash surfaced by journey + drilldown queries (Bug 2) ────────────

describe('journey + drilldown surface hint_md_hash', () => {
  test('diagnosticJourney timeline entries carry hint_md_hash', () => {
    store.ingestEvent({
      v: 1, session_id: 'j1', ts: '2026-04-17T10:00:00Z', kind: 'validator_emit',
      fp: 'fp-j1', template_fp: 'tpl-j1', file: 'app/views/pages/a.liquid',
      hint_rule_id: 'Check.rule', hint_md_hash: 'x'.repeat(64),
      content_hash: 'y'.repeat(64), proposed_fixes: [],
    });

    const j = diagnosticJourney(store, 'tpl-j1');
    expect(j.timeline).toHaveLength(1);
    expect(j.timeline[0].hint_md_hash).toBe('x'.repeat(64));
  });

  test('ruleDrilldown samples carry hint_md_hash', () => {
    store.ingestEvent({
      v: 1, session_id: 'd1', ts: '2026-04-17T10:00:00Z', kind: 'validator_emit',
      fp: 'fp-d1', template_fp: 'tpl-d1', file: 'app/views/pages/b.liquid',
      hint_rule_id: 'Check.rule', hint_md_hash: 'a'.repeat(64),
      content_hash: 'b'.repeat(64), proposed_fixes: [],
    });

    const d = ruleDrilldown(store, 'Check.rule');
    expect(d.samples).toHaveLength(1);
    expect(d.samples[0].hint_md_hash).toBe('a'.repeat(64));
  });
});

// ── Funnel adoption counts (Bug 1) ──────────────────────────────────────────

describe('fixAdoptionFunnel counts fix_applied correctly', () => {
  test('picks up verbatim + partial + null adoption buckets', () => {
    // Seed three fps, each with one diagnostic and one outcome that carries a
    // fix_applied label. Post-Bug-1: classifyAndStoreWindows writes these;
    // the query is read-only.
    store.ingestEvent({
      v: 1, session_id: 'fa', ts: '2026-04-17T10:00:00Z', kind: 'validator_emit',
      fp: 'v', template_fp: 'tpl-v', file: 'app/views/pages/v.liquid',
      hint_rule_id: 'C.r', proposed_fixes: [],
    });
    store.ingestEvent({
      v: 1, session_id: 'fa', ts: '2026-04-17T10:00:00Z', kind: 'validator_emit',
      fp: 'p', template_fp: 'tpl-p', file: 'app/views/pages/p.liquid',
      hint_rule_id: 'C.r', proposed_fixes: [],
    });
    store.ingestEvent({
      v: 1, session_id: 'fa', ts: '2026-04-17T10:00:00Z', kind: 'validator_emit',
      fp: 'n', template_fp: 'tpl-n', file: 'app/views/pages/n.liquid',
      hint_rule_id: 'C.r', proposed_fixes: [],
    });

    const w1 = store.insertWindow({ session_id: 'fa', file: 'app/views/pages/v.liquid', idx: 0, ts_start: 'a', ts_end: 'b' });
    const w2 = store.insertWindow({ session_id: 'fa', file: 'app/views/pages/p.liquid', idx: 0, ts_start: 'a', ts_end: 'b' });
    const w3 = store.insertWindow({ session_id: 'fa', file: 'app/views/pages/n.liquid', idx: 0, ts_start: 'a', ts_end: 'b' });
    store.insertOutcome({ fp: 'v', window_id: w1, outcome: 'resolved', fix_applied: 'verbatim' });
    store.insertOutcome({ fp: 'p', window_id: w2, outcome: 'resolved', fix_applied: 'partial' });
    store.insertOutcome({ fp: 'n', window_id: w3, outcome: 'resolved', fix_applied: null });

    const f = fixAdoptionFunnel(store);
    expect(f.fix_adopted_verbatim).toBe(1);
    expect(f.fix_adopted_partial).toBe(1);
    expect(f.resolved).toBe(3);
  });
});

// ── Part G — adaptiveModeImpact window query ────────────────────────────────

describe('adaptiveModeImpact', () => {
  const NOW = Date.now();
  function emitAt(msAgo, overrides = {}) {
    const ts = new Date(NOW - msAgo).toISOString();
    store.ingestEvent({
      v: 1, session_id: 'ami', ts, kind: 'validator_emit',
      fp: overrides.fp ?? 'fp-' + msAgo,
      template_fp: 'tpl', file: 'app/views/pages/x.liquid',
      hint_rule_id: overrides.rule ?? 'X.r',
      confidence: overrides.confidence ?? 0.8,
      proposed_fixes: [],
    });
  }

  test('returns zero counts when window is empty', () => {
    const r = adaptiveModeImpact(store, { windowMs: 60_000 });
    expect(r.emits_in_window).toBe(0);
    expect(r.rule_matched_in_window).toBe(0);
    expect(r.confidence.samples).toBe(0);
  });

  test('counts emits within the window + excludes .unmatched from rule_matched', () => {
    emitAt(1_000,  { fp: 'a', rule: 'X.r' });
    emitAt(2_000,  { fp: 'b', rule: 'X.r' });
    emitAt(3_000,  { fp: 'c', rule: 'Y.unmatched' });
    emitAt(3_600_001, { fp: 'old', rule: 'X.r' }); // outside 1h window

    const r = adaptiveModeImpact(store, { windowMs: 3_600_000 });
    expect(r.emits_in_window).toBe(3);
    expect(r.rule_matched_in_window).toBe(2);  // 'Y.unmatched' excluded
  });

  test('emits_by_rule groups per rule_id; caller intersects with disabled set', () => {
    emitAt(1_000, { fp: 'a', rule: 'DisA' });
    emitAt(2_000, { fp: 'b', rule: 'DisA' });
    emitAt(2_000, { fp: 'c', rule: 'DisB' });

    const r = adaptiveModeImpact(store, { windowMs: 60_000 });
    expect(r.emits_by_rule).toEqual({ DisA: 2, DisB: 1 });
  });

  test('confidence stats reflect window-scoped emits only', () => {
    emitAt(1_000,  { fp: 'a', confidence: 0.9 });
    emitAt(2_000,  { fp: 'b', confidence: 0.5 });

    const r = adaptiveModeImpact(store, { windowMs: 60_000 });
    expect(r.confidence.samples).toBe(2);
    expect(r.confidence.mean).toBeCloseTo(0.7, 2);
    expect(r.confidence.min).toBe(0.5);
    expect(r.confidence.max).toBe(0.9);
  });
});

// ── I1 — fixRulePerformance (attribution by proposed_fixes.rule_id) ─────────

describe('fixRulePerformance', () => {
  function emitWithFixes(sessionId, fp, fixes) {
    store.ingestEvent({
      v: 1, session_id: sessionId, ts: '2026-04-17T10:00:00Z', kind: 'validator_emit',
      fp, template_fp: 'tpl', file: 'app/views/pages/x.liquid',
      hint_rule_id: 'Ignored', proposed_fixes: fixes,
    });
  }
  function outcome(fp, sessionId, out, fixApplied = null) {
    const wid = store.insertWindow({
      session_id: sessionId, file: 'app/views/pages/x.liquid', idx: 0,
      ts_start: 'a', ts_end: 'b',
    });
    store.insertOutcome({ fp, window_id: wid, outcome: out, fix_applied: fixApplied });
  }

  test('returns empty when no rule_ids on fixes', () => {
    emitWithFixes('s1', 'f', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: null }]);
    expect(fixRulePerformance(store)).toEqual([]);
  });

  test('groups rule-engine vs heuristic under a `source` field', () => {
    emitWithFixes('s1', 'f1', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'UnknownFilter.suggest_nearest' }]);
    emitWithFixes('s1', 'f2', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:UnknownFilter.text_edit' }]);
    const out = fixRulePerformance(store);
    const rule = out.find(r => r.rule_id === 'UnknownFilter.suggest_nearest');
    const heur = out.find(r => r.rule_id === 'heuristic:UnknownFilter.text_edit');
    expect(rule?.source).toBe('rule');
    expect(heur?.source).toBe('heuristic');
  });

  test('aggregates adoption + resolution per rule_id', () => {
    emitWithFixes('s1', 'a', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:UnknownFilter.text_edit' }]);
    emitWithFixes('s2', 'b', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:UnknownFilter.text_edit' }]);
    emitWithFixes('s3', 'c', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:UnknownFilter.text_edit' }]);
    outcome('a', 's1', 'resolved',  'verbatim');
    outcome('b', 's2', 'resolved',  'partial');
    outcome('c', 's3', 'unchanged', null);

    const r = fixRulePerformance(store).find(r => r.rule_id === 'heuristic:UnknownFilter.text_edit');
    expect(r.outcomes).toBe(3);
    expect(r.adopted_verbatim).toBe(1);
    expect(r.adopted_partial).toBe(1);
    expect(r.adoption_rate).toBeCloseTo(2 / 3, 2);
    expect(r.resolution_rate).toBeCloseTo(2 / 3, 2);
  });

  test('minProposed filter honoured', () => {
    emitWithFixes('s1', 'a', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:Rare.text_edit' }]);
    emitWithFixes('s2', 'b', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:Common.text_edit' }]);
    emitWithFixes('s3', 'c', [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'heuristic:Common.text_edit' }]);
    const out = fixRulePerformance(store, { minProposed: 2 });
    expect(out.map(r => r.rule_id)).toEqual(['heuristic:Common.text_edit']);
  });
});

// ── Reporting baseline (`since`) — tri-state contract ─────────────────────
//
// All reporting queries accept `opts.since`:
//   - undefined ⇒ read store.getBaselineTs(); absent ⇒ no filter
//   - null      ⇒ explicit bypass (engine-state callers)
//   - ISO       ⇒ filter d.ts >= since (or pf.ts for fix-rule queries)
//
// Each test below seeds two timestamps — one before a midpoint, one after —
// and asserts the query honours the explicit ISO, the absent meta default
// (full history), and the meta-set value (auto-applied default).

describe('reporting baseline: since param', () => {
  const OLD = '2026-04-01T00:00:00.000Z';   // pre-midpoint
  const NEW = '2026-04-30T00:00:00.000Z';   // post-midpoint
  const MID = '2026-04-15T00:00:00.000Z';

  function seedTwoEras() {
    // Old + new emit on the same template — easy to count. Two emits in the
    // OLD era share session 's1' so a single window can host both outcomes
    // and the diagnostic↔outcome (fp, session_id, file) JOIN matches.
    emitEvent(store, 's1', 'old1', 'CheckA', OLD);
    emitEvent(store, 's1', 'old2', 'CheckA', OLD);
    emitEvent(store, 's3', 'new1', 'CheckA', NEW);
  }

  function seedTwoErasWithOutcomes() {
    seedTwoEras();
    const wOld = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: OLD, ts_end: OLD,
    });
    const wNew = store.insertWindow({
      session_id: 's3', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: NEW, ts_end: NEW,
    });
    store.insertOutcome({ fp: 'old1', window_id: wOld, outcome: 'regressed' });
    store.insertOutcome({ fp: 'old2', window_id: wOld, outcome: 'regressed' });
    store.insertOutcome({ fp: 'new1', window_id: wNew, outcome: 'resolved' });
  }

  test('checkScorecards: ISO since filters out pre-baseline emits', () => {
    seedTwoEras();
    const all = checkScorecards(store, { minCohort: 1 });
    expect(all[0].emitted).toBe(3);
    const post = checkScorecards(store, { minCohort: 1, since: MID });
    expect(post[0].emitted).toBe(1);
  });

  test('checkScorecards: outcome counts honour the same baseline', () => {
    seedTwoErasWithOutcomes();
    const post = checkScorecards(store, { minCohort: 1, since: MID });
    // Only the post-baseline emit's outcome (resolved) should count.
    expect(post[0].sample_size).toBe(1);
    expect(post[0].resolution_rate.mean).toBeGreaterThan(0.5);
  });

  test('checkScorecards: since=null bypasses meta baseline', () => {
    seedTwoEras();
    store.setBaselineTs(MID);
    const all = checkScorecards(store, { minCohort: 1, since: null });
    expect(all[0].emitted).toBe(3);
    store.clearBaseline();
  });

  test('checkScorecards: since=undefined reads meta baseline by default', () => {
    seedTwoEras();
    store.setBaselineTs(MID);
    const post = checkScorecards(store, { minCohort: 1 });
    expect(post[0].emitted).toBe(1);
    store.clearBaseline();
  });

  test('rulePerformance: ISO since filters by d.ts', () => {
    seedTwoEras();
    const all = rulePerformance(store);
    expect(all[0].emitted).toBe(3);
    const post = rulePerformance(store, { since: MID });
    expect(post[0].emitted).toBe(1);
  });

  test('rulePerformance: outcome counts narrow to the window', () => {
    seedTwoErasWithOutcomes();
    const post = rulePerformance(store, { since: MID });
    expect(post[0].total_outcomes).toBe(1);
    expect(post[0].resolved).toBe(1);
    expect(post[0].regressed).toBe(0);
  });

  test('rulePerformance: meta default fires when since is absent', () => {
    seedTwoEras();
    store.setBaselineTs(MID);
    expect(rulePerformance(store)[0].emitted).toBe(1);
    store.clearBaseline();
    expect(rulePerformance(store)[0].emitted).toBe(3);
  });

  test('fixAdoptionFunnel: emit + outcome counts narrow to the window', () => {
    seedTwoErasWithOutcomes();
    const post = fixAdoptionFunnel(store, { since: MID });
    expect(post.emitted).toBe(1);
    expect(post.resolved).toBe(1);
    expect(post.regressed).toBe(0);
    const all = fixAdoptionFunnel(store);
    expect(all.emitted).toBe(3);
    expect(all.regressed).toBe(2);
  });

  test('fixAdoptionFunnel: meta baseline + since=null bypass', () => {
    seedTwoErasWithOutcomes();
    store.setBaselineTs(MID);
    expect(fixAdoptionFunnel(store).emitted).toBe(1);
    expect(fixAdoptionFunnel(store, { since: null }).emitted).toBe(3);
    store.clearBaseline();
  });

  test('knowledgeGaps: filters total_emitted by since', () => {
    // Need ≥3 emits to pass the HAVING gate post-filter.
    emitEvent(store, 's1', 'old1', 'KGCheck', OLD);
    emitEvent(store, 's1', 'old2', 'KGCheck', OLD);
    emitEvent(store, 's1', 'new1', 'KGCheck', NEW);
    emitEvent(store, 's1', 'new2', 'KGCheck', NEW);
    emitEvent(store, 's1', 'new3', 'KGCheck', NEW);

    const all = knowledgeGaps(store);
    const allRow = all.find(r => r.check === 'KGCheck');
    expect(allRow?.total_emitted).toBe(5);

    const post = knowledgeGaps(store, { since: MID });
    const postRow = post.find(r => r.check === 'KGCheck');
    expect(postRow?.total_emitted).toBe(3);
  });

  test('confidenceCalibration: filters by d.ts', () => {
    const wid = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: OLD, ts_end: NEW,
    });
    // Old: low confidence, regressed. New: high confidence, resolved.
    store.ingestEvent({
      v: 1, session_id: 's1', ts: OLD, kind: 'validator_emit',
      fp: 'cal-old', file: 'app/views/pages/index.html.liquid',
      hint_rule_id: 'X', confidence: 0.2, proposed_fixes: [],
    });
    store.ingestEvent({
      v: 1, session_id: 's1', ts: NEW, kind: 'validator_emit',
      fp: 'cal-new', file: 'app/views/pages/index.html.liquid',
      hint_rule_id: 'X', confidence: 0.9, proposed_fixes: [],
    });
    store.insertOutcome({ fp: 'cal-old', window_id: wid, outcome: 'regressed' });
    store.insertOutcome({ fp: 'cal-new', window_id: wid, outcome: 'resolved' });

    const allBuckets = confidenceCalibration(store);
    const allTotal = allBuckets.reduce((s, b) => s + b.sample_size, 0);
    expect(allTotal).toBe(2);

    const postBuckets = confidenceCalibration(store, { since: MID });
    const postTotal = postBuckets.reduce((s, b) => s + b.sample_size, 0);
    expect(postTotal).toBe(1);
  });

  test('ruleScoresByCategory: filters by d.ts', () => {
    seedTwoErasWithOutcomes();
    const all = ruleScoresByCategory(store);
    const allRow = all.find(r => r.rule_id === 'CheckA');
    expect(allRow.outcomes).toBe(3);
    const post = ruleScoresByCategory(store, { since: MID });
    const postRow = post.find(r => r.rule_id === 'CheckA');
    expect(postRow.outcomes).toBe(1);
  });

  test('sessionSummaries: filters session list to those active in window', () => {
    // Distinct sessions per era.
    store.ingestEvent({ v: 1, session_id: 'old-only', ts: OLD, kind: 'server_start',
      project_dir: '/tmp', version: '1.0', started_at: OLD });
    toolCallEvent(store, 'old-only', 'validate_code', OLD);
    toolCallEvent(store, 'new-only', 'validate_code', NEW);

    const all = sessionSummaries(store);
    expect(all.map(s => s.session_id).sort()).toEqual(['new-only', 'old-only']);

    const post = sessionSummaries(store, { since: MID });
    expect(post.map(s => s.session_id)).toEqual(['new-only']);
  });

  test('toolSequenceBigrams: filters events by ts', () => {
    toolCallEvent(store, 's1', 'project_map', OLD);
    toolCallEvent(store, 's1', 'scaffold',    OLD);
    toolCallEvent(store, 's1', 'project_map', NEW);
    toolCallEvent(store, 's1', 'validate_code', NEW);

    const all = toolSequenceBigrams(store);
    expect(all.find(b => b.bigram[0] === 'project_map' && b.bigram[1] === 'scaffold')).toBeDefined();

    const post = toolSequenceBigrams(store, { since: MID });
    expect(post.find(b => b.bigram[0] === 'project_map' && b.bigram[1] === 'scaffold')).toBeUndefined();
    expect(post.find(b => b.bigram[0] === 'project_map' && b.bigram[1] === 'validate_code')).toBeDefined();
  });

  test('diagnosticJourney: filters timeline to post-baseline emits', () => {
    store.ingestEvent({
      v: 1, session_id: 's1', ts: OLD, kind: 'validator_emit',
      fp: 'fp-old', template_fp: 'jt', file: 'app/views/pages/x.liquid',
      hint_rule_id: 'CheckJ', proposed_fixes: [],
    });
    store.ingestEvent({
      v: 1, session_id: 's2', ts: NEW, kind: 'validator_emit',
      fp: 'fp-new', template_fp: 'jt', file: 'app/views/pages/x.liquid',
      hint_rule_id: 'CheckJ', proposed_fixes: [],
    });

    const all = diagnosticJourney(store, 'jt');
    expect(all.session_count).toBe(2);
    const post = diagnosticJourney(store, 'jt', { since: MID });
    expect(post.session_count).toBe(1);
    expect(post.timeline[0].session_id).toBe('s2');
  });

  test('ruleDrilldown: filters samples + file/template stats', () => {
    seedTwoErasWithOutcomes();
    const all = ruleDrilldown(store, 'CheckA');
    expect(all.samples).toHaveLength(3);
    expect(all.file_distribution[0].emitted).toBe(3);

    const post = ruleDrilldown(store, 'CheckA', { since: MID });
    expect(post.samples).toHaveLength(1);
    expect(post.file_distribution[0].emitted).toBe(1);
    expect(post.file_distribution[0].resolved).toBe(1);
    expect(post.file_distribution[0].regressed).toBe(0);
  });

  test('fixRulePerformance: filters by pf.ts', () => {
    function emitWithFix(sid, fp, ts) {
      store.ingestEvent({
        v: 1, session_id: sid, ts, kind: 'validator_emit',
        fp, template_fp: 'tpl', file: 'app/views/pages/x.liquid',
        hint_rule_id: 'X.r',
        proposed_fixes: [{ range: null, new_text_hash: 'h', kind: 'text_edit', rule_id: 'X.r' }],
      });
    }
    emitWithFix('s1', 'oldA', OLD);
    emitWithFix('s2', 'oldB', OLD);
    emitWithFix('s3', 'new1', NEW);

    const all = fixRulePerformance(store);
    expect(all.find(r => r.rule_id === 'X.r').proposed).toBe(3);

    const post = fixRulePerformance(store, { since: MID });
    expect(post.find(r => r.rule_id === 'X.r').proposed).toBe(1);
  });

  test('recommendations: forwards since to checkScorecards', () => {
    // Old era: clearly harmful. New era: clean.
    for (let i = 0; i < 10; i++) {
      emitEvent(store, 's1', `bad-${i}`, 'BadCheck', OLD);
    }
    const wOld = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: OLD, ts_end: OLD,
    });
    for (let i = 0; i < 10; i++) {
      store.insertOutcome({ fp: `bad-${i}`, window_id: wOld, outcome: 'regressed' });
    }

    const allRecs = recommendations(store, 0.3);
    expect(allRecs.find(r => r.check === 'BadCheck')).toBeDefined();
    const postRecs = recommendations(store, 0.3, { since: MID });
    expect(postRecs.find(r => r.check === 'BadCheck')).toBeUndefined();
  });

  test('resolveSince precedence: explicit ISO beats meta baseline', () => {
    // meta says MID, query says OLD → query wins, sees everything.
    store.setBaselineTs(MID);
    seedTwoEras();
    const out = checkScorecards(store, { minCohort: 1, since: OLD });
    expect(out[0].emitted).toBe(3);
    store.clearBaseline();
  });

  test('store without getBaselineTs (mock) — undefined since means no filter', () => {
    // Defensive: resolveSince must degrade gracefully when given a partial mock.
    const fakeStore = {
      query: store.query,
      queryOne: store.queryOne,
      // Note: no getBaselineTs.
    };
    seedTwoEras();
    // Bind the real prepared-statement methods to the real db path so the
    // fake store can still issue queries (we just test the resolver path).
    fakeStore.query = (sql, params) => store.query(sql, params);
    fakeStore.queryOne = (sql, params) => store.queryOne(sql, params);

    const out = checkScorecards(fakeStore, { minCohort: 1 });
    expect(out[0].emitted).toBe(3);
  });
});
