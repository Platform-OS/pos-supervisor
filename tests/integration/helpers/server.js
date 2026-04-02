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
export async function startServer(projectDir, { timeoutMs = 20_000 } = {}) {
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

  await new Promise((resolve, reject) => {
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes('HTTP server listening') && !ready) {
        ready = true;
        resolve();
      }
    });

    // Send initialize on stdin so stdio server doesn't block
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
    );

    setTimeout(() => {
      if (!ready) reject(new Error(`Server did not start within ${timeoutMs}ms\n${stderr}`));
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
