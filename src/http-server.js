import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import yaml from 'js-yaml';
import { getToolList, dispatchTool } from './tools.js';
import { ToolError } from './core/tool-error.js';
import { HTTP_MAX_BODY } from './core/constants.js';
import { buildDashboardHtml } from './dashboard.js';
import { getProjectMap } from './tools/project-map.js';
import { buildDependencyGraph } from './core/dependency-graph.js';
import { checkScorecards, sessionSummaries, recommendations, toolSequenceBigrams } from './core/analytics-queries.js';

/**
 * HTTP server — REST endpoints for tool discovery, execution, and resources.
 * MCP protocol (JSON-RPC over stdio) is handled by the SDK transport in server.js.
 */
export function startHttp(registry, { port, log, version, logPath, getStatus, restartLsp, dataRoot, subscribeToEvents, posCliPath, projectDir, sessionsDir, saveSessionSummary, analyticsStore }) {
  if (!port) return null;

  const dashboardHtml = buildDashboardHtml();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    // ── Dashboard ────────────────────────────────────────────────────────
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      res.writeHead(302, { Location: '/dashboard' });
      return res.end();
    }

    if (method === 'GET' && url.pathname === '/dashboard') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(dashboardHtml),
      });
      return res.end(dashboardHtml);
    }

    // ── GET routes ──────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', server: 'pos-supervisor', version });
    }

    if (method === 'GET' && url.pathname === '/api/status') {
      const status = getStatus ? getStatus() : { version };
      return sendJson(res, 200, status);
    }

    if (method === 'GET' && url.pathname === '/api/logs') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
      return sendJson(res, 200, { entries: readLogTail(logPath, limit) });
    }

    if (method === 'GET' && url.pathname === '/tools') {
      return sendJson(res, 200, { tools: getToolList(registry) });
    }

    if (method === 'GET' && url.pathname === '/api/knowledge') {
      return handleGetKnowledge(dataRoot, res);
    }

    if (method === 'GET' && url.pathname === '/api/hints') {
      return handleGetHints(dataRoot, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/events') {
      return handleSse(subscribeToEvents, req, res);
    }

    if (method === 'GET' && url.pathname === '/api/pos-cli/envs') {
      return handleGetEnvs(projectDir, res);
    }

    if (method === 'GET' && url.pathname === '/api/suppressions') {
      return handleGetSuppressions(projectDir, res);
    }

    if (method === 'GET' && url.pathname === '/api/sessions') {
      return handleGetSessions(sessionsDir, res);
    }

    if (method === 'GET' && url.pathname === '/api/file') {
      return handleGetFile(projectDir, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/dependency-tree') {
      return handleGetDependencyTree(projectDir, getStatus, res);
    }

    // ── POST routes (need body parsing) ─────────────────────────────────
    if (method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      if (url.pathname === '/call') {
        return handleCall(registry, body, res);
      }

      if (url.pathname === '/api/lsp/restart') {
        return handleLspRestart(restartLsp, res);
      }

      if (url.pathname === '/api/pos-cli/data-clean') {
        return handlePosCliCommand(posCliPath, projectDir, body, 'data-clean', log, res);
      }

      if (url.pathname === '/api/pos-cli/deploy') {
        return handlePosCliCommand(posCliPath, projectDir, body, 'deploy', log, res);
      }

      if (url.pathname === '/api/suppressions') {
        return handlePostSuppression(projectDir, body, log, res);
      }

      if (url.pathname === '/api/sessions/save') {
        if (saveSessionSummary) { saveSessionSummary(); }
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/analytics/rebuild') {
        return handleAnalyticsRebuild(analyticsStore, sessionsDir, res);
      }
    }

    // ── Analytics GET routes ──────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/api/analytics/stats') {
      if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
      return sendJson(res, 200, analyticsStore.stats());
    }

    if (method === 'GET' && url.pathname === '/api/analytics/scorecards') {
      return handleAnalyticsScorecards(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/sessions') {
      return handleAnalyticsSessions(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/recommendations') {
      return handleAnalyticsRecommendations(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/bigrams') {
      return handleAnalyticsBigrams(analyticsStore, url, res);
    }

    // ── Fallback ────────────────────────────────────────────────────────
    sendJson(res, 404, { error: 'Not found' });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log?.(`HTTP port ${port} already in use — dashboard unavailable (another instance may be running)`);
    } else {
      log?.(`HTTP server error: ${err.message}`);
    }
  });

  server.listen(port, () => {
    log?.(`HTTP server listening on http://localhost:${port}`);
    log?.(`Dashboard: http://localhost:${port}/dashboard`);
  });

  return server;
}

// ── Route handlers ────────────────────────────────────────────────────────

async function handleCall(registry, body, res) {
  const { tool, name, params } = body;
  const toolName = tool || name;
  if (!toolName) {
    return sendJson(res, 400, { error: 'Missing tool name. Provide "tool" or "name" field.' });
  }

  try {
    const result = await dispatchTool(registry, toolName, params ?? {});
    sendJson(res, 200, { result });
  } catch (err) {
    const status = err instanceof ToolError ? err.status
      : err.message.startsWith('Unknown tool') ? 404
      : 500;
    sendJson(res, status, { error: err.message });
  }
}

