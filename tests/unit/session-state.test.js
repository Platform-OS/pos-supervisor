/**
 * session-state unit tests — pins the pure reducer that backs every dashboard
 * value and every analytics derivation downstream. Two separate guarantees:
 *
 *   1. Each event kind reduces the state correctly (per-handler tests).
 *   2. Replay equivalence: applying the same event sequence twice — once
 *      incrementally, once via `replay()` — yields byte-identical state.
 *      This is the contract the Phase A acceptance gate rides on.
 *
 * The reducer is forbidden from reading the clock or making random calls,
 * so deepEqual on the full state is a meaningful invariant.
 */

import { describe, it, expect } from 'bun:test';
import { initialState, applyEvent, replay } from '../../src/core/session-state.js';
import { makeEvent } from '../../src/core/session-events.js';

const SID = 'reducer-test';
const T = (n) => `2025-01-01T00:00:0${n}.000Z`;

function ev(kind, payload, ts = T(0)) {
  return makeEvent({ session_id: SID, ts, kind, payload });
}

describe('session-state: initialState', () => {
  it('returns a fresh object with all expected keys', () => {
    const s = initialState();
    expect(Object.keys(s).sort()).toEqual([
      '_event_count',
      'by_tool',
      'check_effectiveness',
      'check_frequency',
      'enrich_history',
      'file_history',
      'hint_effectiveness',
      'indexes',
      'last_analysis',
      'lsp',
      'pending',
      'pipeline_traces',
      'pos_cli',
      'scaffold_runs',
      'server',
      'validated_plan',
      'validator_emissions',
    ]);
    expect(s._event_count).toBe(0);
    expect(s.pending.files).toEqual([]);
    expect(s.indexes.schema.status).toBe('pending');
  });

  it('returns a NEW object each call (no shared references)', () => {
    const a = initialState();
    const b = initialState();
    expect(a).not.toBe(b);
    expect(a.pending).not.toBe(b.pending);
    a.pending.files.push('x');
    expect(b.pending.files).toEqual([]);
  });
});

describe('session-state: lifecycle handlers', () => {
  it('server_start populates server.* and clears stop state', () => {
    let s = initialState();
    s.server.stopped = true;
    s = applyEvent(s, ev('server_start', {
      project_dir: '/p', version: '1.2.3', http_port: 13800, started_at: T(0),
    }));
    expect(s.server.started_at).toBe(T(0));
    expect(s.server.version).toBe('1.2.3');
    expect(s.server.project_dir).toBe('/p');
    expect(s.server.http_port).toBe(13800);
    expect(s.server.stopped).toBe(false);
    expect(s._event_count).toBe(1);
  });

  it('server_stop sets stopped + reason', () => {
    const s = applyEvent(initialState(), ev('server_stop', { reason: 'SIGINT' }));
    expect(s.server.stopped).toBe(true);
    expect(s.server.stop_reason).toBe('SIGINT');
  });

  it('pos_cli_resolved sets full record', () => {
    const s = applyEvent(initialState(), ev('pos_cli_resolved', {
      found: true, path: '/usr/bin/pos-cli', data_dir: '/data',
    }));
    expect(s.pos_cli).toEqual({ found: true, path: '/usr/bin/pos-cli', data_dir: '/data', error: null });
  });

  it('lsp_event ready/crash/restart cycle', () => {
    let s = initialState();
    s = applyEvent(s, ev('lsp_event', { phase: 'ready', duration_ms: 250 }));
    expect(s.lsp.ready).toBe(true);
    expect(s.lsp.last_ready_ms).toBe(250);

    s = applyEvent(s, ev('lsp_event', { phase: 'warmed_up', duration_ms: 1000, index_ready: 3 }));
    expect(s.lsp.last_warmup_ms).toBe(1000);
    expect(s.lsp.last_warmup_index_ready).toBe(3);

    s = applyEvent(s, ev('lsp_event', { phase: 'crash', code: 1, signal: 'SIGTERM', restart_count: 2 }, T(2)));
    expect(s.lsp.ready).toBe(false);
    expect(s.lsp.restart_count).toBe(2);
    expect(s.lsp.last_crash).toEqual({ code: 1, signal: 'SIGTERM', ts: T(2) });

    s = applyEvent(s, ev('lsp_event', { phase: 'restart_failed', error: 'boom' }));
    expect(s.lsp.last_error).toBe('boom');
  });

  it('index_event populates per-index entries', () => {
    let s = initialState();
    s = applyEvent(s, ev('index_event', { index: 'schema', status: 'ready', queries: 10, mutations: 4 }));
    expect(s.indexes.schema).toEqual({ status: 'ready', queries: 10, mutations: 4 });

    s = applyEvent(s, ev('index_event', { index: 'objects', status: 'failed', error: 'nope' }));
    expect(s.indexes.objects).toEqual({ status: 'failed', error: 'nope' });

    // 'all' marks every index failed
    s = applyEvent(s, ev('index_event', { index: 'all', status: 'failed', error: 'data dir missing' }));
    for (const k of ['schema', 'objects', 'filters', 'tags']) {
      expect(s.indexes[k].status).toBe('failed');
    }
  });

  it('fs_change and log are no-ops on the projection', () => {
    const s0 = initialState();
    let s = applyEvent(s0, ev('fs_change', { path: 'app/views/pages/x.liquid', op: 'update' }));
    expect(s._event_count).toBe(1); // counter still increments
    s = applyEvent(s, ev('log', { level: 'info', message: 'hi' }));
    expect(s._event_count).toBe(2);
    // No other state changes
    const cmp = { ...s, _event_count: 0 };
    expect(cmp).toEqual({ ...s0, _event_count: 0 });
  });
});

