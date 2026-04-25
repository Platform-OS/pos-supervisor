import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import { openBlobStore } from '../../src/core/blob-store.js';
import { fingerprint, templateOf } from '../../src/core/diagnostic-record.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-analytics-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tmpSessionDir() {
  const dir = join(tmpdir(), `pos-sessions-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeValidatorEmitLine(overrides = {}) {
  const event = {
    v: 1,
    session_id: 'test-session',
    ts: '2026-04-17T10:00:00.000Z',
    kind: 'validator_emit',
    fp: 'abc123',
    template_fp: 'tpl456',
    file: 'app/views/pages/index.html.liquid',
    hint_rule_id: 'MissingPartial.suggest_nearest',
    content_hash: 'hash789',
    proposed_fixes: [],
    ...overrides,
  };
  return JSON.stringify(event);
}

function makeToolCallLine(overrides = {}) {
  const event = {
    v: 1,
    session_id: 'test-session',
    ts: '2026-04-17T10:00:01.000Z',
    kind: 'tool_call',
    tool: 'validate_code',
    duration_ms: 150,
    success: true,
    ...overrides,
  };
  return JSON.stringify(event);
}

function makeServerStartLine(overrides = {}) {
  const event = {
    v: 1,
    session_id: 'test-session',
    ts: '2026-04-17T10:00:00.000Z',
    kind: 'server_start',
    project_dir: '/tmp/test',
    version: '0.5.2',
    started_at: '2026-04-17T10:00:00.000Z',
    ...overrides,
  };
  return JSON.stringify(event);
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

describe('openAnalyticsStore', () => {
  test('creates database with schema', () => {
    const s = store.stats();
    expect(s.schema_version).toBe(6);
    expect(s.events).toBe(0);
    expect(s.diagnostics).toBe(0);
  });

  test('meta stores and retrieves values', () => {
    expect(store.getMeta('schema_version')).toBe('6');
    expect(store.getMeta('nonexistent')).toBeNull();
  });
});

describe('ingestEvent', () => {
  test('inserts generic event', () => {
    store.ingestEvent({
      v: 1, session_id: 'sess1', ts: '2026-04-17T10:00:00Z',
      kind: 'server_start', project_dir: '/tmp', version: '1.0', started_at: '2026-04-17T10:00:00Z',
    });
    const s = store.stats();
    expect(s.events).toBe(1);
    expect(s.diagnostics).toBe(0);
  });

  test('validator_emit populates diagnostics + proposed_fixes', () => {
    store.ingestEvent({
      v: 1, session_id: 'sess1', ts: '2026-04-17T10:00:00Z',
      kind: 'validator_emit',
      fp: 'fp1', template_fp: 'tfp1', file: 'app/views/pages/index.html.liquid',
      hint_rule_id: 'MissingPartial.suggest_nearest',
      content_hash: 'ch1',
      proposed_fixes: [
        { range: { start: { line: 1, character: 0 } }, new_text_hash: 'nth1', kind: 'replace' },
      ],
    });
    const s = store.stats();
    expect(s.events).toBe(1);
    expect(s.diagnostics).toBe(1);

    const diag = store.query('SELECT * FROM diagnostics WHERE fp = ?', ['fp1']);
    expect(diag).toHaveLength(1);
    expect(diag[0].check_name).toBe('MissingPartial.suggest_nearest');
    expect(diag[0].content_hash).toBe('ch1');

    const fixes = store.query('SELECT * FROM proposed_fixes WHERE fp = ?', ['fp1']);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe('replace');
    expect(fixes[0].new_text_hash).toBe('nth1');
  });

  test('validator_emit without proposed_fixes still inserts diagnostic', () => {
    store.ingestEvent({
      v: 1, session_id: 'sess1', ts: '2026-04-17T10:00:00Z',
      kind: 'validator_emit',
      fp: 'fp2', file: 'app/views/pages/about.html.liquid',
      hint_rule_id: null, proposed_fixes: [],
    });
    expect(store.stats().diagnostics).toBe(1);
    const fixes = store.query('SELECT * FROM proposed_fixes WHERE fp = ?', ['fp2']);
    expect(fixes).toHaveLength(0);
  });
});

describe('ingestSession', () => {
  test('reads events.ndjson and populates database', () => {
    const sessDir = tmpSessionDir();
    const lines = [
      makeServerStartLine(),
      makeValidatorEmitLine({ fp: 'e1' }),
      makeValidatorEmitLine({ fp: 'e2', ts: '2026-04-17T10:00:01.000Z' }),
      makeToolCallLine(),
    ].join('\n');
    writeFileSync(join(sessDir, 'events.ndjson'), lines + '\n');

    const count = store.ingestSession(sessDir);
    expect(count).toBe(4);

    const s = store.stats();
    expect(s.events).toBe(4);
    expect(s.diagnostics).toBe(2);
    expect(s.sessions).toBe(1);

    rmSync(sessDir, { recursive: true, force: true });
  });

  test('returns 0 for missing events.ndjson', () => {
    const sessDir = tmpSessionDir();
    expect(store.ingestSession(sessDir)).toBe(0);
    rmSync(sessDir, { recursive: true, force: true });
  });
});

describe('rebuild', () => {
  test('clears and re-ingests all sessions', () => {
    const sessionsRoot = tmpSessionDir();
    const sess1 = join(sessionsRoot, 'session-1');
    const sess2 = join(sessionsRoot, 'session-2');
    mkdirSync(sess1, { recursive: true });
    mkdirSync(sess2, { recursive: true });

    writeFileSync(join(sess1, 'events.ndjson'), [
      makeServerStartLine({ session_id: 's1' }),
      makeValidatorEmitLine({ session_id: 's1', fp: 'a' }),
    ].join('\n') + '\n');

    writeFileSync(join(sess2, 'events.ndjson'), [
      makeServerStartLine({ session_id: 's2' }),
      makeValidatorEmitLine({ session_id: 's2', fp: 'b' }),
      makeValidatorEmitLine({ session_id: 's2', fp: 'c', ts: '2026-04-17T11:00:00Z' }),
    ].join('\n') + '\n');

    const result = store.rebuild(sessionsRoot);
    expect(result.sessions).toBe(2);
    expect(result.events).toBe(5);

    const s = store.stats();
    expect(s.sessions).toBe(2);
    expect(s.diagnostics).toBe(3);

    expect(store.getMeta('last_rebuild')).not.toBeNull();

    // Rebuild again — should produce same counts (idempotent clear + re-ingest)
    const result2 = store.rebuild(sessionsRoot);
    expect(result2.sessions).toBe(2);
    expect(store.stats().diagnostics).toBe(3);

    rmSync(sessionsRoot, { recursive: true, force: true });
  });

  test('handles missing sessions dir', () => {
    const result = store.rebuild('/tmp/nonexistent-analytics-test-dir-999');
    expect(result.sessions).toBe(0);
    expect(result.events).toBe(0);
  });
});

describe('insertWindow + insertOutcome', () => {
  test('inserts window and outcome rows', () => {
    const windowId = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z',
      content_hash_start: 'h1', content_hash_end: 'h2',
    });
    expect(typeof windowId).toBe('number');

    store.insertOutcome({
      fp: 'fp1', window_id: windowId, outcome: 'resolved',
      fix_applied: 'verbatim', collateral_added: 0,
    });

    const s = store.stats();
    expect(s.windows).toBe(1);
    expect(s.outcomes).toBe(1);

    const outcomes = store.query('SELECT * FROM outcomes WHERE fp = ?', ['fp1']);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('resolved');
    expect(outcomes[0].fix_applied).toBe('verbatim');
    // Denormalized columns are derived from the window when not passed in.
    expect(outcomes[0].session_id).toBe('s1');
    expect(outcomes[0].file).toBe('app/views/pages/index.html.liquid');
  });

  test('dedupes on (session_id, file, fp) — terminal state wins', () => {
    const w1 = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z',
    });
    const w2 = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 1,
      ts_start: '2026-04-17T10:01:00Z', ts_end: '2026-04-17T10:02:00Z',
    });
    const w3 = store.insertWindow({
      session_id: 's1', file: 'app/views/pages/index.html.liquid', idx: 2,
      ts_start: '2026-04-17T10:02:00Z', ts_end: '2026-04-17T10:03:00Z',
    });

    // Diagnostic flips: resolved in W1, regressed in W2, unchanged in W3.
    store.insertOutcome({ fp: 'dup', window_id: w1, outcome: 'resolved' });
    store.insertOutcome({ fp: 'dup', window_id: w2, outcome: 'regressed' });
    store.insertOutcome({ fp: 'dup', window_id: w3, outcome: 'unchanged' });

    const rows = store.query('SELECT * FROM outcomes WHERE fp = ?', ['dup']);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('unchanged');
    expect(rows[0].window_id).toBe(w3);
  });

  test('different sessions with same fp stay separate', () => {
    const wA = store.insertWindow({
      session_id: 'sA', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T10:00:00Z', ts_end: '2026-04-17T10:01:00Z',
    });
    const wB = store.insertWindow({
      session_id: 'sB', file: 'app/views/pages/index.html.liquid', idx: 0,
      ts_start: '2026-04-17T11:00:00Z', ts_end: '2026-04-17T11:01:00Z',
    });
    store.insertOutcome({ fp: 'shared', window_id: wA, outcome: 'resolved' });
    store.insertOutcome({ fp: 'shared', window_id: wB, outcome: 'regressed' });

    const rows = store.query('SELECT session_id, outcome FROM outcomes WHERE fp = ? ORDER BY session_id', ['shared']);
    expect(rows).toHaveLength(2);
    expect(rows[0].session_id).toBe('sA');
    expect(rows[0].outcome).toBe('resolved');
    expect(rows[1].session_id).toBe('sB');
    expect(rows[1].outcome).toBe('regressed');
  });
});

describe('query helpers', () => {
  test('query returns all matching rows', () => {
    store.ingestEvent({
      v: 1, session_id: 's1', ts: '2026-04-17T10:00:00Z',
      kind: 'validator_emit', fp: 'x1', file: 'f1.liquid',
      hint_rule_id: 'check_a', proposed_fixes: [],
    });
    store.ingestEvent({
      v: 1, session_id: 's1', ts: '2026-04-17T10:00:01Z',
      kind: 'validator_emit', fp: 'x2', file: 'f2.liquid',
      hint_rule_id: 'check_a', proposed_fixes: [],
    });
    const rows = store.query('SELECT * FROM diagnostics WHERE check_name = ?', ['check_a']);
    expect(rows).toHaveLength(2);
  });

  test('queryOne returns single row or null', () => {
    store.ingestEvent({
      v: 1, session_id: 's1', ts: '2026-04-17T10:00:00Z',
      kind: 'validator_emit', fp: 'only1', file: 'f.liquid',
      hint_rule_id: 'c1', proposed_fixes: [],
    });
    const row = store.queryOne('SELECT * FROM diagnostics WHERE fp = ?', ['only1']);
    expect(row).not.toBeNull();
    expect(row.fp).toBe('only1');

    const none = store.queryOne('SELECT * FROM diagnostics WHERE fp = ?', ['nope']);
    expect(none).toBeNull();
  });
});

describe('outcome dedup invariants', () => {
  test('one outcome per (session, file, fp) across N flip windows (terminal state wins)', () => {
    const sessDir = tmpSessionDir();
    const diag = { check: 'MissingPartial', message: "Missing partial 'blog/card'", severity: 'error', line: 1 };
    // Diagnostic flips present/absent four times across five validate_code calls.
    // Pre-A1 this yielded four outcome rows for the same fp (alternating
    // resolved/regressed). Post-A1 there is exactly one row and it reflects
    // the terminal state — the last window saw the diagnostic reappear.
    const calls = [
      { ts: '2026-04-17T10:00:00.000Z', output: { errors: [diag], warnings: [] } },
      { ts: '2026-04-17T10:01:00.000Z', output: { errors: [], warnings: [] } },
      { ts: '2026-04-17T10:02:00.000Z', output: { errors: [diag], warnings: [] } },
      { ts: '2026-04-17T10:03:00.000Z', output: { errors: [], warnings: [] } },
      { ts: '2026-04-17T10:04:00.000Z', output: { errors: [diag], warnings: [] } },
    ].map(c => JSON.stringify({
      v: 1, session_id: 'test-session', kind: 'tool_call', tool: 'validate_code',
      duration_ms: 80, success: true,
      input: { file_path: 'app/views/pages/index.html.liquid', content: '{% render "blog/card" %}' },
      ts: c.ts, output: c.output,
    }));
    const lines = [makeServerStartLine(), ...calls].join('\n');
    writeFileSync(join(sessDir, 'events.ndjson'), lines + '\n');

    store.ingestSession(sessDir);

    const outcomeRows = store.query(`SELECT outcome FROM outcomes`);
    expect(outcomeRows).toHaveLength(1);
    expect(outcomeRows[0].outcome).toBe('regressed');

    // Invariant: resolved ≤ distinct fps with outcomes. Here resolved = 0.
    const resolved = store.queryOne(`SELECT COUNT(*) AS c FROM outcomes WHERE outcome = 'resolved'`).c;
    const uniqueFps = store.queryOne(`SELECT COUNT(DISTINCT fp) AS c FROM outcomes`).c;
    expect(resolved).toBeLessThanOrEqual(uniqueFps);

    rmSync(sessDir, { recursive: true, force: true });
  });
});

describe('window classification via ingestion', () => {
  test('produces windows and outcomes from consecutive validate_code calls', () => {
    const sessDir = tmpSessionDir();
    const lines = [
      makeServerStartLine(),
      JSON.stringify({
        v: 1, session_id: 'test-session', ts: '2026-04-17T10:00:01.000Z',
        kind: 'tool_call', tool: 'validate_code', duration_ms: 100, success: true,
        input: { file_path: 'app/views/pages/index.html.liquid', content: '{% render "blog_posts/card" %}' },
        output: { errors: [{ check: 'MissingPartial', message: "Missing partial 'blog_posts/card'", severity: 'error', line: 1 }], warnings: [] },
      }),
      JSON.stringify({
        v: 1, session_id: 'test-session', ts: '2026-04-17T10:02:00.000Z',
        kind: 'tool_call', tool: 'validate_code', duration_ms: 80, success: true,
        input: { file_path: 'app/views/pages/index.html.liquid', content: '{% render "blog_posts/card" %}' },
        output: { errors: [], warnings: [] },
      }),
    ].join('\n');
    writeFileSync(join(sessDir, 'events.ndjson'), lines + '\n');

    store.ingestSession(sessDir);
    const s = store.stats();
    expect(s.windows).toBe(1);
    expect(s.outcomes).toBe(1);

    const outcomes = store.query('SELECT * FROM outcomes');
    expect(outcomes[0].outcome).toBe('resolved');

    rmSync(sessDir, { recursive: true, force: true });
  });
});

describe('real fixture ingestion', () => {
  test('ingests fixture sessions without error', () => {
    const fixtureDir = join(import.meta.dir, '../../tests/fixtures/broken-project/.pos-supervisor/sessions');
    const result = store.rebuild(fixtureDir);
    expect(result.sessions).toBeGreaterThan(0);
    expect(result.events).toBeGreaterThan(0);

    const s = store.stats();
    expect(s.diagnostics).toBeGreaterThan(0);
  });
});

// ── proposed_fixes.rule_id persistence (I1) ─────────────────────────────────

describe('proposed_fixes rule_id persistence', () => {
  test('ingestValidatorEmit writes rule_id on every fix', () => {
    store.ingestEvent({
      v: 1, session_id: 's1', ts: '2026-04-17T10:00:00Z',
      kind: 'validator_emit',
      fp: 'fp-i1', template_fp: 'tpl', file: 'app/views/pages/x.liquid',
      proposed_fixes: [
        { range: null, new_text_hash: 'h1', kind: 'text_edit',    rule_id: 'UnknownFilter.suggest_nearest' },
        { range: null, new_text_hash: 'h2', kind: 'text_edit',    rule_id: 'heuristic:UnknownFilter.text_edit' },
        { range: null, new_text_hash: null, kind: 'guidance',     rule_id: null },
      ],
    });
    const rows = store.query(`SELECT kind, rule_id FROM proposed_fixes WHERE fp = 'fp-i1' ORDER BY rowid`);
    expect(rows).toHaveLength(3);
    expect(rows[0].rule_id).toBe('UnknownFilter.suggest_nearest');
    expect(rows[1].rule_id).toBe('heuristic:UnknownFilter.text_edit');
    expect(rows[2].rule_id).toBeNull();
  });
});

// ── hint_md_hash persistence (Bug 2) ─────────────────────────────────────────

describe('hint_md_hash persistence', () => {
  test('ingestValidatorEmit writes hint_md_hash column', () => {
    store.ingestEvent({
      v: 1,
      session_id: 'hs',
      ts: '2026-04-17T10:00:00.000Z',
      kind: 'validator_emit',
      fp: 'hfp',
      template_fp: 'htpl',
      file: 'app/views/pages/x.liquid',
      hint_rule_id: 'X.rule',
      hint_md_hash: 'deadbeef'.repeat(8),
      content_hash: 'feedface'.repeat(8),
      proposed_fixes: [],
    });
    const row = store.queryOne(
      `SELECT hint_md_hash FROM diagnostics WHERE fp = 'hfp'`,
    );
    expect(row.hint_md_hash).toBe('deadbeef'.repeat(8));
  });

  test('null hint_md_hash stays null', () => {
    store.ingestEvent({
      v: 1,
      session_id: 'hs2',
      ts: '2026-04-17T10:00:00.000Z',
      kind: 'validator_emit',
      fp: 'hfp2',
      file: 'app/views/pages/y.liquid',
      content_hash: 'feedface'.repeat(8),
      proposed_fixes: [],
    });
    const row = store.queryOne(
      `SELECT hint_md_hash FROM diagnostics WHERE fp = 'hfp2'`,
    );
    expect(row.hint_md_hash).toBeNull();
  });
});

// ── fix_applied classification via blobStore (Bug 1) ─────────────────────────

describe('classifyAndStoreWindows: fix_applied classification', () => {
  let blobDir;
  let blobStore;
  beforeEach(() => {
    blobDir = join(tmpdir(), `pos-blobs-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    blobStore = openBlobStore(blobDir);
  });
  afterEach(() => {
    try { rmSync(blobDir, { recursive: true, force: true }); } catch {}
  });

  /**
   * Write a session whose validator_emit fp matches the window classifier's
   * computed fp. Both paths use fingerprint(check, file, messageTemplate) —
   * diverging breaks the emit-index lookup. Helper shared by the test cases
   * below so the fp calculation is visible in one place.
   */
  function fpRow(sessDir, { sid, file, startContent, endContent, fixText, startTs, endTs, startDiag, endDiag }) {
    const startHash = blobStore.put(startContent);
    blobStore.put(endContent);
    const fixHash = blobStore.put(fixText);

    const tmpl = templateOf(startDiag.check, startDiag.message);
    const fp = fingerprint(startDiag.check, file, tmpl);

    const lines = [
      makeServerStartLine({ session_id: sid }),
      JSON.stringify({
        v: 1, session_id: sid, ts: startTs,
        kind: 'validator_emit',
        fp, template_fp: 'tpl', file,
        content_hash: startHash,
        proposed_fixes: [{ range: null, new_text_hash: fixHash, kind: 'text_edit' }],
      }),
      JSON.stringify({
        v: 1, session_id: sid, ts: startTs,
        kind: 'tool_call', tool: 'validate_code', duration_ms: 50, success: true,
        input: { file_path: file, content: startContent },
        output: { errors: [startDiag], warnings: [] },
      }),
      JSON.stringify({
        v: 1, session_id: sid, ts: endTs,
        kind: 'tool_call', tool: 'validate_code', duration_ms: 45, success: true,
        input: { file_path: file, content: endContent },
        output: { errors: endDiag ? [endDiag] : [], warnings: [] },
      }),
    ].join('\n');
    writeFileSync(join(sessDir, 'events.ndjson'), lines + '\n');
    return { fp };
  }

  test('resolved + fix text present in end content → verbatim', () => {
    const sessDir = tmpSessionDir();
    store.close();
    store = openAnalyticsStore(dbPath, { blobStore });

    fpRow(sessDir, {
      sid: 'sfa', file: 'app/views/pages/x.liquid',
      startContent: "{{ 'hello' | capitalise }}",
      endContent:   "{{ 'hello' | capitalize }}",
      fixText: 'capitalize',
      startTs: '2026-04-17T10:00:01.000Z', endTs: '2026-04-17T10:01:00.000Z',
      startDiag: { check: 'UnknownFilter', message: "Unknown filter 'capitalise'", severity: 'error', line: 1 },
    });

    store.ingestSession(sessDir);

    const rows = store.query(`SELECT outcome, fix_applied FROM outcomes`);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('resolved');
    expect(rows[0].fix_applied).toBe('verbatim');

    rmSync(sessDir, { recursive: true, force: true });
  });

  test('resolved + fix text NOT in end content → partial', () => {
    const sessDir = tmpSessionDir();
    store.close();
    store = openAnalyticsStore(dbPath, { blobStore });

    fpRow(sessDir, {
      sid: 'sfa2', file: 'app/views/pages/y.liquid',
      startContent: "{{ 'hello' | capitalise }}",
      endContent:   "{{ 'hello' | upcase }}",
      fixText: 'capitalize',
      startTs: '2026-04-17T10:00:01.000Z', endTs: '2026-04-17T10:01:00.000Z',
      startDiag: { check: 'UnknownFilter', message: "Unknown filter 'capitalise'", severity: 'error', line: 1 },
    });

    store.ingestSession(sessDir);

    const rows = store.query(`SELECT outcome, fix_applied FROM outcomes`);
    expect(rows[0].outcome).toBe('resolved');
    expect(rows[0].fix_applied).toBe('partial');

    rmSync(sessDir, { recursive: true, force: true });
  });

  test('no blobStore → fix_applied stays null (backward compat)', () => {
    const sessDir = tmpSessionDir();
    const lines = [
      makeServerStartLine(),
      JSON.stringify({
        v: 1, session_id: 'test-session', ts: '2026-04-17T10:00:01.000Z',
        kind: 'tool_call', tool: 'validate_code', duration_ms: 100, success: true,
        input: { file_path: 'app/views/pages/z.liquid', content: "X" },
        output: { errors: [{ check: 'UnknownFilter', message: "Unknown filter 'x'", severity: 'error', line: 1 }], warnings: [] },
      }),
      JSON.stringify({
        v: 1, session_id: 'test-session', ts: '2026-04-17T10:02:00.000Z',
        kind: 'tool_call', tool: 'validate_code', duration_ms: 80, success: true,
        input: { file_path: 'app/views/pages/z.liquid', content: "Y" },
        output: { errors: [], warnings: [] },
      }),
    ].join('\n');
    writeFileSync(join(sessDir, 'events.ndjson'), lines + '\n');

    store.ingestSession(sessDir);
    const rows = store.query(`SELECT outcome, fix_applied FROM outcomes`);
    expect(rows[0].outcome).toBe('resolved');
    expect(rows[0].fix_applied).toBeNull();

    rmSync(sessDir, { recursive: true, force: true });
  });

  test('regressed outcomes skip fix_applied classification', () => {
    const sessDir = tmpSessionDir();
    store.close();
    store = openAnalyticsStore(dbPath, { blobStore });

    const START = 'OLD';
    const END = 'NEW';
    const regressedDiag = { check: 'UnusedAssign', message: "Variable 'x' is assigned but never used", severity: 'warning', line: 1 };
    const file = 'app/views/pages/r.liquid';
    const fp = fingerprint(regressedDiag.check, file, templateOf(regressedDiag.check, regressedDiag.message));

    const startHash = blobStore.put(START);
    blobStore.put(END);
    const fixHash = blobStore.put('IRRELEVANT');

    const lines = [
      makeServerStartLine({ session_id: 'sr' }),
      JSON.stringify({
        v: 1, session_id: 'sr', ts: '2026-04-17T10:01:00.000Z',
        kind: 'validator_emit',
        fp, template_fp: 'tpl', file,
        content_hash: startHash,
        proposed_fixes: [{ range: null, new_text_hash: fixHash, kind: 'text_edit' }],
      }),
      JSON.stringify({
        v: 1, session_id: 'sr', ts: '2026-04-17T10:00:00.000Z',
        kind: 'tool_call', tool: 'validate_code', duration_ms: 50, success: true,
        input: { file_path: file, content: START },
        output: { errors: [], warnings: [] },
      }),
      JSON.stringify({
        v: 1, session_id: 'sr', ts: '2026-04-17T10:01:00.000Z',
        kind: 'tool_call', tool: 'validate_code', duration_ms: 50, success: true,
        input: { file_path: file, content: END },
        output: { errors: [regressedDiag], warnings: [] },
      }),
    ].join('\n');
    writeFileSync(join(sessDir, 'events.ndjson'), lines + '\n');

    store.ingestSession(sessDir);

    const rows = store.query(`SELECT outcome, fix_applied FROM outcomes WHERE fp = ?`, [fp]);
    expect(rows[0].outcome).toBe('regressed');
    expect(rows[0].fix_applied).toBeNull();

    rmSync(sessDir, { recursive: true, force: true });
  });
});