async function handleLspRestart(restartLsp, res) {
  if (!restartLsp) {
    return sendJson(res, 503, { error: 'LSP restart not available' });
  }
  try {
    await restartLsp();
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

function handleGetEnvs(projectDir, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  const posFile = join(projectDir, '.pos');
  if (!existsSync(posFile)) return sendJson(res, 404, { error: '.pos file not found in project directory' });
  try {
    const content = readFileSync(posFile, 'utf-8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') return sendJson(res, 200, { envs: [] });
    sendJson(res, 200, { envs: Object.keys(parsed) });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handlePosCliCommand(posCliPath, projectDir, body, command, log, res) {
  if (!posCliPath) return sendJson(res, 503, { error: 'pos-cli not found' });
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });

  const { env } = body;
  if (!env || typeof env !== 'string' || !/^[\w-]+$/.test(env)) {
    return sendJson(res, 400, { error: 'Invalid or missing env parameter' });
  }

  let args;
  if (command === 'data-clean') {
    args = ['data', 'clean', '--auto-confirm', '--include-schema', env];
  } else if (command === 'deploy') {
    args = ['deploy', env];
  } else {
    return sendJson(res, 400, { error: 'Unknown command' });
  }

  log?.(`pos-cli ${command}: starting with env=${env}`);

  const child = spawn('node', [posCliPath, ...args], {
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  child.on('close', (code) => {
    log?.(`pos-cli ${command}: exited with code=${code}`);
    if (code === 0) {
      sendJson(res, 200, { ok: true, output: stdout, stderr: stderr || undefined });
    } else {
      sendJson(res, 500, { error: `pos-cli ${command} failed (exit code ${code})`, output: stdout, stderr });
    }
  });

  child.on('error', (err) => {
    log?.(`pos-cli ${command}: spawn error: ${err.message}`);
    sendJson(res, 500, { error: err.message });
  });
}

function handleGetKnowledge(dataRoot, res) {
  if (!dataRoot) return sendJson(res, 503, { error: 'Data dir not available' });
  try {
    const knowledge = JSON.parse(readFileSync(join(dataRoot, 'knowledge.json'), 'utf-8'));
    sendJson(res, 200, { knowledge });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleGetHints(dataRoot, url, res) {
  if (!dataRoot) return sendJson(res, 503, { error: 'Data dir not available' });
  const hintsDir = join(dataRoot, 'hints');
  const name = url.searchParams.get('name');
  try {
    if (name) {
      const content = readFileSync(join(hintsDir, `${name}.md`), 'utf-8');
      return sendJson(res, 200, { name, content });
    }
    const files = readdirSync(hintsDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
    sendJson(res, 200, { hints: files });
  } catch (e) {
    sendJson(res, 404, { error: e.message });
  }
}

function handleSse(subscribeToEvents, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');

  if (!subscribeToEvents) {
    res.end();
    return;
  }

  const unsubscribe = subscribeToEvents((entry) => {
    try {
      res.write('data: ' + JSON.stringify(entry) + '\n\n');
    } catch {}
  });

  // Keep-alive ping every 15s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 15_000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}

// ── Suppression file (A3 — false positive manager) ───────────────────────

const SUPPRESS_FILE = '.pos-supervisor-ignore.yml';

function handleGetSuppressions(projectDir, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  const filePath = join(projectDir, SUPPRESS_FILE);
  if (!existsSync(filePath)) return sendJson(res, 200, { suppressions: [] });
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content);
    sendJson(res, 200, { suppressions: parsed?.suppressions || [] });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handlePostSuppression(projectDir, body, log, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  const { check, file_pattern, reason, action } = body;

  if (!check || typeof check !== 'string') {
    return sendJson(res, 400, { error: 'Missing or invalid "check" field' });
  }

  const filePath = join(projectDir, SUPPRESS_FILE);
  let existing = { suppressions: [] };
  if (existsSync(filePath)) {
    try {
      existing = yaml.load(readFileSync(filePath, 'utf-8')) || { suppressions: [] };
    } catch { existing = { suppressions: [] }; }
  }
  if (!existing.suppressions) existing.suppressions = [];

  if (action === 'remove') {
    existing.suppressions = existing.suppressions.filter(s =>
      !(s.check === check && (s.file_pattern || '') === (file_pattern || ''))
    );
  } else {
    const dup = existing.suppressions.find(s =>
      s.check === check && (s.file_pattern || '') === (file_pattern || '')
    );
    if (!dup) {
      const entry = { check };
      if (file_pattern) entry.file_pattern = file_pattern;
      if (reason) entry.reason = reason;
      entry.added_at = new Date().toISOString();
      existing.suppressions.push(entry);
    }
  }

  try {
    writeFileSync(filePath, yaml.dump(existing, { lineWidth: 120 }));
    log?.(`Suppression ${action === 'remove' ? 'removed' : 'added'}: ${check}${file_pattern ? ' (' + file_pattern + ')' : ''}`);
    sendJson(res, 200, { ok: true, suppressions: existing.suppressions });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Session history (D3 — comparative session view) ──────────────────────

function handleGetSessions(sessionsDir, res) {
  if (!sessionsDir) return sendJson(res, 200, { sessions: [] });
  if (!existsSync(sessionsDir)) return sendJson(res, 200, { sessions: [] });
  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json')).sort().reverse();
    const sessions = files.slice(0, 50).map(f => {
      try { return JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
    sendJson(res, 200, { sessions });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Project file reader (D1 — live diagnostic console) ──────────────────

const FILE_READ_MAX_BYTES = 512 * 1024;
const FILE_READ_EXTS = new Set(['.liquid', '.graphql', '.yml', '.yaml', '.md', '.html', '.css', '.js', '.json']);

function handleGetFile(projectDir, url, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  const rel = url.searchParams.get('path');
  if (!rel || typeof rel !== 'string') return sendJson(res, 400, { error: 'Missing path parameter' });
  if (isAbsolute(rel)) return sendJson(res, 400, { error: 'Path must be relative to project root' });

  const projectRoot = resolve(projectDir);
  const target = resolve(projectRoot, rel);
  const relCheck = relative(projectRoot, target);
  if (relCheck.startsWith('..') || isAbsolute(relCheck)) {
    return sendJson(res, 403, { error: 'Path escapes project root' });
  }

  const dotIdx = target.lastIndexOf('.');
  const ext = dotIdx >= 0 ? target.slice(dotIdx).toLowerCase() : '';
  if (!FILE_READ_EXTS.has(ext)) {
    return sendJson(res, 415, { error: 'File extension not allowed for preview: ' + ext });
  }

  if (!existsSync(target)) return sendJson(res, 404, { error: 'File not found' });

  try {
    const st = statSync(target);
    if (!st.isFile()) return sendJson(res, 400, { error: 'Not a regular file' });
    if (st.size > FILE_READ_MAX_BYTES) {
      return sendJson(res, 413, { error: 'File too large (max 512 KB)' });
    }
    const content = readFileSync(target, 'utf-8');
    sendJson(res, 200, { path: rel, ext, content });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Dependency impact tree ───────────────────────────────────────────────

async function handleGetDependencyTree(projectDir, getStatus, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  try {
    const projectMap = await getProjectMap(projectDir);
    const graph = buildDependencyGraph(projectMap);

    const fileHistory = getStatus ? (getStatus()?.fileHistory || []) : [];
    const stateByPath = Object.create(null);
    for (const f of fileHistory) {
      const errors = f.lastErrorCount || 0;
      const warnings = f.lastWarningCount || 0;
      const state = errors > 0 ? 'dirty'
                  : warnings > 0 ? 'warned'
                  : (f.calls || 0) > 1 ? 'fixed'
                  : 'clean';
      stateByPath[f.path] = { state, calls: f.calls || 0, errors, warnings, streak: f.consecutiveNonDecreasing || 0 };
    }

    const nodes = {};
    for (const [path, edges] of Object.entries(graph)) {
      nodes[path] = {
        depends_on: edges.depends_on,
        referenced_by: edges.referenced_by,
        validation: stateByPath[path] || null,
      };
    }

    sendJson(res, 200, { nodes, total: Object.keys(nodes).length, generated_at: new Date().toISOString() });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readLogTail(logPath, limit) {
  if (!logPath) return [];
  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Analytics handlers (Phase B) ───────────────────────────────────────────

function handleAnalyticsRebuild(analyticsStore, sessionsDir, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  if (!sessionsDir) return sendJson(res, 400, { error: 'sessions dir not configured' });
  try {
    const result = analyticsStore.rebuild(sessionsDir);
    sendJson(res, 200, { ok: true, ...result });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleAnalyticsScorecards(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const sessionId = url.searchParams.get('session_id') || undefined;
    const minCohort = parseInt(url.searchParams.get('min_cohort') || '10', 10);
    const cards = checkScorecards(analyticsStore, { sessionId, minCohort });
    sendJson(res, 200, { scorecards: cards });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleAnalyticsSessions(analyticsStore, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const summaries = sessionSummaries(analyticsStore);
    sendJson(res, 200, { sessions: summaries });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleAnalyticsRecommendations(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const threshold = parseFloat(url.searchParams.get('threshold') || '0.3');
    const recs = recommendations(analyticsStore, threshold);
    sendJson(res, 200, { recommendations: recs });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleAnalyticsBigrams(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const sessionId = url.searchParams.get('session_id') || undefined;
    const bigrams = toolSequenceBigrams(analyticsStore, { sessionId });
    sendJson(res, 200, { bigrams });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > HTTP_MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large (max 2 MB)'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}
