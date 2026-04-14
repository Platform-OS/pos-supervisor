import { realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
import { startHttp } from './http-server.js';
import { createLogger } from './core/logger.js';
import { LSP_READY_TIMEOUT_MS } from './core/constants.js';

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

  // Wrap emit: track in-memory stats, add lightweight metadata, strip large payloads.
  // lsp_request events are very frequent and not useful in the log file.
  function emit(event, data = {}) {
    if (event === 'lsp_request') return; // too noisy
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
      broadcastSse({ event, ts: new Date().toISOString(), ...entry });
      return;
    }
    rawEmit(event, data);
    broadcastSse({ event, ts: new Date().toISOString(), ...data });
  }

  rawEmit('server_start', { projectDir, httpPort });
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
    fileHistory: new Map(),    // filePath → { calls, lastErrorCount, consecutiveNonDecreasing }
    validatedPlan: null,       // { planId, pendingFiles: Set, validatedFiles: Set } (legacy — see pending)
    pending: {
      files:         new Set(),
      translations:  new Set(),
      pages:         new Set(),
      planId:        null,
      validatedAt:   null,
      writeDirectly: false,      // true after successful scaffold_output validation (trusted track)
    },
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
    log,
    emit,
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
        })),
      };
    }
    const dataRoot = join(__dirname, 'data');
    startHttp(registry, { port: httpPort, log, version: VERSION, logPath, getStatus, restartLsp, dataRoot, subscribeToEvents, posCliPath, projectDir });
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function shutdown(reason) {
    emit('server_stop', { reason });
    log(`Shutting down (${reason})...`);
    try { fsWatcher?.close(); } catch {}
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
