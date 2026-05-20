#!/usr/bin/env bun
/**
 * HTTP smoke test for pos-supervisor.
 *
 * Boots pos-supervisor under Bun (matching the documented runtime), then
 * probes every load-bearing HTTP endpoint with strong assertions. Critical
 * Windows regression markers:
 *
 *   - `/api/status.posCliFound` MUST be true — the 0.8.1 resolver fix
 *   - `/api/status.lspReady`   MUST be true — LSP must initialize
 *   - `/api/hints.hints[]` MUST contain `pos-supervisor:NonGetRenderingPage`
 *     in its canonical (prefixed) form, even though the hint file on disk
 *     is bare `NonGetRenderingPage.md` — the 0.8.0 colon-filename fix
 *
 * Exits 0 on full pass, 1 on any failure (with diagnostic output).
 *
 * Required env:
 *   POS_SUPERVISOR_PROJECT_DIR   — project root for the spawned server
 *   POS_SUPERVISOR_HTTP_PORT     — port to bind (default 13900)
 *
 * Usage from CI:
 *   POS_SUPERVISOR_PROJECT_DIR=$PWD/tests/fixtures/project \
 *   POS_SUPERVISOR_HTTP_PORT=13950 \
 *   bun scripts/ci-smoke-http.js
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PORT = Number(process.env.POS_SUPERVISOR_HTTP_PORT || '13900');
const BASE = `http://127.0.0.1:${PORT}`;
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
const EXPECTED_VERSION = PKG.version;

const HEALTH_TIMEOUT_MS = 90_000;
const LSP_READY_TIMEOUT_MS = 120_000;

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(path, init) {
  const url = `${BASE}${path}`;
  const r = await fetch(url, init);
  const body = await r.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch {
    throw new Error(`${path} returned non-JSON (status ${r.status}): ${body.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`${path} returned ${r.status}: ${body.slice(0, 200)}`);
  return parsed;
}

async function fetchText(path) {
  const r = await fetch(`${BASE}${path}`);
  const body = await r.text();
  if (!r.ok) throw new Error(`${path} returned ${r.status}`);
  return body;
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return await r.json();
    } catch { /* server not up yet */ }
    await sleep(500);
  }
  throw new Error(`server did not become healthy within ${HEALTH_TIMEOUT_MS}ms`);
}

async function waitForLspReady() {
  const start = Date.now();
  while (Date.now() - start < LSP_READY_TIMEOUT_MS) {
    try {
      const status = await fetchJson('/api/status');
      if (status.lspReady) return status;
    } catch { /* transient */ }
    await sleep(1000);
  }
  // Fall through — caller may still want partial probes.
  return null;
}

function spawnServer() {
  const isWindows = process.platform === 'win32';
  const bunCmd = isWindows ? 'bun.exe' : 'bun';
  const child = spawn(bunCmd, [join(REPO_ROOT, 'bin', 'pos-supervisor.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      POS_SUPERVISOR_HTTP_PORT: String(PORT),
    },
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  });
  child.on('error', err => {
    console.error(`[smoke] server spawn error: ${err.message}`);
    failures++;
  });
  return child;
}

