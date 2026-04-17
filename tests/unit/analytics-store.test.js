import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
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
    expect(s.schema_version).toBe(1);
    expect(s.events).toBe(0);
    expect(s.diagnostics).toBe(0);
  });

  test('meta stores and retrieves values', () => {
    expect(store.getMeta('schema_version')).toBe('1');
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