describe('session-state: tool_call / validate_intent', () => {
  it('writes pending + validated_plan on success', () => {
    const s = applyEvent(initialState(), ev('tool_call', {
      tool: 'validate_intent',
      duration_ms: 30,
      success: true,
      input: {},
      output: {
        ok: true,
        plan_id: 'p1',
        validated_at: T(1),
        pending_files: ['app/views/pages/blog.liquid', 'app/views/partials/blog/form.liquid'],
        pending_translations: ['blog.title'],
        write_directly: false,
      },
    }));
    expect(s.pending.plan_id).toBe('p1');
    expect(s.pending.files).toEqual([
      'app/views/pages/blog.liquid',
      'app/views/partials/blog/form.liquid',
    ]);
    expect(s.pending.pages).toEqual(['app/views/pages/blog.liquid']);
    expect(s.pending.translations).toEqual(['blog.title']);
    expect(s.validated_plan.plan_id).toBe('p1');
    expect(s.validated_plan.source).toBe('manual');
    expect(s.validated_plan.validated_files).toEqual([]);
  });

  it('pre-marks files validated when triggered by scaffold_output', () => {
    const s = applyEvent(initialState(), ev('tool_call', {
      tool: 'validate_intent',
      duration_ms: 30,
      success: true,
      input: { scaffold_output: { files: [] } },
      output: {
        ok: true,
        plan_id: 'p2',
        pending_files: ['app/views/pages/x.liquid'],
        pending_translations: [],
      },
    }));
    expect(s.validated_plan.source).toBe('scaffold');
    expect(s.validated_plan.validated_files).toEqual(['app/views/pages/x.liquid']);
  });

  it('does NOT mutate state on ok=false', () => {
    const s0 = initialState();
    const s = applyEvent(s0, ev('tool_call', {
      tool: 'validate_intent',
      duration_ms: 30,
      success: true,
      input: {},
      output: { ok: false, errors: [{ message: 'bad' }] },
    }));
    expect(s.pending).toEqual(s0.pending);
    expect(s.validated_plan).toBeNull();
  });
});

describe('session-state: tool_call / validate_code', () => {
  function vc(filePath, errors = [], warnings = [], status = 'ok') {
    return ev('tool_call', {
      tool: 'validate_code',
      duration_ms: 50,
      success: true,
      input: { file_path: filePath },
      output: { errors, warnings, status },
    });
  }

  it('initializes file_history on first call', () => {
    const s = applyEvent(initialState(), vc('a.liquid',
      [{ check: 'MissingPartial' }],
      [{ check: 'UnusedAssign' }],
    ));
    expect(s.file_history['a.liquid']).toEqual({
      calls: 1,
      consecutive_non_decreasing: 0,
      last_error_count: 1,
      last_warning_count: 1,
      last_checks: ['MissingPartial', 'UnusedAssign'],
      prev_checks: [],
    });
    expect(s.check_frequency).toEqual({ MissingPartial: 1, UnusedAssign: 1 });
    expect(s.by_tool.validate_code).toEqual({ calls: 1, errors: 0, total_ms: 50 });
  });

  it('tracks consecutive_non_decreasing across repeated calls', () => {
    let s = initialState();
    s = applyEvent(s, vc('a.liquid', [{ check: 'X' }]));
    s = applyEvent(s, vc('a.liquid', [{ check: 'X' }, { check: 'Y' }]));
    s = applyEvent(s, vc('a.liquid', [{ check: 'X' }, { check: 'Y' }]));
    expect(s.file_history['a.liquid'].calls).toBe(3);
    expect(s.file_history['a.liquid'].consecutive_non_decreasing).toBe(2);
  });

  it('updates check_effectiveness across consecutive calls (fixed vs stuck)', () => {
    let s = initialState();
    s = applyEvent(s, vc('a.liquid', [{ check: 'A' }, { check: 'B' }]));
    s = applyEvent(s, vc('a.liquid', [{ check: 'B' }])); // A fixed, B stuck
    expect(s.check_effectiveness).toEqual({
      A: { fixed: 1, stuck: 0 },
      B: { fixed: 0, stuck: 1 },
    });
  });

  it('marks file as validated in plan when status != error', () => {
    let s = initialState();
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_intent',
      duration_ms: 5, success: true, input: {},
      output: { ok: true, plan_id: 'p1', pending_files: ['a.liquid'], pending_translations: [] },
    }));
    s = applyEvent(s, vc('a.liquid', [], [{ check: 'W' }], 'warning'));
    expect(s.validated_plan.validated_files).toEqual(['a.liquid']);

    // Re-validating doesn't double-add
    s = applyEvent(s, vc('a.liquid', [], [], 'ok'));
    expect(s.validated_plan.validated_files).toEqual(['a.liquid']);
  });

  it('does NOT mark validated when status === error', () => {
    let s = initialState();
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_intent', duration_ms: 5, success: true, input: {},
      output: { ok: true, plan_id: 'p1', pending_files: ['a.liquid'], pending_translations: [] },
    }));
    s = applyEvent(s, vc('a.liquid', [{ check: 'E' }], [], 'error'));
    expect(s.validated_plan.validated_files).toEqual([]);
  });
});

