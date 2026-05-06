/**
 * Pure session-state reducer.
 *
 * `applyEvent(state, event)` is the single source of truth for how a
 * SessionEvent updates the live projection. It must be PURE:
 *   - no `Date.now()`, `Math.random()`, fs/network reads
 *   - all inputs come from `state` and `event` (the timestamp lives in `event.ts`)
 *
 * Why pure: the same reducer runs live (incremental, in-memory) and during
 * replay (offline, full log → state). The "write-through with periodic
 * invariant check" runtime model in roadmap §3.3 only works if both paths
 * produce byte-identical results.
 *
 * State shape mirrors the legacy `session.*` object plus the previously
 * separate `sessionStats` so a single replay reproduces every value the
 * dashboard exposes today.
 */

export function initialState() {
  return {
    server: {
      started_at: null,
      version: null,
      project_dir: null,
      http_port: null,
      stopped: false,
      stop_reason: null,
    },
    pos_cli: {
      found: false,
      path: null,
      data_dir: null,
      error: null,
    },
    lsp: {
      ready: false,
      last_error: null,
      restart_count: 0,
      last_ready_ms: null,
      last_warmup_ms: null,
      last_warmup_index_ready: null,
      last_crash: null, // { code, signal, ts }
    },
    indexes: {
      schema:  { status: 'pending' },
      objects: { status: 'pending' },
      filters: { status: 'pending' },
      tags:    { status: 'pending' },
    },

    // Tool-call rollups (replaces sessionStats from server.js)
    by_tool: {},          // tool → { calls, errors, total_ms }
    check_frequency: {},  // check → count

    // Per-file validation history (replaces session.fileHistory Map)
    file_history: {},     // path → { calls, last_error_count, last_warning_count, consecutive_non_decreasing, last_checks, prev_checks }

    // Plan tracking (replaces session.validatedPlan)
    validated_plan: null, // { plan_id, source, pending_files: string[], validated_files: string[] }

    // Cross-tool suppression hints (replaces session.pending)
    pending: {
      files: [],
      translations: [],
      pages: [],
      plan_id: null,
      validated_at: null,
      write_directly: false,
    },

    // Per-check effectiveness (consecutive call transitions)
    check_effectiveness: {},  // check → { fixed, stuck }

    // Scaffold runs
    scaffold_runs: [],         // [{ ts, model, type, files, written }]

    // Pending enrich_error → validate_code correlation
    enrich_history: [],        // [{ file, check, ts }]
    hint_effectiveness: {},    // check → { hinted, fixed_after_hint }

    // Pipeline traces — last trace per file
    pipeline_traces: {},       // path → trace

    // Last analyze_project snapshot
    last_analysis: null,       // { ts, total_errors, total_warnings, diagnostics }

    // validator_emit log (Phase A5 will populate)
    validator_emissions: [],   // [{ fp, file, hint_rule_id, ts }]

    // For determinism: monotonic event counter (debugging convenience)
    _event_count: 0,
  };
}

/**
 * Apply a single event. Returns a NEW state object — original is untouched.
 * Unknown kinds are no-ops (forward-compatible: an old reader can replay
 * a log that contains kinds it doesn't understand without crashing).
 */
export function applyEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  const handler = HANDLERS[event.kind];
  const next = handler ? handler(state, event) : state;
  // Always bump the event counter — even unknown kinds count, so the
  // replay-vs-cache invariant catches a kind we silently ignored.
  return next === state ? { ...state, _event_count: state._event_count + 1 } : { ...next, _event_count: state._event_count + 1 };
}

/**
 * Replay a sequence of events from the given seed (defaults to `initialState`).
 */
