#!/usr/bin/env bun
/**
 * MCP stdio smoke test for pos-supervisor.
 *
 * Spawns the server as agents do — JSON-RPC over stdio — and verifies the
 * full handshake plus a tool call. Catches regressions in:
 *
 *   - bin/pos-supervisor.js shebang dispatch (Bun runtime)
 *   - StdioServerTransport wiring
 *   - tool registration on the McpServer instance (not just the HTTP registry)
 *   - server_status reporting pos_cli.found=true (Windows resolver regression)
 *
 * Exits 0 on full pass, 1 on any failure.
 *
 * Required env:
 *   POS_SUPERVISOR_PROJECT_DIR  — project root for the spawned server
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const STARTUP_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000;

let failures = 0;
const results = [];

function pass(label) { results.push({ status: 'PASS', label }); }
function fail(label, err) {
  failures++;
  results.push({ status: 'FAIL', label, error: err?.message ?? String(err) });
}

async function check(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (err) {
    fail(label, err);
  }
}

/**
 * Minimal JSON-RPC client for MCP stdio. Per the MCP spec, stdio uses
 * newline-delimited JSON (NDJSON), not LSP-style Content-Length headers.
 * Each message is `JSON.stringify(rpc) + '\n'`. We implement just enough
 * to send a request and await a matching response by id.
 */
class StdioRpcClient {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.notifications = [];
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => this.onData(chunk));
  }

  onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      this.dispatch(line);
    }
  }

  dispatch(line) {
    let msg;
    try { msg = JSON.parse(line); } catch {
      return; // not a JSON-RPC message — skip
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`RPC error: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    } else if (msg.method) {
      this.notifications.push(msg);
    }
  }

  send(method, params) {
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC ${method} timeout after ${REQUEST_TIMEOUT_MS}ms`));
        }
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(frame);
    });
  }

  notify(method, params) {
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.proc.stdin.write(frame);
  }
}

function spawnServer() {
  const isWindows = process.platform === 'win32';
  const bunCmd = isWindows ? 'bun.exe' : 'bun';
  return spawn(bunCmd, [join(REPO_ROOT, 'bin', 'pos-supervisor.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // Disable HTTP — this test exercises stdio only
      POS_SUPERVISOR_HTTP_PORT: '0',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
}

async function main() {
  console.log('[mcp-smoke] spawning pos-supervisor under Bun');
  console.log(`[mcp-smoke] project: ${process.env.POS_SUPERVISOR_PROJECT_DIR}`);

  const server = spawnServer();
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { server.stdin?.end(); } catch {}
    await new Promise(r => setTimeout(r, 500));
    try { server.kill('SIGTERM'); } catch {}
    await new Promise(r => setTimeout(r, 500));
    try { server.kill('SIGKILL'); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup().then(() => process.exit(130)); });
  process.on('SIGTERM', () => { cleanup().then(() => process.exit(143)); });

  // Give the process a moment to be ready to receive stdin
  await new Promise(r => setTimeout(r, 500));

  const rpc = new StdioRpcClient(server);

  try {
    // ── Initialize handshake ────────────────────────────────────────────
    await check('initialize handshake completes', async () => {
      const init = await Promise.race([
        rpc.send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'pos-supervisor-ci-smoke', version: '1.0.0' },
        }),
        new Promise((_, rej) => setTimeout(
          () => rej(new Error('initialize timed out')), STARTUP_TIMEOUT_MS
        )),
      ]);
      if (!init || !init.serverInfo) {
        throw new Error(`initialize response missing serverInfo: ${JSON.stringify(init)}`);
      }
      if (init.serverInfo.name !== 'pos-supervisor') {
        throw new Error(`serverInfo.name=${init.serverInfo.name}`);
      }
    });

    rpc.notify('notifications/initialized', {});

    // ── tools/list ──────────────────────────────────────────────────────
    let toolNames = [];
    await check('tools/list returns 11 tools', async () => {
      const r = await rpc.send('tools/list', {});
      if (!Array.isArray(r.tools)) throw new Error('tools not array');
      toolNames = r.tools.map(t => t.name);
      if (toolNames.length !== 11) {
        throw new Error(`tools.length=${toolNames.length}: ${toolNames.join(', ')}`);
      }
      const expected = [
        'validate_code', 'validate_intent', 'enrich_error', 'domain_guide',
        'analyze_project', 'project_map', 'lookup', 'scaffold',
        'module_info', 'server_status', 'load_development_guide',
      ];
      for (const name of expected) {
        if (!toolNames.includes(name)) throw new Error(`missing tool: ${name}`);
      }
    });

    // ── tools/call server_status — critical Windows regression marker ──
    await check('tools/call server_status — pos_cli.found=true', async () => {
      const r = await rpc.send('tools/call', { name: 'server_status', arguments: {} });
      if (!r.content || !Array.isArray(r.content) || r.content.length === 0) {
        throw new Error(`tools/call response missing content: ${JSON.stringify(r).slice(0, 300)}`);
      }
      // MCP serializes tool results as { content: [{ type: 'text', text: <json> }] }
      const text = r.content[0].text;
      let parsed;
      try { parsed = JSON.parse(text); } catch {
        throw new Error(`server_status content not JSON: ${text.slice(0, 200)}`);
      }
      if (!parsed.pos_cli?.found) {
        throw new Error(`pos_cli.found=false — resolver did not find pos-cli on this machine. Full payload: ${text.slice(0, 500)}`);
      }
    });

    await check('tools/call domain_guide — returns text content', async () => {
      const r = await rpc.send('tools/call', {
        name: 'domain_guide',
        arguments: { domain: 'partials', section: 'gotchas' },
      });
      if (!r.content || !Array.isArray(r.content) || r.content.length === 0) {
        throw new Error(`domain_guide returned no content`);
      }
    });
  } finally {
    await cleanup();
  }

  console.log('\n[mcp-smoke] ──────── results ────────');
  for (const r of results) {
    if (r.status === 'PASS') console.log(`  PASS ${r.label}`);
    else                      console.error(`  FAIL ${r.label}\n         ${r.error}`);
  }
  console.log(`[mcp-smoke] ${results.length - failures}/${results.length} passed`);

  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(`[mcp-smoke] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
