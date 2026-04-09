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
  const { emit, log, close: closeLogger } = createLogger({ directory: projectDir, version: VERSION });

  emit('server_start', { projectDir, httpPort });
  log(`Starting pos-supervisor v${VERSION} for ${projectDir}`);

  // ── Resolve pos-cli paths ─────────────────────────────────────────────────
  let lspCmd = 'pos-cli';
  let lspArgs = ['lsp'];
  let checkCmd = 'pos-cli';
  let checkArgs = ['check', 'run', '-f', 'json'];
  let dataDir = null;
  let posCliFound = false;

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
  const lspWarmupReady = new Promise((resolve) => {
    lsp.initialize(rootUri, { version: VERSION })
      .then(async () => {
        // ─ LSP Warm-up: Force full project indexing ─
        // MissingPartial cross-reference checking requires the LSP's partials index to be fully populated.
        // The LSP lazily builds this index as files are analyzed. We need to trigger analysis of
        // representative files from each project area to ensure the index is complete BEFORE
        // any real validation calls.
        try {
          const warmupUris = [
            // Page files (these use partials via {% render %})
            toUri(join(projectDir, 'app', 'views', 'pages', '_warmup_page.html.liquid')),
            // Partial files (define available partials)
            toUri(join(projectDir, 'app', 'views', 'partials', '_warmup_partial.liquid')),
            // Command files (may reference partials)
            toUri(join(projectDir, 'app', 'lib', 'commands', '_warmup', '_warmup.liquid')),
          ];

          const warmupContent = '<!-- LSP cross-reference warmup -->\n{% render "products/nonexistent" %}';

          log('LSP warming up cross-reference index...');
          let indexReady = 0;

          // Request diagnostics for each area in sequence to trigger indexing
          // Each request blocks until the LSP has analyzed that area
          for (const uri of warmupUris) {
            try {
              await lsp.awaitDiagnostics(uri, warmupContent, 15000);
              indexReady++;
            } catch (e) {
              // Each warmup file is best-effort; failure is non-fatal
              log(`Partial warmup failed for ${uri}: ${e.message}`);
            }
          }

          emit('lsp_warmed_up', { durationMs: Date.now() - lspStart, indexReady });
          log(`LSP warmed up (${indexReady}/${warmupUris.length} index areas indexed)`);
          lspWarmupComplete = true;
        } catch (e) {
          // Warm-up failure is non-fatal
          log(`LSP warm-up failed (non-fatal): ${e.message}`);
          lspWarmupComplete = true;
        }

        emit('lsp_ready', { durationMs: Date.now() - lspStart });
        log('LSP ready');
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
  // ── Session state for cross-call supervision (non-blocking, advisory) ────
  const session = {
    fileHistory: new Map(),    // filePath → { calls, lastErrorCount, consecutiveNonDecreasing }
    validatedPlan: null,       // { planId, pendingFiles: Set, validatedFiles: Set }
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

  // ── Register resources on McpServer ───────────────────────────────────────
  const synthesisPath = join(__dirname, 'data', 'resources', 'platformos-synthesis.md');
  mcpServer.resource(
    'platformos-synthesis',
    'pos-supervisor://knowledge/platformos-synthesis',
    {
      description: 'Complete platformOS patterns, architecture rules, and API reference. Load at session start for full platform context.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(synthesisPath, 'utf-8');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    }
  );

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
    startHttp(registry, { port: httpPort, log, version: VERSION });
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function shutdown(reason) {
    emit('server_stop', { reason });
    log(`Shutting down (${reason})...`);
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