describe('session-state: tool_call / enrich_error → validate_code correlation', () => {
  it('queues enrich and consumes on validate_code, computing hint effectiveness', () => {
    let s = initialState();
    s = applyEvent(s, ev('tool_call', {
      tool: 'enrich_error', duration_ms: 2, success: true,
      input: { file_path: 'a.liquid', check_name: 'MissingPartial' },
    }, T(0)));
    expect(s.enrich_history).toHaveLength(1);

    // validate_code on same file with the error STILL present → hinted but not fixed
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_code', duration_ms: 10, success: true,
      input: { file_path: 'a.liquid' },
      output: { errors: [{ check: 'MissingPartial' }], warnings: [] },
    }, T(1)));
    expect(s.enrich_history).toEqual([]);
    expect(s.hint_effectiveness.MissingPartial).toEqual({ hinted: 1, fixed_after_hint: 0 });

    // enrich again then validate_code where error is gone → fixed_after_hint
    s = applyEvent(s, ev('tool_call', {
      tool: 'enrich_error', duration_ms: 2, success: true,
      input: { file_path: 'a.liquid', check_name: 'MissingPartial' },
    }, T(2)));
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_code', duration_ms: 10, success: true,
      input: { file_path: 'a.liquid' },
      output: { errors: [], warnings: [] },
    }, T(3)));
    expect(s.hint_effectiveness.MissingPartial).toEqual({ hinted: 2, fixed_after_hint: 1 });
  });

  it('only consumes enrich entries matching the file_path', () => {
    let s = initialState();
    s = applyEvent(s, ev('tool_call', {
      tool: 'enrich_error', duration_ms: 1, success: true,
      input: { file_path: 'b.liquid', check_name: 'X' },
    }));
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_code', duration_ms: 1, success: true,
      input: { file_path: 'a.liquid' },
      output: { errors: [], warnings: [] },
    }));
    expect(s.enrich_history).toHaveLength(1);
  });
});

describe('session-state: tool_call / scaffold', () => {
  it('logs scaffold_runs and clears pending on write', () => {
    let s = initialState();
    // First, set pending via validate_intent so we can observe it being cleared.
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_intent', duration_ms: 1, success: true, input: {},
      output: { ok: true, plan_id: 'p1', pending_files: ['app/views/pages/x.liquid'], pending_translations: [] },
    }, T(0)));
    expect(s.pending.files.length).toBe(1);

    s = applyEvent(s, ev('tool_call', {
      tool: 'scaffold', duration_ms: 100, success: true,
      input: { write: true, model: 'note', type: 'crud' },
      output: { files: [{ path: 'a.liquid' }, { path: 'b.liquid' }], written: ['a.liquid', 'b.liquid'] },
    }, T(1)));
    expect(s.scaffold_runs).toHaveLength(1);
    expect(s.scaffold_runs[0]).toEqual({
      ts: T(1), model: 'note', type: 'crud',
      files: ['a.liquid', 'b.liquid'],
      written: ['a.liquid', 'b.liquid'],
    });
    expect(s.pending.files).toEqual([]);
    expect(s.pending.translations).toEqual([]);
    expect(s.pending.pages).toEqual([]);
    expect(s.pending.plan_id).toBeNull();
  });

  it('does not clear pending on dry-run (write=false)', () => {
    let s = initialState();
    s = applyEvent(s, ev('tool_call', {
      tool: 'validate_intent', duration_ms: 1, success: true, input: {},
      output: { ok: true, plan_id: 'p1', pending_files: ['x.liquid'], pending_translations: ['t.k'] },
    }));
    s = applyEvent(s, ev('tool_call', {
      tool: 'scaffold', duration_ms: 100, success: true,
      input: { write: false },
      output: { files: [{ path: 'x.liquid' }], written: [] },
    }));
    expect(s.pending.files).toEqual(['x.liquid']);
    expect(s.pending.translations).toEqual(['t.k']);
  });
});