export function replay(events, seed = initialState()) {
  let s = seed;
  for (const e of events) s = applyEvent(s, e);
  return s;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const HANDLERS = {
  server_start(state, e) {
    return {
      ...state,
      server: {
        ...state.server,
        started_at: e.started_at,
        version: e.version,
        project_dir: e.project_dir,
        http_port: e.http_port ?? null,
        stopped: false,
        stop_reason: null,
      },
    };
  },

  server_stop(state, e) {
    return { ...state, server: { ...state.server, stopped: true, stop_reason: e.reason } };
  },

  pos_cli_resolved(state, e) {
    return {
      ...state,
      pos_cli: {
        found: e.found === true,
        path: e.path ?? null,
        data_dir: e.data_dir ?? null,
        error: e.error ?? null,
      },
    };
  },

  lsp_event(state, e) {
    const lsp = { ...state.lsp };
    switch (e.phase) {
      case 'ready':
        lsp.ready = true;
        lsp.last_ready_ms = e.duration_ms ?? null;
        lsp.last_error = null;
        break;
      case 'warmed_up':
        lsp.last_warmup_ms = e.duration_ms ?? null;
        lsp.last_warmup_index_ready = e.index_ready ?? null;
        break;
      case 'crash':
        lsp.ready = false;
        lsp.restart_count = e.restart_count ?? lsp.restart_count;
        lsp.last_crash = { code: e.code ?? null, signal: e.signal ?? null, ts: e.ts };
        break;
      case 'restart_requested':
        lsp.ready = false;
        break;
      case 'restart_failed':
      case 'init_failed':
        lsp.ready = false;
        lsp.last_error = e.error ?? null;
        break;
    }
    return { ...state, lsp };
  },

  index_event(state, e) {
    if (e.index === 'all' && e.status === 'failed') {
      const indexes = {};
      for (const k of Object.keys(state.indexes)) {
        indexes[k] = { status: 'failed', error: e.error ?? null };
      }
      return { ...state, indexes };
    }
    if (!state.indexes[e.index]) return state;
    const entry = { status: e.status };
    if (e.status === 'ready') {
      if (e.count != null)     entry.count = e.count;
      if (e.queries != null)   entry.queries = e.queries;
      if (e.mutations != null) entry.mutations = e.mutations;
    } else {
      entry.error = e.error ?? null;
    }
    return { ...state, indexes: { ...state.indexes, [e.index]: entry } };
  },

  fs_change(state /* , e */) {
    // fs events do not currently affect the projection — they exist in the
    // log so analytics can correlate file edits with subsequent tool calls.
    return state;
  },

  log(state /* , e */) {
    // Log events do not affect projection; they're kept for audit only.
    return state;
  },

  tool_call(state, e) {
    return reduceToolCall(state, e);
  },

  validator_emit(state, e) {
    // Append-only log of last N emissions. Analytics in Phase B reads from
    // events.ndjson directly; this in-memory ring is for the live dashboard.
    const cap = 500;
    const next = state.validator_emissions.concat([{
      fp: e.fp,
      template_fp: e.template_fp ?? null,
      file: e.file,
      hint_rule_id: e.hint_rule_id ?? null,
      hint_md_hash: e.hint_md_hash ?? null,
      proposed_fixes: e.proposed_fixes ?? [],
      ts: e.ts,
    }]);
    return {
      ...state,
      validator_emissions: next.length > cap ? next.slice(next.length - cap) : next,
    };
  },
};

// ── tool_call subreducer ─────────────────────────────────────────────────────
//
// Mirrors `updateSession()` in src/tools.js plus the side-mutations currently
// embedded in validate-intent.js, scaffold.js, and analyze-project.js. After
// Phase A1 wiring those handlers stop mutating session.* directly — every
// tool result projects through this reducer.

function reduceToolCall(state, event) {
  const { tool, success, duration_ms, input = {}, output, error, ts } = event;

  // 1. by_tool counters + check_frequency (replaces server.js trackStats).
  const byTool = updateByTool(state.by_tool, tool, duration_ms, success);
  const checkFrequency = (tool === 'validate_code' && output)
    ? updateCheckFrequency(state.check_frequency, output)
    : state.check_frequency;

  // 2. Per-tool projections (replaces tools.js updateSession + per-tool side-mutations).
  let next = { ...state, by_tool: byTool, check_frequency: checkFrequency };
  if (!success) return next; // failed calls never advance per-tool state

  switch (tool) {
    case 'validate_intent':
      next = applyValidateIntent(next, input, output, ts);
      break;
    case 'validate_code':
      next = applyValidateCode(next, input, output);
      break;
    case 'scaffold':
      next = applyScaffold(next, input, output, ts);
      break;
    case 'enrich_error':
      next = applyEnrichError(next, input, ts);
      break;
    case 'analyze_project':
      next = applyAnalyzeProject(next, output, ts);
      break;
  }
  return next;
}

function updateByTool(byTool, tool, durationMs, success) {
  const prev = byTool[tool] || { calls: 0, errors: 0, total_ms: 0 };
  return {
    ...byTool,
    [tool]: {
      calls: prev.calls + 1,
      errors: prev.errors + (success === false ? 1 : 0),
      total_ms: prev.total_ms + (durationMs ?? 0),
    },
  };
}

function updateCheckFrequency(freq, output) {
  const next = { ...freq };
  for (const d of [...(output.errors ?? []), ...(output.warnings ?? [])]) {
    if (!d || !d.check) continue;
    next[d.check] = (next[d.check] ?? 0) + 1;
  }
  return next;
}

// ── validate_intent: writes pending + plan ───────────────────────────────────

const PAGE_PATH_RE = /^app\/views\/pages\/.+\.(html\.liquid|liquid)$/;

function extractPendingPages(pendingFiles) {
  const out = [];
  for (const f of pendingFiles) {
    if (PAGE_PATH_RE.test(f)) out.push(f);
  }
  return out;
}

function applyValidateIntent(state, input, output, ts) {
  if (!output || output.ok !== true) return state;

  const pendingFiles = output.pending_files ?? [];
  const pendingTranslations = output.pending_translations ?? [];

  const pending = {
    files: dedup(pendingFiles),
    translations: dedup(pendingTranslations),
    pages: dedup(extractPendingPages(pendingFiles)),
    plan_id: output.plan_id ?? null,
    validated_at: output.validated_at ?? ts,
    write_directly: output.write_directly === true,
  };

  // Scaffold-generated files are valid by construction — pre-mark them as
  // validated so the supervision-note pathway treats them as done.
  const preValidated = input?.scaffold_output ? dedup(pendingFiles) : [];
  const validatedPlan = {
    plan_id: output.plan_id ?? null,
    source: input?.scaffold_output ? 'scaffold' : 'manual',
    pending_files: dedup(pendingFiles),
    validated_files: preValidated,
  };

  return { ...state, pending, validated_plan: validatedPlan };
}

// ── validate_code: file history + plan progress + hint effectiveness ─────────

function applyValidateCode(state, input, output) {
  const filePath = input?.file_path;
  if (!filePath) return state;

  const errorCount = (output?.errors?.length ?? 0);
  const warningCount = (output?.warnings?.length ?? 0);
  const currentChecks = collectChecks(output);

  const prev = state.file_history[filePath];
  let fileHistory;
  let checkEffectiveness = state.check_effectiveness;

  if (prev) {
    if (prev.last_checks?.length) {
      checkEffectiveness = updateCheckEffectiveness(
        state.check_effectiveness,
        prev.last_checks,
        currentChecks,
      );
    }
    fileHistory = {
      ...state.file_history,
      [filePath]: {
        calls: prev.calls + 1,
        consecutive_non_decreasing: (errorCount >= prev.last_error_count && prev.last_error_count > 0)
          ? prev.consecutive_non_decreasing + 1
          : 0,
        last_error_count: errorCount,
        last_warning_count: warningCount,
        last_checks: currentChecks,
        prev_checks: prev.last_checks ?? [],
      },
    };
  } else {
    fileHistory = {
      ...state.file_history,
      [filePath]: {
        calls: 1,
        consecutive_non_decreasing: 0,
        last_error_count: errorCount,
        last_warning_count: warningCount,
        last_checks: currentChecks,
        prev_checks: [],
      },
    };
  }

  // Mark file as validated in current plan if present and not in error.
  let validatedPlan = state.validated_plan;
  if (validatedPlan && output?.status !== 'error') {
    if (!validatedPlan.validated_files.includes(filePath)) {
      validatedPlan = {
        ...validatedPlan,
        validated_files: [...validatedPlan.validated_files, filePath],
      };
    }
  }

  // Hint effectiveness: consume any pending enrich_history rows for this file.
  const { enrichHistory, hintEffectiveness } = consumeEnrichHistory(
    state.enrich_history,
    state.hint_effectiveness,
    filePath,
    new Set(currentChecks),
  );

  // Pipeline trace
  const pipelineTraces = output?._pipelineTrace
    ? { ...state.pipeline_traces, [filePath]: output._pipelineTrace }
    : state.pipeline_traces;

  return {
    ...state,
    file_history: fileHistory,
    check_effectiveness: checkEffectiveness,
    validated_plan: validatedPlan,
    enrich_history: enrichHistory,
    hint_effectiveness: hintEffectiveness,
    pipeline_traces: pipelineTraces,
  };
}

function collectChecks(output) {
  const out = [];
  for (const d of [...(output?.errors ?? []), ...(output?.warnings ?? [])]) {
    if (d && d.check) out.push(d.check);
  }
  return out;
}

function updateCheckEffectiveness(prevMap, prevChecks, currentChecks) {
  const curSet = new Set(currentChecks);
  const next = { ...prevMap };
  for (const check of new Set(prevChecks)) {
    const entry = next[check] || { fixed: 0, stuck: 0 };
    next[check] = curSet.has(check)
      ? { fixed: entry.fixed, stuck: entry.stuck + 1 }
      : { fixed: entry.fixed + 1, stuck: entry.stuck };
  }
  return next;
}

function consumeEnrichHistory(enrichHistory, hintEffectiveness, filePath, currentCheckSet) {
  if (!enrichHistory.length) return { enrichHistory, hintEffectiveness };
  const remaining = [];
  let next = hintEffectiveness;
  let mutated = false;
  for (const eh of enrichHistory) {
    if (eh.file !== filePath) {
      remaining.push(eh);
      continue;
    }
    mutated = true;
    const prev = next[eh.check] || { hinted: 0, fixed_after_hint: 0 };
    next = {
      ...next,
      [eh.check]: {
        hinted: prev.hinted + 1,
        fixed_after_hint: prev.fixed_after_hint + (currentCheckSet.has(eh.check) ? 0 : 1),
      },
    };
  }
  return mutated
    ? { enrichHistory: remaining, hintEffectiveness: next }
    : { enrichHistory, hintEffectiveness };
}

// ── scaffold: log run + clear pending on write ───────────────────────────────

function applyScaffold(state, input, output, ts) {
  if (!output?.files) return state;

  const written = output.written ?? [];
  const scaffoldRuns = [
    ...state.scaffold_runs,
    {
      ts,
      model: input?.model ?? null,
      type: input?.type ?? null,
      files: output.files.map(f => f?.path || f).filter(Boolean),
      written,
    },
  ];

  let pending = state.pending;
  if (input?.write && written.length > 0) {
    pending = {
      ...pending,
      files: [],
      translations: [],
      pages: [],
      plan_id: null,
      validated_at: null,
      // write_directly is intentionally preserved: clearing it here would
      // erase the trust-track flag earlier than scaffold's contract allows.
    };
  }

  return { ...state, scaffold_runs: scaffoldRuns, pending };
}

// ── enrich_error: queue for hint-effectiveness correlation ───────────────────

function applyEnrichError(state, input, ts) {
  const file = input?.file_path;
  const check = input?.check_name;
  if (!file || !check) return state;
  return {
    ...state,
    enrich_history: [...state.enrich_history, { file, check, ts }],
  };
}

// ── analyze_project: snapshot for diff_from_last_run ─────────────────────────

function applyAnalyzeProject(state, output, ts) {
  if (!output) return state;
  return {
    ...state,
    last_analysis: {
      ts,
      total_errors: output.total_errors ?? 0,
      total_warnings: output.total_warnings ?? 0,
      diagnostics: output._snapshot ?? null,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dedup(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
