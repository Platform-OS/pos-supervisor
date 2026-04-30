import { realpath } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PlatformOSLSPClient } from './core/lsp-client.js';
import { SchemaIndex } from './core/schema-index.js';
import { ObjectsIndex } from './core/objects-index.js';
import { FiltersIndex } from './core/filters-index.js';
import { TagsIndex } from './core/tags-index.js';
import { toUri } from './core/utils.js';
import { startFsWatcher } from './core/fs-watcher.js';
import { invalidateProjectMap } from './tools/project-map.js';
import { createToolRegistry } from './tools.js';
import { initPromotedRules, reloadRules } from './core/rules/index.js';
import { updateDisabledRules, updateForceOverrides, setDisabledRuleDetails } from './core/rules/engine.js';
import { ruleScores, resolveProbation } from './core/case-base.js';
import { loadOverrides, overrideSets } from './core/rule-overrides.js';
import { loadCacConfig } from './core/cac-config.js';
import { rehydrateRecentCacDecisions } from './core/cac-predictor.js';
import { loadEngineMode, isAdaptive, setEngineMode, getEngineMode } from './core/engine-mode.js';
import { startHttp } from './http-server.js';
import { createLogger } from './core/logger.js';
import { LSP_READY_TIMEOUT_MS } from './core/constants.js';
import { startSessionEventBus } from './core/session-event-bus.js';
import { openBlobStore } from './core/blob-store.js';
import { openAnalyticsStore } from './core/analytics-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version;

/**
 * Create and start the pos-supervisor server.
 *
 * @param {object} opts
 * @param {string} opts.projectDir - Project root directory
 * @param {number} [opts.httpPort] - HTTP port (0 = disabled)
 */
