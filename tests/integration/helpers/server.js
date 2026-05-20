/**
 * Shared test helper — starts pos-supervisor HTTP server against a project directory.
 *
 * Usage:
 *   import { startServer } from './helpers/server.js';
 *   let server;
 *   beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
 *   afterAll(() => server.stop());
 *   const result = await server.callTool('project_map', { scope: 'full' });
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const BIN = join(import.meta.dir, '..', '..', '..', 'bin', 'pos-supervisor.js');

/**
 * Start a pos-supervisor server against the given project directory.
 * Returns an object with callTool(), callToolRaw(), and stop().
 */
export async function startServer(projectDir, { timeoutMs = 60_000 } = {}) {
  const port = 13700 + Math.floor(Math.random() * 300);

  const proc = spawn('node', [BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      POS_SUPERVISOR_HTTP_PORT: String(port),
      POS_SUPERVISOR_PROJECT_DIR: projectDir,
    },
  });

  let stderr = '';
  let ready = false;

  // Forward server stderr to the test runner's stderr so CI logs include the
  // spawned process's diagnostics. Without this we are blind on remote runners
  // — every cross-platform LSP / resolver issue must be guessed at instead of
  // observed. Filter to lines we actually want (server emits a `[pos-supervisor]`
  // prefix on every log line) so the test output stays scannable.
  const FORWARD_STDERR = process.env.POS_SUPERVISOR_TEST_FORWARD_STDERR !== '0';

  await new Promise((resolve, reject) => {
    // Wait for the HTTP server AND the LSP to both be in a terminal state
    // — either ready, or explicitly failed. Resolving on "HTTP server
    // listening" alone raced LSP warm-up: cold pos-cli on CI takes several
    // seconds to index, while tests would fire immediately and hit the
    // empty-fallback path inside validate_code. The result was every
    // LSP-driven test (`validate_code` linting, `LSP contract:*`,
    // `Enrichment:*`, structural warnings, etc.) silently returning zero
    // diagnostics on the first run.
    //
    // Treat any of these as "LSP is no longer pending":
    //   - "LSP ready"              — warm-up succeeded
    //   - "LSP init failed"        — handshake never completed
    //   - "LSP warm-up failed"     — non-fatal, but means warm-up gave up
    //   - "pos-cli not found"      — resolver did not find pos-cli; no LSP
    //   - "Neither pos-cli nor Node.js found"
    //   - "pos-cli at … but no Node.js interpreter found"
    const lspTerminalRegex = /(LSP ready|LSP init failed|LSP warm-up failed|pos-cli not found — static tools only|Neither pos-cli nor Node\.js found|pos-cli at .* but no Node\.js interpreter found)/;

    let httpUp = false;
    let lspSettled = false;
    function maybeResolve() {
      if (httpUp && lspSettled && !ready) {
        ready = true;
        resolve();
      }
    }

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (FORWARD_STDERR) {
        // Tag each forwarded line so the source is obvious in CI output.
        for (const line of text.split('\n')) {
          if (!line) continue;
          process.stderr.write(`  ↳ [server :${port}] ${line}\n`);
        }
      }
      if (!httpUp && stderr.includes('HTTP server listening')) {
        httpUp = true;
        maybeResolve();
      }
      if (!lspSettled && lspTerminalRegex.test(stderr)) {
        lspSettled = true;
        maybeResolve();
      }
    });

    // MCP protocol: initialize then notify initialized
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }) + '\n',
    );
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );

    setTimeout(() => {
      if (!ready) reject(new Error(`Server did not start within ${timeoutMs}ms (httpUp=${httpUp}, lspSettled=${lspSettled})\n${stderr}`));
    }, timeoutMs);
  });

  const baseUrl = `http://localhost:${port}`;

  /**
   * Call a tool and return the parsed result object.
   * Throws on HTTP or tool-level errors.
   */
  async function callTool(name, params = {}) {
    const res = await fetch(`${baseUrl}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, params }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.result;
  }

  /**
   * Call a tool and return the full HTTP response { status, body }.
   */
  async function callToolRaw(name, params = {}) {
    const res = await fetch(`${baseUrl}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, params }),
    });
    return { status: res.status, body: await res.json() };
  }

  function stop() {
    try {
      proc.stdin.end();
      proc.kill('SIGTERM');
    } catch { /* already dead */ }
  }

  return { proc, port, baseUrl, callTool, callToolRaw, stop };
}

/**
 * Create a temporary copy of a project directory for tests that write files.
 * Returns { dir, cleanup }.
 */
export function createTempProject(sourceDir) {
  const dir = mkdtempSync(join(tmpdir(), 'pos-supervisor-test-'));
  cpSync(sourceDir, dir, { recursive: true });
  return {
    dir,
    cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

export const FIXTURE_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'project');
