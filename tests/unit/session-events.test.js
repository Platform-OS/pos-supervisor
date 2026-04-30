/**
 * session-events unit tests — pins the event envelope, per-kind payload
 * validation, version upgrader contract, and append-only NDJSON I/O.
 *
 * The on-disk NDJSON log is the canonical history; the reducer's projection
 * is rebuildable from it. These tests make sure write/read are symmetric so
 * Phase A's acceptance gate (events.ndjson replay reproduces getStatus)
 * has a sound foundation.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EVENT_VERSION,
  KNOWN_KINDS,
  KIND_SCHEMAS,
  makeEvent,
  validateEvent,
  readEvent,
  readEventLog,
  createEventWriter,
} from '../../src/core/session-events.js';

const FIXED_TS = '2025-01-01T00:00:00.000Z';
const SID = 'test-session-1';

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-events-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('session-events: schema registry', () => {
  it('exposes the expected event kinds', () => {
    expect(KNOWN_KINDS).toEqual([
      'server_start',
      'server_stop',
      'pos_cli_resolved',
      'lsp_event',
      'index_event',
      'fs_change',
      'tool_call',
      'validator_emit',
      'log',
      'cac_decision',
    ]);
    for (const kind of KNOWN_KINDS) {
      expect(KIND_SCHEMAS[kind]).toBeDefined();
    }
  });

  it('current version is at least 1', () => {
    expect(EVENT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('session-events: makeEvent + validateEvent', () => {
  it('builds a server_start event with envelope + payload', () => {
    const e = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'server_start',
      payload: { project_dir: '/x', version: '0.0.0', http_port: 13800, started_at: FIXED_TS },
    });
    expect(e.v).toBe(EVENT_VERSION);
    expect(e.session_id).toBe(SID);
    expect(e.ts).toBe(FIXED_TS);
    expect(e.kind).toBe('server_start');
    expect(e.project_dir).toBe('/x');
    expect(e.http_port).toBe(13800);
  });

  it('rejects an unknown kind', () => {
    expect(() => makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'bogus_kind', payload: {},
    })).toThrow(/unknown kind/i);
  });

  it('rejects missing session_id / ts', () => {
    expect(() => makeEvent({
      session_id: '', ts: FIXED_TS, kind: 'log', payload: { message: 'x' },
    })).toThrow();
    expect(() => makeEvent({
      session_id: SID, ts: '', kind: 'log', payload: { message: 'x' },
    })).toThrow();
  });

  it('rejects a payload that fails the per-kind schema', () => {
    expect(() => makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'lsp_event',
      payload: { phase: 'not-a-phase' },
    })).toThrow();
  });

  it('validateEvent returns a frozen object', () => {
    const e = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'log', payload: { level: 'info', message: 'hi' },
    });
    expect(Object.isFrozen(e)).toBe(true);
  });

  it('tool_call payload is permissive on input/output (validated at tool boundary)', () => {
    const e = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'tool_call',
      payload: {
        tool: 'validate_code',
        duration_ms: 12,
        success: true,
        input: { file_path: 'a.liquid', anything: { nested: true } },
        output: { errors: [], warnings: [{ check: 'X' }] },
      },
    });
    expect(e.input.anything.nested).toBe(true);
    expect(e.output.warnings[0].check).toBe('X');
  });

  // Regression: prior to registering the schema, every cac_decision emit
  // threw "unknown kind" inside makeEvent, the throw was swallowed by the
  // caller's try/catch, and the predictor's audit trail was silently lost
  // on every restart. Pin the happy path AND every rejection edge so a
  // future refactor can't reopen the hole quietly.
  it('builds a cac_decision event with envelope + payload', () => {
    const e = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'cac_decision',
      payload: {
        file: 'app/views/pages/index.liquid',
        rule_id: 'MissingPartial.create_file',
        check: 'MissingPartial',
        severity: 'error',
        file_domain: 'pages',
        p_adopted: 0.18,
        p_lower: 0.05,
        p_upper: 0.45,
        n_samples: 7,
        feature: 'rule_id',
        decision: 'downgrade',
        reason: 'below_threshold',
        mode: 'shadow',
      },
    });
    expect(e.kind).toBe('cac_decision');
    expect(e.rule_id).toBe('MissingPartial.create_file');
    expect(e.feature).toBe('rule_id');
    expect(e.decision).toBe('downgrade');
    expect(e.mode).toBe('shadow');
  });

  it('cac_decision accepts the no-signal `prior` shape with null probabilities', () => {
    const e = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'cac_decision',
      payload: {
        file: 'app/views/pages/x.liquid',
        rule_id: 'NewCheck.unmatched',
        check: 'NewCheck',
        severity: 'warning',
        file_domain: null,
        p_adopted: 0.5,
        p_lower: null,
        p_upper: null,
        n_samples: 0,
        feature: 'prior',
        decision: 'allow',
        reason: 'no_signal',
        mode: 'shadow',
      },
    });
    expect(e.feature).toBe('prior');
    expect(e.p_lower).toBeNull();
  });

  it('cac_decision rejects a payload that smuggles the envelope `ts` key', () => {
    // This is the exact collision that used to drop events at runtime — the
    // ring entry carried `ts` (its own timestamp) and was passed verbatim
    // as a payload, hitting `ENVELOPE_KEYS` in makeEvent.
    expect(() => makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'cac_decision',
      payload: {
        ts: FIXED_TS,
        rule_id: 'X', severity: 'error',
        p_adopted: 0.5, p_lower: null, p_upper: null,
        n_samples: 0, feature: 'prior', decision: 'allow', reason: '',
        mode: 'shadow',
      },
    })).toThrow(/reserved envelope key/i);
  });

  it('cac_decision rejects an unknown decision value', () => {
    expect(() => makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'cac_decision',
      payload: {
        rule_id: 'X', severity: 'error',
        p_adopted: 0.5, p_lower: null, p_upper: null,
        n_samples: 0, feature: 'prior', decision: 'mute_forever', reason: '',
        mode: 'shadow',
      },
    })).toThrow();
  });

  it('cac_decision round-trips through readEvent / writeEvent', () => {
    const written = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'cac_decision',
      payload: {
        file: 'a.liquid',
        rule_id: 'PartialCallArguments.required_render',
        check: 'PartialCallArguments',
        severity: 'warning',
        file_domain: 'partials',
        p_adopted: 0.17, p_lower: 0.03, p_upper: 0.41,
        n_samples: 8, feature: 'rule_id+domain',
        decision: 'downgrade', reason: 'below_threshold',
        mode: 'active',
      },
    });
    const back = readEvent(JSON.stringify(written));
    expect(back).toEqual(written);
  });
});

describe('session-events: readEvent', () => {
  it('round-trips JSON encoding', () => {
    const written = makeEvent({
      session_id: SID, ts: FIXED_TS, kind: 'index_event',
      payload: { index: 'objects', status: 'ready', count: 42 },
    });
    const back = readEvent(JSON.stringify(written));
    expect(back).toEqual(written);
  });

  it('rejects missing version', () => {
    expect(() => readEvent(JSON.stringify({ kind: 'log', session_id: SID, ts: FIXED_TS, message: 'x' })))
      .toThrow(/missing version/i);
  });

  it('rejects a future event version', () => {
    const fake = JSON.stringify({ v: EVENT_VERSION + 1, session_id: SID, ts: FIXED_TS, kind: 'log', message: 'x' });
    expect(() => readEvent(fake)).toThrow(/newer than reader/i);
  });

  it('rejects malformed JSON', () => {
    expect(() => readEvent('{not-json')).toThrow(/invalid JSON/i);
  });

  it('rejects empty input', () => {
    expect(() => readEvent('')).toThrow(/empty/i);
  });
});

describe('session-events: createEventWriter + readEventLog', () => {
  it('appends events and reads them back in order', () => {
    const { dir, cleanup } = workDir();
    try {
      const file = join(dir, 'sub', 'events.ndjson');
      const writer = createEventWriter(file);

      const e1 = makeEvent({
        session_id: SID, ts: FIXED_TS, kind: 'server_start',
        payload: { project_dir: '/p', version: '1.0.0', started_at: FIXED_TS },
      });
      const e2 = makeEvent({
        session_id: SID, ts: FIXED_TS, kind: 'tool_call',
        payload: { tool: 'lookup', duration_ms: 5, success: true },
      });
      writer.append(e1);
      writer.append(e2);
      writer.close();

      const events = readEventLog(file);
      expect(events).toHaveLength(2);
      expect(events[0].kind).toBe('server_start');
      expect(events[1].tool).toBe('lookup');
    } finally {
      cleanup();
    }
  });

  it('returns [] for a missing file', () => {
    const { dir, cleanup } = workDir();
    try {
      expect(readEventLog(join(dir, 'nope.ndjson'))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('skips malformed lines via onError callback', () => {
    const { dir, cleanup } = workDir();
    try {
      const file = join(dir, 'mixed.ndjson');
      const good = makeEvent({
        session_id: SID, ts: FIXED_TS, kind: 'log',
        payload: { level: 'info', message: 'ok' },
      });
      writeFileSync(file, [
        JSON.stringify(good),
        'broken-line',
        JSON.stringify({ v: EVENT_VERSION, session_id: SID, ts: FIXED_TS, kind: 'unknown_kind' }),
        JSON.stringify(good),
      ].join('\n') + '\n');

      const errors = [];
      const events = readEventLog(file, { onError: (e) => errors.push(e) });
      expect(events).toHaveLength(2);
      expect(errors.length).toBe(2);
      expect(errors[0].line).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('writer cannot append after close', () => {
    const { dir, cleanup } = workDir();
    try {
      const writer = createEventWriter(join(dir, 'e.ndjson'));
      writer.close();
      expect(writer.isClosed).toBe(true);
      expect(() => writer.append(makeEvent({
        session_id: SID, ts: FIXED_TS, kind: 'log', payload: { message: 'x' },
      }))).toThrow(/closed/i);
    } finally {
      cleanup();
    }
  });

  it('persists raw line content as valid NDJSON (one event per line)', () => {
    const { dir, cleanup } = workDir();
    try {
      const file = join(dir, 'raw.ndjson');
      const writer = createEventWriter(file);
      writer.append(makeEvent({
        session_id: SID, ts: FIXED_TS, kind: 'log',
        payload: { level: 'info', message: 'one' },
      }));
      writer.append(makeEvent({
        session_id: SID, ts: FIXED_TS, kind: 'log',
        payload: { level: 'warn', message: 'two' },
      }));
      writer.close();

      const lines = readFileSync(file, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      cleanup();
    }
  });
});