async function main() {
  console.log(`[smoke] booting pos-supervisor v${EXPECTED_VERSION} on port ${PORT}`);
  console.log(`[smoke] project: ${process.env.POS_SUPERVISOR_PROJECT_DIR}`);

  const server = spawnServer();
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { server.stdin?.end(); } catch {}
    await sleep(500);
    try { server.kill('SIGTERM'); } catch {}
    await sleep(500);
    try { server.kill('SIGKILL'); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup().then(() => process.exit(130)); });
  process.on('SIGTERM', () => { cleanup().then(() => process.exit(143)); });

  try {
    const health = await waitForHealth();
    console.log(`[smoke] server up — version=${health.version}`);

    await check('GET /health returns 200 ok', async () => {
      const j = await fetchJson('/health');
      if (j.status !== 'ok') throw new Error(`status=${j.status}`);
      if (j.version !== EXPECTED_VERSION) {
        throw new Error(`version=${j.version}, expected ${EXPECTED_VERSION}`);
      }
    });

    // ── Critical Windows regression markers ─────────────────────────────
    await check('GET /api/status — posCliFound=true (0.8.1 resolver fix)', async () => {
      const j = await fetchJson('/api/status');
      if (!j.posCliFound) {
        throw new Error('posCliFound=false — pos-cli resolver did not find pos-cli on this machine');
      }
    });

    console.log('[smoke] waiting for LSP warmup...');
    const lspStatus = await waitForLspReady();
    await check('GET /api/status — lspReady=true within timeout', async () => {
      if (!lspStatus || !lspStatus.lspReady) {
        throw new Error(`LSP did not initialize within ${LSP_READY_TIMEOUT_MS}ms`);
      }
    });

    await check('GET /api/status — toolCount=11', async () => {
      const j = await fetchJson('/api/status');
      if (j.toolCount !== 11) throw new Error(`toolCount=${j.toolCount}`);
    });

    // ── Dashboard ────────────────────────────────────────────────────────
    await check('GET / redirects/serves dashboard', async () => {
      await fetchText('/');
    });

    await check('GET /dashboard returns substantive HTML', async () => {
      const html = await fetchText('/dashboard');
      if (html.length < 5000) {
        throw new Error(`dashboard HTML suspiciously short: ${html.length} bytes`);
      }
      if (!html.includes('pos-supervisor')) {
        throw new Error('dashboard HTML missing "pos-supervisor" identifier');
      }
      if (!html.includes('<html')) {
        throw new Error('dashboard response is not HTML');
      }
    });

    // ── Tool registry ────────────────────────────────────────────────────
    await check('GET /tools — 11 tools, all expected names present', async () => {
      const j = await fetchJson('/tools');
      if (!Array.isArray(j.tools)) throw new Error('tools not an array');
      if (j.tools.length !== 11) throw new Error(`tools.length=${j.tools.length}`);
      const expected = [
        'validate_code', 'validate_intent', 'enrich_error', 'domain_guide',
        'analyze_project', 'project_map', 'lookup', 'scaffold',
        'module_info', 'server_status', 'load_development_guide',
      ];
      for (const name of expected) {
        if (!j.tools.some(t => t.name === name)) {
          throw new Error(`missing tool in registry: ${name}`);
        }
      }
    });

    // ── Hints catalog (0.8.0 colon-filename fix regression marker) ──────
    await check('GET /api/hints — pos-supervisor:NonGetRenderingPage canonical', async () => {
      const j = await fetchJson('/api/hints');
      if (!Array.isArray(j.hints)) throw new Error('hints not an array');
      if (!j.hints.includes('pos-supervisor:NonGetRenderingPage')) {
        throw new Error('canonical pos-supervisor:NonGetRenderingPage not in /api/hints — 0.8.0 colon-fix regressed');
      }
      if (!j.hints.includes('GraphQLCheck')) {
        throw new Error('GraphQLCheck not in /api/hints — basic hint loader broken');
      }
      // Per-check sources metadata
      const ngrp = j.checks.find(c => c.name === 'pos-supervisor:NonGetRenderingPage');
      if (!ngrp || !ngrp.sources.includes('static')) {
        throw new Error('NonGetRenderingPage not flagged source=static — file rename / prefix-strip broken');
      }
    });

    await check('GET /api/hints?name=pos-supervisor:NonGetRenderingPage — returns md content', async () => {
      const j = await fetchJson('/api/hints?name=' + encodeURIComponent('pos-supervisor:NonGetRenderingPage'));
      if (j.source !== 'static') throw new Error(`source=${j.source}`);
      if (typeof j.content !== 'string' || j.content.length < 50) {
        throw new Error('content empty or too short');
      }
    });

    await check('GET /api/hints?name=GraphQLCheck — static md hint', async () => {
      const j = await fetchJson('/api/hints?name=GraphQLCheck');
      if (j.source !== 'static') throw new Error(`source=${j.source}`);
    });

    await check('GET /api/hints?name=GraphQLVariablesCheck — rule-driven synthesis', async () => {
      const j = await fetchJson('/api/hints?name=GraphQLVariablesCheck');
      if (j.source !== 'rule') throw new Error(`source=${j.source}`);
      if (!Array.isArray(j.rule_ids) || j.rule_ids.length === 0) {
        throw new Error('rule_ids empty');
      }
    });

    // ── Knowledge base ──────────────────────────────────────────────────
    await check('GET /api/knowledge — knowledge.json served', async () => {
      const j = await fetchJson('/api/knowledge');
      if (typeof j !== 'object' || j === null) throw new Error('knowledge response not an object');
    });

    // ── Analytics surface ───────────────────────────────────────────────
    await check('GET /api/analytics/stats — analytics store responding', async () => {
      await fetchJson('/api/analytics/stats');
    });

    await check('GET /api/analytics/scorecards', async () => {
      await fetchJson('/api/analytics/scorecards');
    });

    await check('GET /api/analytics/sessions', async () => {
      await fetchJson('/api/analytics/sessions');
    });

    await check('GET /api/analytics/recommendations', async () => {
      await fetchJson('/api/analytics/recommendations');
    });

    await check('GET /api/analytics/rule-scores', async () => {
      await fetchJson('/api/analytics/rule-scores');
    });

    await check('GET /api/analytics/rule-performance', async () => {
      await fetchJson('/api/analytics/rule-performance');
    });

    await check('GET /api/analytics/baseline', async () => {
      await fetchJson('/api/analytics/baseline');
    });

    // ── Sessions ────────────────────────────────────────────────────────
    await check('GET /api/sessions — session index', async () => {
      const j = await fetchJson('/api/sessions');
      if (!j || (!Array.isArray(j) && !Array.isArray(j.sessions))) {
        throw new Error('sessions response shape unexpected');
      }
    });

    // ── pos-cli envs (depends on resolver finding pos-cli) ──────────────
    await check('GET /api/pos-cli/envs — pos-cli envs probe', async () => {
      const r = await fetch(`${BASE}/api/pos-cli/envs`);
      if (r.status !== 200 && r.status !== 503) {
        throw new Error(`unexpected status ${r.status}`);
      }
    });

    // ── Tool execution via /call ────────────────────────────────────────
    await check('POST /call server_status — pos_cli.found=true', async () => {
      const j = await fetchJson('/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'server_status', params: {} }),
      });
      const found = j.pos_cli?.found ?? j.posCliFound ?? j.result?.pos_cli?.found;
      if (!found) {
        throw new Error(`server_status reports pos_cli.found falsy — got ${JSON.stringify(j).slice(0, 300)}`);
      }
    });

    await check('POST /call domain_guide — returns content', async () => {
      const j = await fetchJson('/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'domain_guide', params: { domain: 'partials', section: 'gotchas' } }),
      });
      if (j.error) throw new Error(`tool error: ${j.error}`);
    });

    await check('POST /call project_map — scans fixture project', async () => {
      const j = await fetchJson('/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'project_map', params: {} }),
      });
      if (j.error) throw new Error(`tool error: ${j.error}`);
    });
  } finally {
    await cleanup();
  }

  console.log('\n[smoke] ──────── results ────────');
  for (const r of results) {
    if (r.status === 'PASS') console.log(`  PASS ${r.label}`);
    else                      console.error(`  FAIL ${r.label}\n         ${r.error}`);
  }
  console.log(`[smoke] ${results.length - failures}/${results.length} passed`);

  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(`[smoke] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