export async function createServer({ projectDir, httpPort = 0 }) {
  const { emit: rawEmit, log, close: closeLogger, logPath } = createLogger({ directory: projectDir, version: VERSION });

  // ── Session id + event bus (Phase A1) ─────────────────────────────────────
  //
  // The bus owns the append-only NDJSON log + the in-memory projection. It
  // runs in PARALLEL with the legacy session.* state during Phase 2 so the
  // existing dashboard/tests keep working unchanged. Phase 3's acceptance
  // gate compares projection-from-disk to the live projection; once we
  // trust that match the legacy mutation paths come out (separate change).
  //
  // Bus creation is best-effort: if the writer can't open (read-only fs,
  // permission denied), the bus runs in-memory only and the live request
  // path is never affected.
  const sessionsDir = join(projectDir, '.pos-supervisor', 'sessions');
  const sessionId = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const sessionBus = startSessionEventBus({ sessionId, sessionsDir, log });
  if (sessionBus.writerError) {
    log(`session-event-bus: running in-memory only (${sessionBus.writerError})`);
  } else {
    log(`session-event-bus: writing events to ${sessionBus.eventsPath}`);
  }
  sessionBus.startInvariantInterval();

  // ── Content blob store (Phase A4/A5) ──────────────────────────────────────
  let blobStore = null;
  try {
    blobStore = openBlobStore(join(projectDir, '.pos-supervisor', 'blobs'));
  } catch (e) {
    log(`blob-store: failed to open (${e.message}); content hashes will not be stored`);
  }

  // ── Analytics store (Phase B — derived from NDJSON, disposable) ────────────
  let analyticsStore = null;
  try {
    analyticsStore = openAnalyticsStore(
      join(projectDir, '.pos-supervisor', 'analytics.db'),
      { blobStore },
    );
    log('analytics-store: opened');
  } catch (e) {
    log(`analytics-store: failed to open (${e.message}); analytics will not be available`);
  }

  // ── Engine mode (adaptive vs static) ──────────────────────────────────────
  const engineMode = loadEngineMode(projectDir);
  log(`engine-mode: ${engineMode}`);

  // ── Promoted rules (Phase J — declarative rules from analytics) ──────────────
  try {
    initPromotedRules(projectDir);
    log(`promoted-rules: ${isAdaptive() ? 'loaded' : 'skipped (static mode)'}`);
  } catch (e) {
    log(`promoted-rules: failed to load (${e.message})`);
  }

  let promotedRulesWatcher = null;
  const promotedRulesPath = join(projectDir, '.pos-supervisor', 'promoted-rules.json');
  const supervisorDir = join(projectDir, '.pos-supervisor');
  if (existsSync(supervisorDir)) {
    try {
      let debounceTimer = null;
      promotedRulesWatcher = watch(supervisorDir, { recursive: false }, (eventType, filename) => {
        if (filename !== 'promoted-rules.json') return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          try {
            reloadRules(projectDir);
            log('promoted-rules: reloaded after file change');
          } catch (e) {
            log(`promoted-rules: reload failed (${e.message})`);
          }
        }, 200);
        if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
      });
      if (typeof promotedRulesWatcher.unref === 'function') promotedRulesWatcher.unref();
    } catch (e) {
      log(`promoted-rules watcher: failed to start (${e.message})`);
    }
  }

  // ── Disabled rule enforcement (Phase J4 + I4 operator overrides) ─────────────
  // force-enable wins over case-base disable; force-disable applies always.
  // Engine picks up the split via ruleIsActive; sync loads file → engine so
  // edits made through the dashboard take effect without restart.
  function syncRuleOverrides() {
    try {
      const state = loadOverrides(projectDir, { log });
      const { force_enable, force_disable } = overrideSets(state);
      updateForceOverrides({ force_enable, force_disable });
      if (force_enable.size || force_disable.size) {
        log(`rule-overrides: ${force_enable.size} force-enabled, ${force_disable.size} force-disabled`);
      }
      return state;
    } catch (e) {
      log(`rule-overrides: sync failed (${e.message})`);
      return { force_enable: {}, force_disable: {} };
    }
  }

  function syncDisabledRules() {
    if (!isAdaptive()) {
      updateDisabledRules(null);
      setDisabledRuleDetails([]);
      return;
    }
    if (!analyticsStore) return;
    try {
      const scores = ruleScores(analyticsStore, { minEmitted: 5 });
      const disabled = scores.filter(s => s.disabled).map(s => s.rule_id);
      updateDisabledRules(disabled);
      setDisabledRuleDetails(scores.filter(s => s.disabled));
      if (disabled.length > 0) log(`disabled-rules: ${disabled.length} rule(s) disabled by analytics`);
    } catch (e) {
      log(`disabled-rules: sync failed (${e.message})`);
    }
  }

  // Order matters: overrides first so the disabled-rules sync below sees
  // them in effect. Both are idempotent — safe to call repeatedly.
  syncRuleOverrides();
  syncDisabledRules();

  // ── CAC predictor config (opt-in 4th gating axis) ──────────────────────────
  // Shared mutable ref: validate-code reads `current` on each call, the HTTP
  // POST handler mutates it after persisting to disk. Disabled by default —
  // when `enabled: false`, validate-code skips the predictor entirely.
  const cacConfigState = { current: loadCacConfig(projectDir, { log }) };
  function syncCacConfig() {
    try {
      cacConfigState.current = loadCacConfig(projectDir, { log });
      const c = cacConfigState.current;
      if (c.enabled) {
        log(`cac-predictor: ${c.mode} mode, threshold=${c.threshold}, action=${c.action}, min_samples=${c.min_samples}`);
      }
    } catch (e) {
      log(`cac-predictor: sync failed (${e.message})`);
    }
  }
  syncCacConfig();

  // Rehydrate the CAC decision ring from prior sessions' NDJSON logs so the
  // dashboard's "Recent CAC Decisions" panel survives server restarts. Pure
  // disk read — runs even when the predictor is disabled, since flipping it
  // on later in the session shouldn't show an empty audit trail. Best
  // effort: any I/O error returns 0 and is logged at info level.
  try {
    const n = rehydrateRecentCacDecisions(sessionsDir);
    if (n > 0) log(`cac-predictor: rehydrated ${n} decision(s) from prior sessions`);
  } catch (e) {
    log(`cac-predictor: rehydration failed (${e.message})`);
  }

  // ── Engine mode transitions ──────────────────────────────────────────────────
  function handleModeTransition(prev, mode) {
    log(`engine-mode: ${prev} → ${mode}`);
    reloadRules(projectDir);
    if (mode === 'adaptive') {
      syncDisabledRules();
      if (analyticsStore) {
        try { resolveProbation(analyticsStore); } catch {}
      }
    } else {
      updateDisabledRules(null);
    }
    broadcastSse({ event: 'engine_mode_changed', ts: new Date().toISOString(), prev, mode });
  }

  function switchEngineMode(mode) {
    setEngineMode(mode, { projectDir, onTransition: handleModeTransition });
    return getEngineMode();
  }

  // ── In-memory session stats (not written to JSONL to keep log entries small) ──
  const sessionStats = {
    byTool: {},        // tool → { calls, errors, totalMs }
    checkFrequency: {}, // LSP check name → count (from validate_code results)
  };

  function trackStats(tool, durationMs, success, output) {
    if (!sessionStats.byTool[tool]) sessionStats.byTool[tool] = { calls: 0, errors: 0, totalMs: 0 };
    sessionStats.byTool[tool].calls++;
    if (success === false) sessionStats.byTool[tool].errors++;
    sessionStats.byTool[tool].totalMs += durationMs ?? 0;
    // Extract check frequencies from validate_code diagnostics
    if (tool === 'validate_code' && output) {
      for (const d of [...(output.errors ?? []), ...(output.warnings ?? [])]) {
        if (d.check) sessionStats.checkFrequency[d.check] = (sessionStats.checkFrequency[d.check] ?? 0) + 1;
      }
    }
  }

  // ── SSE broadcast registry ────────────────────────────────────────────────
  const sseClients = new Set();
  function subscribeToEvents(cb) {
    sseClients.add(cb);
    return () => sseClients.delete(cb);
  }
  function broadcastSse(entry) {
    if (sseClients.size === 0) return;
    for (const cb of sseClients) {
      try { cb(entry); } catch {}
    }
  }

  // Extract lightweight per-tool metadata from input/output for log entries.
  // Never logs content — only identifiers and counts.
  function extractLogMeta(tool, input, output) {
    const m = {};
    switch (tool) {
      case 'validate_code':
        if (input?.file_path) m.file_path = input.file_path;
        if (Array.isArray(output?.errors))   m.error_count   = output.errors.length;
        if (Array.isArray(output?.warnings)) m.warning_count = output.warnings.length;
        { const checks = [];
          for (const d of [...(output?.errors ?? []), ...(output?.warnings ?? [])]) {
            if (d.check && !checks.includes(d.check)) checks.push(d.check);
          }
          if (checks.length) m.checks = checks;
        }
        break;
      case 'validate_intent':
        if (Array.isArray(output?.pending_files)) m.file_count = output.pending_files.length;
        if (typeof output?.ok === 'boolean')      m.ok = output.ok;
        break;
      case 'analyze_project':
        if (typeof output?.total_errors   === 'number') m.error_count   = output.total_errors;
        if (typeof output?.total_warnings === 'number') m.warning_count = output.total_warnings;
        if (Array.isArray(output?.files))               m.file_count    = output.files.length;
        break;
      case 'scaffold':
        if (Array.isArray(output?.files)) m.file_count = output.files.length;
        if (input?.model)                 m.model      = input.model;
        break;
    }
    return m;
  }

  // Mirror a legacy emit() call into the typed session-event bus. Returns
  // void; never throws. Unmapped legacy events are silently dropped (the
  // bus only persists kinds it knows how to project — extra log/diagnostic
  // events still go to the JSONL logger via rawEmit).
  function mirrorToBus(event, data, ts) {
    if (sessionBus.isClosed) return;
    switch (event) {
      case 'server_start':
        sessionBus.emit('server_start', {
          project_dir: data.projectDir ?? projectDir,
          version: VERSION,
          http_port: data.httpPort ?? null,
          started_at: ts,
        }, ts);
        return;
      case 'server_stop':
        sessionBus.emit('server_stop', { reason: data.reason ?? 'unknown' }, ts);
        return;
      case 'pos_cli_found':
        sessionBus.emit('pos_cli_resolved', {
          found: true,
          path: data.path ?? null,
          data_dir: data.dataDir ?? null,
        }, ts);
        return;
      case 'pos_cli_error':
        sessionBus.emit('pos_cli_resolved', { found: false, error: data.error ?? null }, ts);
        return;
      case 'lsp_ready':
        sessionBus.emit('lsp_event', { phase: 'ready', duration_ms: data.durationMs }, ts);
        return;
      case 'lsp_warmed_up':
        sessionBus.emit('lsp_event', {
          phase: 'warmed_up', duration_ms: data.durationMs, index_ready: data.indexReady,
        }, ts);
        return;
      case 'lsp_crash':
        sessionBus.emit('lsp_event', {
          phase: 'crash',
          code: data.code ?? null,
          signal: data.signal ?? null,
          restart_count: data.restartCount ?? 0,
        }, ts);
        return;
      case 'lsp_init_failed':
        sessionBus.emit('lsp_event', { phase: 'init_failed', error: data.error ?? '' }, ts);
        return;
      case 'lsp_restart_requested':
        sessionBus.emit('lsp_event', { phase: 'restart_requested' }, ts);
        return;
      case 'lsp_restart_failed':
        sessionBus.emit('lsp_event', { phase: 'restart_failed', error: data.error ?? '' }, ts);
        return;
      case 'index_ready': {
        const payload = { index: data.index, status: 'ready' };
        if (data.count != null)     payload.count = data.count;
        if (data.queries != null)   payload.queries = data.queries;
        if (data.mutations != null) payload.mutations = data.mutations;
        sessionBus.emit('index_event', payload, ts);
        return;
      }
      case 'index_failed':
        sessionBus.emit('index_event', { index: data.index, status: 'failed', error: data.error ?? '' }, ts);
        return;
      case 'tool_call':
        sessionBus.emit('tool_call', {
          tool: data.tool,
          duration_ms: data.durationMs ?? 0,
          success: data.success !== false,
          input: data.input,
          output: data.output,
          ...(data.error ? { error: data.error } : {}),
        }, ts);
        return;
      // fs_change is emitted directly by the watcher via the bus — no mirror.
      // Other legacy events (lsp_request, fs_watcher_start_failed, etc.) are
      // diagnostic-only and not part of the projection.
    }
  }

  // Wrap emit: track in-memory stats, add lightweight metadata, strip large payloads.
  // lsp_request events are very frequent and not useful in the log file.
  function emit(event, data = {}) {
    if (event === 'lsp_request') return; // too noisy
    const ts = new Date().toISOString();
    // Mirror to the typed bus FIRST (before any payload stripping below).
    // Wrapped in try/catch so a bus issue can never break the live request path.
    try { mirrorToBus(event, data, ts); } catch (e) { log(`session-event-bus mirror error: ${e.message}`); }

    if (event === 'tool_call') {
      trackStats(data.tool, data.durationMs, data.success, data.output);
      const meta = extractLogMeta(data.tool, data.input, data.output);
      const entry = {
        tool: data.tool,
        durationMs: data.durationMs,
        success: data.success,
        ...(data.error ? { error: data.error } : {}),
        ...meta,
      };
      rawEmit(event, entry);
      broadcastSse({ event, ts, ...entry });
      return;
    }
    rawEmit(event, data);
    broadcastSse({ event, ts, ...data });
  }

  const serverStartMs = Date.now();
  // emit() mirrors to the session bus; rawEmit would skip the bus and we'd
  // miss server_start in the NDJSON log (and replay would never see it).
  emit('server_start', { projectDir, httpPort });
  log(`Starting pos-supervisor v${VERSION} for ${projectDir}`);

  // ── Resolve pos-cli paths ─────────────────────────────────────────────────
  let lspCmd = 'pos-cli';
  let lspArgs = ['lsp'];
  let checkCmd = 'pos-cli';
  let checkArgs = ['check', 'run', '-f', 'json'];
  let dataDir = null;
  let posCliFound = false;
  let posCliPath = null;

  try {
    const { execFile } = await import('node:child_process');
    const posCliBin = await new Promise((resolve) => {
      execFile('which', ['pos-cli'], (err, stdout) => {
        resolve(err ? '' : stdout.trim());
      });
    });
    const nodeBin = await new Promise((resolve) => {
      execFile('which', ['node'], (err, stdout) => {
        resolve(err ? '' : stdout.trim());
      });
    });

    if (posCliBin && nodeBin) {
      const realPosCliPath = await realpath(posCliBin);
      lspCmd = nodeBin;
      lspArgs = [realPosCliPath, 'lsp'];
      checkCmd = nodeBin;
      checkArgs = [realPosCliPath, 'check', 'run', '-f', 'json'];
      dataDir = join(
        dirname(dirname(realPosCliPath)),
        'node_modules', '@platformos', 'platformos-check-docs-updater', 'data'
      );
      posCliFound = true;
      posCliPath = realPosCliPath;

      emit('pos_cli_found', { path: realPosCliPath, dataDir });
      log(`pos-cli found at ${realPosCliPath}`);
    }
  } catch (e) {
    emit('pos_cli_error', { error: e.message });
    log(`pos-cli resolution failed: ${e.message}`);
  }

  // ── Start LSP client ──────────────────────────────────────────────────────
  const lsp = new PlatformOSLSPClient().start(lspCmd, lspArgs, {
    onRequest: ({ method, durationMs, success }) => {
      emit('lsp_request', { method, durationMs, success });
      if (!success) log(`LSP ${method} failed (${durationMs}ms)`);
    },
    onCrash: ({ code, signal, restartCount }) => {
      emit('lsp_crash', { code, signal, restartCount });
      log(`LSP crashed (code=${code}, signal=${signal}, restart #${restartCount})`);
    },
  });

  const rootUri = toUri(projectDir);
  const lspStart = Date.now();

  // Separate Promise to track warm-up completion (distinct from LSP initialization)
  let lspWarmupComplete = false;

  async function runLspWarmup(startMs) {
    const warmupUris = [
      toUri(join(projectDir, 'app', 'views', 'pages', '_warmup_page.html.liquid')),
      toUri(join(projectDir, 'app', 'views', 'partials', '_warmup_partial.liquid')),
      toUri(join(projectDir, 'app', 'lib', 'commands', '_warmup', '_warmup.liquid')),
    ];
    const warmupContent = '<!-- LSP cross-reference warmup -->\n{% render "products/nonexistent" %}';
    log('LSP warming up cross-reference index...');
    let indexReady = 0;
    for (const uri of warmupUris) {
      try {
        await lsp.awaitDiagnostics(uri, warmupContent, 15000);
        indexReady++;
      } catch (e) {
        log(`Partial warmup failed for ${uri}: ${e.message}`);
      }
    }
    emit('lsp_warmed_up', { durationMs: Date.now() - startMs, indexReady });
    log(`LSP warmed up (${indexReady}/${warmupUris.length} index areas indexed)`);
  }

  // File system watcher handle — created after LSP warmup completes so the watcher
  // only starts syncing once the LSP is ready to receive didOpen/didChange.
  let fsWatcher = null;

  const lspWarmupReady = new Promise((resolve) => {
    lsp.initialize(rootUri, { version: VERSION })
      .then(async () => {
        try {
          await runLspWarmup(lspStart);
        } catch (e) {
          log(`LSP warm-up failed (non-fatal): ${e.message}`);
        }
        lspWarmupComplete = true;
        emit('lsp_ready', { durationMs: Date.now() - lspStart });
        log('LSP ready');

        // Start the filesystem watcher now that the LSP can accept updates.
        // Watcher keeps the LSP's cross-reference index fresh for files written
        // after warmup (scaffold, agent Write tool, external edits). See
        // src/core/fs-watcher.js for the full rationale.
        try {
          fsWatcher = startFsWatcher({
            projectDir,
            lsp,
            log,
            emit,
            // Any change to a dependency-graph-relevant file must invalidate
            // the cached project map so cross-file tools (analyze_project,
            // validate_code's caller lookup) re-scan on the next call.
            onFileChange: () => invalidateProjectMap(),
          });
        } catch (e) {
          log(`fs-watcher start failed (non-fatal): ${e.message}`);
          emit('fs_watcher_start_failed', { error: e.message });
        }

        resolve();
      })
      .catch((e) => {
        emit('lsp_init_failed', { error: e.message });
        log(`LSP init failed: ${e.message}`);
        lspWarmupComplete = true;
        resolve();
      });
  });

  const lspReady = lspWarmupReady;

  async function restartLsp() {
    lspWarmupComplete = false;
    const restartStart = Date.now();
    emit('lsp_restart_requested', {});
    log('LSP restart requested via dashboard');
    try {
      // lsp.restart() already calls initialize() internally
      await lsp.restart();
      try {
        await runLspWarmup(restartStart);
      } catch (e) {
        log(`LSP warm-up failed after restart (non-fatal): ${e.message}`);
      }
      lspWarmupComplete = true;
      emit('lsp_ready', { durationMs: Date.now() - restartStart });
      log('LSP restarted successfully');
    } catch (e) {
      lspWarmupComplete = true;
      emit('lsp_restart_failed', { error: e.message });
      log(`LSP restart failed: ${e.message}`);
      throw e;
    }
  }

  /**
   * Wait for LSP to be ready, with a timeout.
   * This waits for both LSP initialization AND warm-up completion.
   * Returns true if LSP is ready, false if timed out or failed.
   */
  async function awaitLsp() {
    // Check warm-up completion, not just LSP initialization
    // lspWarmupComplete is set true only after warm-up finishes
    if (lspWarmupComplete) return true;
    try {
      await Promise.race([
        lspReady,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LSP ready timeout')), LSP_READY_TIMEOUT_MS)
        ),
      ]);
      return lsp.initialized;
    } catch {
      return false;
    }
  }

  // ── Load indexes ──────────────────────────────────────────────────────────
  const schemaIndex  = new SchemaIndex();
  const objectsIndex = new ObjectsIndex();
  const filtersIndex = new FiltersIndex();
  const tagsIndex    = new TagsIndex();

  if (dataDir) {
    schemaIndex.load(join(dataDir, 'graphql.graphql'))
      .then(() => {
        emit('index_ready', { index: 'schema', queries: schemaIndex._queries.length, mutations: schemaIndex._mutations.length });
        log(`Schema index loaded (${schemaIndex._queries.length} queries, ${schemaIndex._mutations.length} mutations)`);
      })
      .catch((e) => {
        emit('index_failed', { index: 'schema', error: e.message });
        log(`Schema index failed: ${e.message}`);
      });
    objectsIndex.load(join(dataDir, 'objects.json'))
      .then(() => {
        emit('index_ready', { index: 'objects' });
        log('Objects index loaded');
      })
      .catch((e) => {
        emit('index_failed', { index: 'objects', error: e.message });
        log(`Objects index failed: ${e.message}`);
      });
    filtersIndex.load(join(dataDir, 'filters.json'))
      .then(() => {
        emit('index_ready', { index: 'filters', count: filtersIndex.platformOSFilters().length });
        log(`Filters index loaded (${filtersIndex.platformOSFilters().length} platformOS filters)`);
      })
      .catch((e) => {
        emit('index_failed', { index: 'filters', error: e.message });
        log(`Filters index failed: ${e.message}`);
      });
    tagsIndex.load(join(dataDir, 'tags.json'))
      .then(() => {
        emit('index_ready', { index: 'tags', count: tagsIndex.platformOSTags().length });
        log(`Tags index loaded (${tagsIndex.platformOSTags().length} platformOS tags)`);
      })
      .catch((e) => {
        emit('index_failed', { index: 'tags', error: e.message });
        log(`Tags index failed: ${e.message}`);
      });
  } else {
    emit('index_failed', { index: 'all', error: 'data dir not found' });
    log('Warning: data dir not found — indexes will not be available');
  }

  // ── Build context and tool registry ───────────────────────────────────────
  // ── Session state for cross-call supervision ─────────────────────────────
  //
  // session.pending is the authoritative cross-tool suppression state.
  // validate_intent writes it (every successful validation replaces it).
  // validate_code/analyze_project read it and merge with explicit params.
  // scaffold(write:true) clears it after the files land on disk.
  const session = {
    fileHistory: new Map(),    // filePath → { calls, lastErrorCount, consecutiveNonDecreasing, lastChecks }
    validatedPlan: null,       // { planId, pendingFiles: Set, validatedFiles: Set } (legacy — see pending)
    pending: {
      files:         new Set(),
      translations:  new Set(),
      pages:         new Set(),
      planId:        null,
      validatedAt:   null,
      writeDirectly: false,      // true after successful scaffold_output validation (trusted track)
    },
    checkEffectiveness: {},    // check → { fixed, stuck } — transitions between consecutive validate_code calls
    scaffoldRuns: [],          // [{ ts, model, type, files: string[] }]
    enrichHistory: [],         // [{ file, check, ts }] — pending enrich_error calls awaiting validate_code
    hintEffectiveness: {},     // check → { hinted, fixedAfterHint } — hint-then-fix correlation
    pipelineTraces: new Map(), // filePath → trace[] — most recent pipeline trace per file
  };

  const ctx = {
    version: VERSION,
    directory: projectDir,
    lsp,
    lspReady,
    awaitLsp,
    posCliFound,
    checkCmd,
    checkArgs,
    dataDir,
    schemaIndex,
    objectsIndex,
    filtersIndex,
    tagsIndex,
    session,
    sessionBus,
    blobStore,
    analyticsStore,
    cacConfigState,
    log,
    emit,
    switchEngineMode,
    getEngineMode,
  };

  // ── Create MCP server (SDK) for stdio transport ───────────────────────────
  const mcpServer = new McpServer({
    name: 'pos-supervisor',
    version: VERSION,
  });

  // Register tools on both the registry (for HTTP) and McpServer (for stdio)
  const registry = createToolRegistry(ctx, mcpServer);
  log(`Registered ${registry.size} tools: ${[...registry.keys()].join(', ')}`);

  // ── Connect stdio transport (replaces hand-rolled stdio-server.js) ────────
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  log('MCP stdio transport connected (SDK)');

  // Exit process when stdin closes (client disconnected).
  // The SDK cleans up internally but doesn't call process.exit().
  // Small delay allows pending responses to flush before exit.
  process.stdin.on('close', () => {
    setTimeout(() => shutdown('stdin-closed'), 200);
  });

  // ── Session persistence (D3 — comparative session view) ───────────────────
  // sessionsDir + sessionId are declared above (Phase A1 event bus) so the
  // bus can open its NDJSON writer before the first emit fires.

  function saveSessionSummary() {
    try {
      mkdirSync(sessionsDir, { recursive: true });
      const stats = sessionStats.byTool;
      let totalCalls = 0, totalErrors = 0;
      for (const s of Object.values(stats)) {
        totalCalls += s.calls || 0;
        totalErrors += s.errors || 0;
      }
      const summary = {
        id: sessionId,
        startedAt: new Date(serverStartMs).toISOString(),
        endedAt: new Date().toISOString(),
        projectDir,
        version: VERSION,
        toolCalls: totalCalls,
        toolErrors: totalErrors,
        filesValidated: session.fileHistory.size,
        checkFrequency: sessionStats.checkFrequency,
        checkEffectiveness: session.checkEffectiveness,
        hintEffectiveness: session.hintEffectiveness,
        scaffoldRuns: session.scaffoldRuns.length,
        stats,
      };
      writeFileSync(join(sessionsDir, `${sessionId}.json`), JSON.stringify(summary, null, 2));
      log(`Session summary saved: ${sessionId}`);
    } catch (e) {
      log(`Session save failed: ${e.message}`);
    }
  }

  // ── Start HTTP transport (optional, for REST consumers and tests) ─────────
  if (httpPort > 0) {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();
    function getStatus() {
      return {
        version: VERSION,
        projectDir,
        posCliFound,
        lspReady: lspWarmupComplete,
        toolCount: registry.size,
        uptimeMs: Date.now() - startMs,
        startedAt,
        stats: sessionStats.byTool,
        checkFrequency: sessionStats.checkFrequency,
        plan: session.validatedPlan ? {
          planId: session.validatedPlan.planId,
          source: session.validatedPlan.source,
          pendingFiles: [...session.validatedPlan.pendingFiles],
          validatedFiles: [...session.validatedPlan.validatedFiles],
        } : null,
        fileHistory: [...session.fileHistory.entries()].map(([path, h]) => ({
          path,
          calls: h.calls,
          lastErrorCount: h.lastErrorCount,
          lastWarningCount: h.lastWarningCount ?? 0,
          lastChecks: h.lastChecks || [],
          prevChecks: h.prevChecks || [],
          consecutiveNonDecreasing: h.consecutiveNonDecreasing ?? 0,
        })),
        checkEffectiveness: session.checkEffectiveness,
        scaffoldRuns: session.scaffoldRuns,
        hintEffectiveness: session.hintEffectiveness,
        pipelineTraces: [...session.pipelineTraces.entries()].map(([path, trace]) => ({ path, trace })),
        analytics: analyticsStore ? analyticsStore.stats() : null,
        engineMode: getEngineMode(),
      };
    }
    const dataRoot = join(__dirname, 'data');
    startHttp(registry, { port: httpPort, log, version: VERSION, logPath, getStatus, restartLsp, dataRoot, subscribeToEvents, posCliPath, projectDir, sessionsDir, saveSessionSummary, analyticsStore, blobStore, onAnalyticsRebuild: syncDisabledRules, onOverridesChanged: () => { syncRuleOverrides(); syncDisabledRules(); }, onCacConfigChanged: syncCacConfig, switchEngineMode, getEngineMode });
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function shutdown(reason) {
    emit('server_stop', { reason });
    log(`Shutting down (${reason})...`);
    try { saveSessionSummary(); } catch {}
    try { fsWatcher?.close(); } catch {}
    try { promotedRulesWatcher?.close(); } catch {}
    try { analyticsStore?.close(); } catch {}
    try { sessionBus.close(); } catch {} // runs final replay-vs-projection invariant + closes NDJSON
    lsp.stop();
    closeLogger();
    mcpServer.close().catch(() => {});
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Exit cleanly on EPIPE
  process.on('uncaughtException', (err) => {
    if (err.code === 'EPIPE') {
      shutdown('EPIPE');
      return;
    }
    emit('uncaught_exception', { error: err.message, stack: err.stack });
    log(`Uncaught exception: ${err.message}`);
  });

  return { lsp, registry, ctx, mcpServer };
}