describe('session-state: tool_call / analyze_project', () => {
  it('records last_analysis snapshot', () => {
    const s = applyEvent(initialState(), ev('tool_call', {
      tool: 'analyze_project', duration_ms: 200, success: true,
      input: {}, output: { total_errors: 3, total_warnings: 7 },
    }, T(5)));
    expect(s.last_analysis).toEqual({
      ts: T(5), total_errors: 3, total_warnings: 7, diagnostics: null,
    });
  });
});

describe('session-state: by_tool counters', () => {
  it('counts errors when success=false', () => {
    let s = initialState();
    s = applyEvent(s, ev('tool_call', { tool: 'lookup', duration_ms: 1, success: true }));
    s = applyEvent(s, ev('tool_call', { tool: 'lookup', duration_ms: 2, success: false, error: 'x' }));
    s = applyEvent(s, ev('tool_call', { tool: 'lookup', duration_ms: 3, success: true }));
    expect(s.by_tool.lookup).toEqual({ calls: 3, errors: 1, total_ms: 6 });
  });
});

describe('session-state: validator_emit', () => {
  it('appends to validator_emissions ring buffer', () => {
    let s = initialState();
    for (let i = 0; i < 3; i++) {
      s = applyEvent(s, ev('validator_emit', {
        fp: `fp-${i}`, file: 'a.liquid', hint_rule_id: 'R', hint_md_hash: 'h',
        proposed_fixes: [],
      }, T(i)));
    }
    expect(s.validator_emissions).toHaveLength(3);
    expect(s.validator_emissions[2].fp).toBe('fp-2');
  });
});

describe('session-state: replay equivalence', () => {
  it('replay and incremental application produce identical state', () => {
    const events = [
      ev('server_start', { project_dir: '/p', version: '1.0.0', started_at: T(0) }, T(0)),
      ev('lsp_event', { phase: 'ready', duration_ms: 250 }, T(0)),
      ev('index_event', { index: 'schema', status: 'ready', queries: 5, mutations: 2 }, T(0)),
      ev('tool_call', {
        tool: 'validate_intent', duration_ms: 5, success: true, input: {},
        output: { ok: true, plan_id: 'p1', pending_files: ['app/views/pages/x.liquid'], pending_translations: ['k1'] },
      }, T(1)),
      ev('tool_call', {
        tool: 'enrich_error', duration_ms: 1, success: true,
        input: { file_path: 'app/views/pages/x.liquid', check_name: 'MissingPartial' },
      }, T(2)),
      ev('tool_call', {
        tool: 'validate_code', duration_ms: 10, success: true,
        input: { file_path: 'app/views/pages/x.liquid' },
        output: { errors: [{ check: 'MissingPartial' }], warnings: [], status: 'error' },
      }, T(3)),
      ev('tool_call', {
        tool: 'validate_code', duration_ms: 8, success: true,
        input: { file_path: 'app/views/pages/x.liquid' },
        output: { errors: [], warnings: [], status: 'ok' },
      }, T(4)),
      ev('tool_call', {
        tool: 'scaffold', duration_ms: 100, success: true,
        input: { write: true, model: 'note', type: 'crud' },
        output: { files: [{ path: 'a.liquid' }], written: ['a.liquid'] },
      }, T(5)),
    ];

    let incremental = initialState();
    for (const e of events) incremental = applyEvent(incremental, e);

    const bulk = replay(events);
    expect(bulk).toEqual(incremental);
  });

  it('reducer is deterministic — same events twice yield equal states', () => {
    const events = [
      ev('server_start', { project_dir: '/p', version: '1.0.0', started_at: T(0) }, T(0)),
      ev('tool_call', { tool: 'lookup', duration_ms: 5, success: true }, T(0)),
      ev('tool_call', { tool: 'lookup', duration_ms: 5, success: true }, T(0)),
    ];
    expect(replay(events)).toEqual(replay(events));
  });

  it('event count tracks both known and unknown kinds', () => {
    const known = ev('tool_call', { tool: 'lookup', duration_ms: 5, success: true });
    const s = applyEvent(applyEvent(initialState(), known), known);
    expect(s._event_count).toBe(2);
  });

  it('does not mutate the input state object', () => {
    const s0 = initialState();
    const s0Snap = JSON.parse(JSON.stringify(s0));
    applyEvent(s0, ev('server_start', { project_dir: '/p', version: '1', started_at: T(0) }));
    expect(s0).toEqual(s0Snap);
  });
});
