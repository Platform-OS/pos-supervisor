import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import yaml from 'js-yaml';
import { getToolList, dispatchTool } from './tools.js';
import { ToolError } from './core/tool-error.js';
import { HTTP_MAX_BODY } from './core/constants.js';
import { buildDashboardHtml } from './dashboard.js';
import { getProjectMap } from './tools/project-map.js';
import { buildDependencyGraph } from './core/dependency-graph.js';
import { checkScorecards, sessionSummaries, recommendations, toolSequenceBigrams, diagnosticJourney, confidenceCalibration, fixAdoptionFunnel, knowledgeGaps, ruleScoresByCategory, ruleDrilldown, rulePerformance, adaptiveModeImpact, fixRulePerformance } from './core/analytics-queries.js';
import { ruleScores, suggestedRules, retrieveCasesByCheck, generateRuleTemplate, synthesizeGuardPredicate } from './core/case-base.js';
import { addPromotedRule, removePromotedRule, listPromotedRules } from './core/rules/promoted-rules.js';
import { reloadRules, loadAllRules } from './core/rules/index.js';
import { runRules, getDisabledRules, getAllChecksWithRules, getRulesForCheck, getDisabledRuleDetails, getForceEnabledRules, getForceDisabledRules } from './core/rules/engine.js';
import { loadOverrides, addForceEnable, addForceDisable, removeOverride } from './core/rule-overrides.js';
import { extractParams, templateOf, KNOWN_EXTRACTOR_CHECKS } from './core/diagnostic-record.js';
import { buildFactGraph } from './core/project-fact-graph.js';

/**
 * HTTP server — REST endpoints for tool discovery, execution, and resources.
 * MCP protocol (JSON-RPC over stdio) is handled by the SDK transport in server.js.
 */
export function startHttp(registry, { port, log, version, logPath, getStatus, restartLsp, dataRoot, subscribeToEvents, posCliPath, projectDir, sessionsDir, saveSessionSummary, analyticsStore, blobStore, onAnalyticsRebuild, onOverridesChanged, switchEngineMode, getEngineMode }) {
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

    // ── Vendor static files ─────────────────────────────────────────────
    if (method === 'GET' && url.pathname.startsWith('/vendor/')) {
      return handleVendorFile(url.pathname, res);
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

    if (method === 'GET' && url.pathname === '/api/engine/mode') {
      return sendJson(res, 200, { mode: getEngineMode?.() ?? 'static' });
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

    if (method === 'GET' && url.pathname === '/api/rules/promoted') {
      return handleGetPromotedRules(projectDir, res);
    }

    // ── DELETE routes ──────────────────────────────────────────────────────
    if (method === 'DELETE' && url.pathname === '/api/rules/promote') {
      return handleDeletePromotedRule(projectDir, url, res);
    }

    // ── POST routes (no body) ────────────────────────────────────────────
    if (method === 'POST') {
      if (url.pathname === '/api/lsp/restart') {
        return handleLspRestart(restartLsp, res);
      }

      if (url.pathname === '/api/sessions/save') {
        if (saveSessionSummary) { saveSessionSummary(); }
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/analytics/rebuild') {
        return handleAnalyticsRebuild(analyticsStore, sessionsDir, onAnalyticsRebuild, res);
      }

      // ── POST routes (need body parsing) ───────────────────────────────
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      if (url.pathname === '/call') {
        return handleCall(registry, body, res);
      }

      if (url.pathname === '/api/pos-cli/data-clean') {
        return handlePosCliCommand(posCliPath, projectDir, body, 'data-clean', log, res);
      }

      if (url.pathname === '/api/pos-cli/deploy') {
        return handlePosCliCommand(posCliPath, projectDir, body, 'deploy', log, res);
      }

      if (url.pathname === '/api/rules/promote') {
        return handlePromoteRule(projectDir, body, res);
      }

      if (url.pathname === '/api/engine/mode') {
        return handleSetEngineMode(switchEngineMode, body, log, res);
      }

      if (url.pathname === '/api/health-score') {
        return handlePostHealthScore(analyticsStore, body, res);
      }

      if (url.pathname === '/api/suppressions') {
        return handlePostSuppression(projectDir, body, log, res);
      }

      if (url.pathname === '/api/rules/test') {
        return handleRuleTest(body, res, analyticsStore, projectDir);
      }

      if (url.pathname === '/api/engine/rule-overrides') {
        return handleRuleOverridesMutate(projectDir, body, res, log, onOverridesChanged);
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

    if (method === 'GET' && url.pathname === '/api/analytics/rule-scores') {
      return handleRuleScores(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/rule-performance') {
      return handleRulePerformance(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/fix-rule-performance') {
      return handleFixRulePerformance(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/rule-drilldown') {
      return handleRuleDrilldown(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/suggested-rules') {
      return handleSuggestedRules(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/cases') {
      return handleCases(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/health-scores') {
      return handleGetHealthScores(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/journey') {
      return handleDiagnosticJourney(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/calibration') {
      return handleConfidenceCalibration(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/funnel') {
      return handleFixAdoptionFunnel(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/knowledge-gaps') {
      return handleKnowledgeGaps(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/rule-heatmap') {
      return handleRuleHeatmap(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/rules/checks') {
      return handleRuleChecks(res);
    }

    if (method === 'GET' && url.pathname === '/api/engine-map') {
      return handleEngineMap(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/blob') {
      return handleBlobRead(blobStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/engine/impact') {
      return handleEngineImpact(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/engine/rule-overrides') {
      return handleRuleOverridesList(projectDir, res, log);
    }
    // POST on this path is dispatched inside the POST block above so the
    // shared body-parser isn't read twice.

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

/**
 * Two coexisting hint subsystems are joined here:
 *   • static  — `src/data/hints/<Check>.md` rendered into the diagnostic by
 *               error-enricher.js. Legacy LSP checks; one fixed blob each.
 *   • rule    — `src/core/rules/<Check>.js` builds the hint dynamically per
 *               diagnostic. No md file exists; the registry is the source.
 *
 * Pre-fix the endpoint only knew about (1) and 404'd on every (2). The
 * dashboard drilldown silently broke for the 12+ rule-driven checks
 * (GraphQLVariablesCheck, PartialCallArguments, NonGetRenderingPage, …).
 *
 * Response shape:
 *   GET /api/hints
 *     { hints: [name, …],            // backward-compat: union of both kinds
 *       checks: [{ name, sources: ['static'|'rule', …] }, …] }
 *   GET /api/hints?name=<X>
 *     { name, content, source: 'static' }                              // md found
 *     { name, content, source: 'rule', rule_ids: [...] }               // synthesized from registry
 *     404 only when both lookups miss.
 */
function handleGetHints(dataRoot, url, res) {
  if (!dataRoot) return sendJson(res, 503, { error: 'Data dir not available' });
  const hintsDir = join(dataRoot, 'hints');
  const name = url.searchParams.get('name');

  // Populate the rule registry once. Idempotent — guarded by `_loaded`.
  loadAllRules();

  if (name) {
    const file = join(hintsDir, `${name}.md`);
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, 'utf-8');
        return sendJson(res, 200, { name, content, source: 'static' });
      } catch (e) {
        // Fall through — let the rule registry resolve it if possible.
      }
    }
    const rules = getRulesForCheck(name);
    if (rules.length > 0) {
      return sendJson(res, 200, {
        name,
        content: synthesizeRuleHintDoc(name, rules),
        source: 'rule',
        rule_ids: rules.map(r => r.id),
      });
    }
    return sendJson(res, 404, { error: `No hint or rule for ${name}` });
  }

  let staticNames = [];
  try {
    staticNames = readdirSync(hintsDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
  } catch {
    // hints dir may be missing on a fresh checkout — still return rule names.
  }
  const ruleNames = getAllChecksWithRules();
  const staticSet = new Set(staticNames);
  const ruleSet = new Set(ruleNames);
  const all = Array.from(new Set([...staticNames, ...ruleNames])).sort();
  const checks = all.map(n => {
    const sources = [];
    if (staticSet.has(n)) sources.push('static');
    if (ruleSet.has(n)) sources.push('rule');
    return { name: n, sources };
  });
  sendJson(res, 200, { hints: all, checks });
}

/**
 * Render a markdown reference doc for a rule-driven check by introspecting
 * the registry. Lists each sub-rule with its priority and the source of its
 * `when()` predicate (truncated). Surfaces the file path the developer must
 * edit to change the hint at runtime.
 */
function synthesizeRuleHintDoc(name, rules) {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const moduleBase = name.replace(/^pos-supervisor:/, '');
  const lines = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(
    `*Rule-driven check.* Hints are generated dynamically by ` +
    `\`src/core/rules/${moduleBase}.js\` at validation time. There is no static ` +
    `\`.md\` for this check — agents see whatever \`apply()\` returns from the ` +
    `first matching sub-rule below.`
  );
  lines.push('');
  lines.push(`## Sub-rules (${sorted.length})`);
  lines.push('');
  lines.push('Engine returns the first match in priority order (lower = higher priority).');
  lines.push('');
  for (const r of sorted) {
    lines.push(`### \`${r.id}\` — priority ${r.priority}`);
    lines.push('');
    const whenSrc = stringifyRulePredicate(r.when);
    if (whenSrc) {
      lines.push('```js');
      lines.push(`when: ${whenSrc}`);
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(
    `To change the hint shown to agents, edit the relevant \`apply()\` in ` +
    `\`src/core/rules/${moduleBase}.js\`. Each \`apply()\` returns ` +
    `\`{ rule_id, hint_md, fixes, confidence, see_also? }\` which the validator ` +
    `embeds into the diagnostic.`
  );
  return lines.join('\n');
}

function stringifyRulePredicate(fn) {
  if (typeof fn !== 'function') return null;
  try {
    const src = fn.toString();
    return src.length > 240 ? `${src.slice(0, 237)}...` : src;
  } catch {
    return null;
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

// ── Engine mode handler ─────────────────────────────────────────────────────

function handleSetEngineMode(switchEngineMode, body, log, res) {
  if (!switchEngineMode) return sendJson(res, 503, { error: 'Engine mode switching not available' });
  const { mode } = body ?? {};
  if (!mode || (mode !== 'adaptive' && mode !== 'static')) {
    return sendJson(res, 400, { error: 'Invalid mode. Must be "adaptive" or "static".' });
  }
  try {
    const newMode = switchEngineMode(mode);
    log?.(`engine-mode: switched to ${newMode} via HTTP`);
    sendJson(res, 200, { mode: newMode });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Promoted rules handlers (Phase J) ─────────────────────────────────────

function handleGetPromotedRules(projectDir, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  try {
    const rules = listPromotedRules(projectDir);
    sendJson(res, 200, { rules });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handlePromoteRule(projectDir, body, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });

  const { id, check, priority, when, apply } = body;
  if (!id || typeof id !== 'string') return sendJson(res, 400, { error: 'Missing or invalid "id" field' });
  if (!check || typeof check !== 'string') return sendJson(res, 400, { error: 'Missing or invalid "check" field' });
  if (!apply?.hint_md) return sendJson(res, 400, { error: 'Missing "apply.hint_md" field' });

  const entry = {
    id,
    check,
    priority: priority ?? 55,
    origin: 'promoted',
    promoted_at: new Date().toISOString(),
    probation: true,
    when: when ?? {},
    apply,
  };

  try {
    const supervisorDir = join(projectDir, '.pos-supervisor');
    if (!existsSync(supervisorDir)) mkdirSync(supervisorDir, { recursive: true });
    addPromotedRule(projectDir, entry);
    reloadRules(projectDir);
    sendJson(res, 201, { ok: true, rule: entry });
  } catch (e) {
    const status = e.message.includes('already exists') ? 409 : 500;
    sendJson(res, status, { error: e.message });
  }
}

function handleDeletePromotedRule(projectDir, url, res) {
  if (!projectDir) return sendJson(res, 503, { error: 'Project directory not configured' });
  const ruleId = url.searchParams.get('id');
  if (!ruleId) return sendJson(res, 400, { error: 'Missing "id" query parameter' });

  try {
    removePromotedRule(projectDir, ruleId);
    reloadRules(projectDir);
    sendJson(res, 200, { ok: true, removed: ruleId });
  } catch (e) {
    const status = e.message.includes('not found') ? 404 : 500;
    sendJson(res, status, { error: e.message });
  }
}

// ── Analytics query handlers (Phase K2-K5) ────────────────────────────────

function handleDiagnosticJourney(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  let templateFp = url.searchParams.get('template_fp');
  const check = url.searchParams.get('check');
  if (!templateFp && check) {
    const row = analyticsStore.queryOne(
      `SELECT template_fp, COUNT(*) as cnt FROM diagnostics WHERE check_name = ? AND template_fp IS NOT NULL GROUP BY template_fp ORDER BY cnt DESC LIMIT 1`,
      [check],
    );
    templateFp = row?.template_fp;
  }
  if (!templateFp) return sendJson(res, 400, { error: 'template_fp or check parameter required' });
  try {
    const journey = diagnosticJourney(analyticsStore, templateFp);
    sendJson(res, 200, journey);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleConfidenceCalibration(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const buckets = parseInt(url.searchParams.get('buckets') || '10', 10);
    const calibration = confidenceCalibration(analyticsStore, { buckets: Math.min(Math.max(buckets, 2), 20) });
    sendJson(res, 200, { calibration });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleFixAdoptionFunnel(analyticsStore, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const funnel = fixAdoptionFunnel(analyticsStore);
    sendJson(res, 200, funnel);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleKnowledgeGaps(analyticsStore, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const gaps = knowledgeGaps(analyticsStore);
    sendJson(res, 200, { gaps });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleRuleHeatmap(analyticsStore, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const cells = ruleScoresByCategory(analyticsStore);
    sendJson(res, 200, { cells });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

const CHECK_EXAMPLES = {
  UnknownFilter:   'Unknown filter "to_json"',
  UndefinedObject: "Variable 'product' is undefined",
  UnusedAssign:    "The variable 'x' is assigned but not used",
  MissingPartial:  "'forms/login' does not exist",
  TranslationKeyExists: "Translation key 'a.b.c' not found. Did you mean 'a.b.cd'?",
  UnknownProperty: "Unknown property `name` on `current_user`",
  MissingRenderPartialArguments: "Missing required argument 'email' in render tag for partial 'sessions/form'",
  MetadataParamsCheck: 'Required parameter clear must be passed to function call',
  GraphQLCheck:    'Variable "$id" is never used in operation "x"',
  DeprecatedTag:   "Tag 'include' is deprecated, use 'render'",
};

function handleRuleChecks(res) {
  try {
    loadAllRules();
    const checks = getAllChecksWithRules();
    const result = checks.map(check => {
      const rules = getRulesForCheck(check);
      return {
        check,
        rule_count: rules.length,
        rule_ids: rules.map(r => r.id),
        has_extractor: KNOWN_EXTRACTOR_CHECKS.includes(check),
        example_message: CHECK_EXAMPLES[check] || null,
      };
    }).sort((a, b) => a.check.localeCompare(b.check));
    sendJson(res, 200, { checks: result });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

async function handleRuleTest(body, res, analyticsStore, projDir) {
  try {
    const { check, message, file } = body;
    if (!check || !message) {
      return sendJson(res, 400, { error: 'Missing required fields: check, message' });
    }

    loadAllRules();
    const params = extractParams(check, message);
    const tmplFp = templateOf(check, message);
    const diag = { check, params, message, file: file || 'app/views/pages/test.liquid', line: 1, template_fp: tmplFp };

    let graph = null;
    let graphAvailable = false;
    try {
      if (projDir) {
        const projectMap = await getProjectMap(projDir);
        if (projectMap) {
          graph = buildFactGraph(projectMap);
          graphAvailable = true;
        }
      }
    } catch { /* project map unavailable — run without graph */ }

    const facts = { graph, filtersIndex: null, objectsIndex: null, tagsIndex: null, schemaIndex: null, analyticsStore };

    const matched = runRules(diag, facts);
    const allMatches = runRules(diag, facts, { multiMatch: true });
    const disabledRules = [...getDisabledRules()];

    const candidates = getRulesForCheck(check);
    const ruleEval = candidates.map(rule => {
      if (disabledRules.includes(rule.id)) return { rule_id: rule.id, status: 'disabled' };
      try {
        const whenResult = rule.when(diag, facts);
        if (!whenResult) return { rule_id: rule.id, status: 'guard_failed' };
        const applyResult = rule.apply(diag, facts);
        if (!applyResult) return { rule_id: rule.id, status: 'apply_returned_null' };
        return { rule_id: rule.id, status: 'matched' };
      } catch (e) {
        return { rule_id: rule.id, status: 'error', error: e.message };
      }
    });

    const CHECKS_NEEDING_INDEXES = ['UnknownFilter', 'UnknownProperty'];
    const notes = [];
    if (!graphAvailable) notes.push('Project map unavailable — rules requiring graph data cannot fire.');
    if (!facts.filtersIndex && CHECKS_NEEDING_INDEXES.includes(check)) notes.push('LSP indexes (filters, objects, tags) unavailable — some rules skipped.');

    sendJson(res, 200, {
      input: { check, message, file: diag.file },
      extracted_params: params,
      template_fp: tmplFp,
      graph_available: graphAvailable,
      matched_rule: matched ? {
        rule_id: matched.rule_id,
        hint_md: matched.hint_md,
        confidence: matched.confidence,
        fixes: matched.fixes || [],
        see_also: matched.see_also || null,
      } : null,
      all_matches: (allMatches || []).map(r => ({
        rule_id: r.rule_id,
        hint_md: r.hint_md,
        confidence: r.confidence,
      })),
      rule_evaluation: ruleEval,
      disabled_rules: disabledRules,
      note: notes.length > 0 ? notes.join(' ') : null,
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Health score handlers (Phase K1) ──────────────────────────────────────

function handlePostHealthScore(analyticsStore, body, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  const { score, mode, dimensions } = body;
  if (typeof score !== 'number' || score < 0 || score > 100) {
    return sendJson(res, 400, { error: 'Invalid score — must be a number 0-100' });
  }
  if (!mode || typeof mode !== 'string') {
    return sendJson(res, 400, { error: 'Missing or invalid "mode" field' });
  }
  try {
    analyticsStore.insertHealthScore({ score, mode, dimensions: dimensions ?? {} });
    sendJson(res, 201, { ok: true });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleGetHealthScores(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 200);
    const mode = url.searchParams.get('mode') || undefined;
    const scores = analyticsStore.getHealthScores({ limit, mode });
    sendJson(res, 200, { scores });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Vendor static files ──────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, 'vendor');
const VENDOR_MIME = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

function handleVendorFile(pathname, res) {
  const filename = pathname.replace('/vendor/', '');
  if (filename.includes('..') || filename.includes('/')) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  const filePath = join(VENDOR_DIR, filename);
  if (!existsSync(filePath)) return sendJson(res, 404, { error: 'Not found' });
  try {
    const content = readFileSync(filePath);
    const ext = filename.slice(filename.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': VENDOR_MIME[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(content);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

// ── Engine Map ──────────────────────────────────────────────────────────

const RULE_DEPS = {
  'MissingPartial.module_path':        { needs: ['params'], graph_queries: [] },
  'MissingPartial.file_exists':        { needs: ['params', 'graph'], graph_queries: ['hasNode'] },
  'MissingPartial.suggest_nearest':    { needs: ['params', 'graph'], graph_queries: ['nodesByType', 'dependsOn', 'nodeByPath'] },
  'MissingPartial.create_file':        { needs: ['params', 'graph'], graph_queries: ['hasNode'] },
  'UndefinedObject.shopify_object':    { needs: ['params'], graph_queries: [] },
  'UndefinedObject.context_prefix':    { needs: ['params'], graph_queries: [] },
  'UndefinedObject.declare_param':     { needs: ['params'], graph_queries: [] },
  'UndefinedObject.generic':           { needs: ['params'], graph_queries: [] },
  'UnknownFilter.tag_confusion':       { needs: ['params', 'tagsIndex'], graph_queries: [] },
  'UnknownFilter.shopify_filter':      { needs: ['params'], graph_queries: [] },
  'UnknownFilter.suggest_nearest':     { needs: ['params', 'filtersIndex'], graph_queries: [] },
  'UnknownFilter.generic':             { needs: ['params'], graph_queries: [] },
  'TranslationKeyExists.suggest_nearest': { needs: ['params', 'graph'], graph_queries: ['nodesByType'] },
  'TranslationKeyExists.create_key':   { needs: ['params'], graph_queries: [] },
  'UnusedAssign.passed_to_render':     { needs: ['params', 'graph'], graph_queries: ['renderCallsFrom'] },
  'UnusedAssign.passed_to_function':   { needs: ['params', 'graph'], graph_queries: ['nodeByPath'] },
  'UnusedAssign.generic':              { needs: ['params'], graph_queries: [] },
  'MissingRenderPartialArguments.doc_block_mismatch': { needs: ['params', 'graph'], graph_queries: ['partialSignature'] },
  'MissingRenderPartialArguments.chain_satisfied':    { needs: ['params', 'graph'], graph_queries: ['nodeByPath'] },
  'MissingRenderPartialArguments.generic':            { needs: ['params'], graph_queries: [] },
  'UnknownProperty.schema_property':   { needs: ['params', 'graph'], graph_queries: ['nodesByType'] },
  'UnknownProperty.context_property':  { needs: ['params', 'objectsIndex'], graph_queries: [] },
  'UnknownProperty.generic':           { needs: ['params'], graph_queries: [] },
  'MetadataParamsCheck.module_contract':    { needs: ['params'], graph_queries: [] },
  'MetadataParamsCheck.doc_block_params':   { needs: ['params', 'graph'], graph_queries: ['partialSignature'] },
  'MetadataParamsCheck.generic':            { needs: ['params'], graph_queries: [] },
  'GraphQLCheck.unknown_field':        { needs: ['params', 'graph'], graph_queries: ['nodesByType'] },
  'GraphQLCheck.unused_variable':      { needs: ['params'], graph_queries: [] },
  'GraphQLCheck.type_mismatch':        { needs: ['params'], graph_queries: [] },
  'GraphQLCheck.generic':              { needs: ['params'], graph_queries: [] },
};

function handleEngineMap(analyticsStore, res) {
  try {
    loadAllRules();
    const checks = getAllChecksWithRules();
    const disabledSet = getDisabledRules();

    const extractorChecks = [...KNOWN_EXTRACTOR_CHECKS];

    const hintFiles = [];
    const hintsDir = join(__dirname, 'data', 'hints');
    if (existsSync(hintsDir)) {
      for (const f of readdirSync(hintsDir)) {
        if (f.endsWith('.md')) {
          const name = f.replace('.md', '');
          const isVariant = name.includes('-');
          const baseCheck = isVariant ? name.split('-')[0] : name;
          hintFiles.push({ file: f, name, base_check: baseCheck, is_variant: isVariant });
        }
      }
    }

    let scores = [];
    if (analyticsStore) {
      try { scores = ruleScores(analyticsStore, { minEmitted: 1 }); } catch { /* no data yet */ }
    }
    const scoreMap = new Map(scores.map(s => [s.rule_id, s]));

    const checkNodes = checks.map(check => {
      const rules = getRulesForCheck(check);
      const hasExtractor = extractorChecks.includes(check);
      const hints = hintFiles.filter(h => h.base_check === check);

      const ruleNodes = rules.map(r => {
        const deps = RULE_DEPS[r.id] || { needs: ['params'], graph_queries: [] };
        const score = scoreMap.get(r.id);
        return {
          id: r.id,
          priority: r.priority,
          needs: deps.needs,
          graph_queries: deps.graph_queries,
          disabled: disabledSet.has(r.id),
          score: score ? {
            emitted: score.emitted,
            resolved: score.resolved,
            regressed: score.regressed,
            resolution_rate: score.resolution_rate,
            regression_rate: score.regression_rate,
            effectiveness: score.effectiveness,
            disabled: score.disabled,
          } : null,
        };
      });

      return {
        check,
        has_extractor: hasExtractor,
        example_message: CHECK_EXAMPLES[check] || null,
        hints: hints.map(h => h.name),
        rules: ruleNodes,
      };
    });

    const pipeline_steps = [
      'LSP Diagnostics',
      'Structural Warnings',
      'Diagnostic Pipeline (9 steps)',
      'Rule Engine (first-match)',
      'Error Enricher (fallback)',
      'Fix Generator',
      'Scorecard',
    ];

    const coverage = {
      checks_with_rules: checks.length,
      checks_with_extractors: extractorChecks.length,
      total_rules: checks.reduce((n, c) => n + getRulesForCheck(c).length, 0),
      total_hints: hintFiles.length,
      disabled_rules: disabledSet.size,
      rules_needing_graph: Object.values(RULE_DEPS).filter(d => d.needs.includes('graph')).length,
      rules_needing_indexes: Object.values(RULE_DEPS).filter(d => d.needs.includes('filtersIndex') || d.needs.includes('objectsIndex') || d.needs.includes('tagsIndex')).length,
      rules_params_only: Object.values(RULE_DEPS).filter(d => d.needs.length === 1 && d.needs[0] === 'params').length,
    };

    sendJson(res, 200, { checks: checkNodes, pipeline_steps, coverage, hint_files: hintFiles });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleBlobRead(blobStore, url, res) {
  if (!blobStore) return sendJson(res, 503, { error: 'blob store not available' });
  const hash = url.searchParams.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return sendJson(res, 400, { error: 'hash must be a 64-char hex SHA256 string' });
  }
  const text = blobStore.getText(hash);
  if (text == null) return sendJson(res, 404, { error: 'blob not found' });
  return sendJson(res, 200, { text });
}

/**
 * GET /api/engine/impact
 *
 * Returns the adaptive-mode impact summary: what rules are currently
 * disabled/promoted/overridden, window-scoped emit counts and the split
 * between rules that *would* fire under static mode (currently disabled)
 * vs adaptive (currently firing). Payload is a merge of the live engine
 * state (not in the DB) and adaptiveModeImpact() (DB-derived window query).
 */
function handleEngineImpact(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const windowMs = parseInt(url.searchParams.get('window_ms') || String(86_400_000), 10);
    const impact = adaptiveModeImpact(analyticsStore, { windowMs });

    const disabled = getDisabledRuleDetails();
    const forceEnabled = [...getForceEnabledRules()];
    const forceDisabled = [...getForceDisabledRules()];

    // Counterfactual: sum window emits that hit currently-disabled rule_ids.
    // These are the diagnostics the operator would have seen under static
    // mode. A rule in force_enabled is disabled-by-data but running anyway,
    // so it still contributes to the adaptive view — exclude it from the
    // suppressed sum.
    let suppressed_by_disabled = 0;
    const per_rule_suppressed = {};
    for (const row of disabled) {
      if (row.force_enabled) continue;
      const hits = impact.emits_by_rule[row.rule_id] ?? 0;
      if (hits > 0) {
        suppressed_by_disabled += hits;
        per_rule_suppressed[row.rule_id] = hits;
      }
    }

    return sendJson(res, 200, {
      window: {
        ms: impact.window_ms,
        start: impact.window_start,
        end: impact.window_end,
      },
      emits_in_window: impact.emits_in_window,
      rule_matched_in_window: impact.rule_matched_in_window,
      confidence: impact.confidence,
      disabled_rules: disabled,
      force_enabled: forceEnabled,
      force_disabled: forceDisabled,
      counterfactual: {
        suppressed_by_disabled,
        per_rule_suppressed,
      },
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleRuleOverridesList(projectDir, res, log) {
  try {
    const state = loadOverrides(projectDir, { log });
    sendJson(res, 200, state);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

/**
 * POST /api/engine/rule-overrides
 *
 * Body: `{ action: 'force_enable' | 'force_disable' | 'clear', rule_id: string, reason?: string }`.
 *
 * clear → removes any override for the rule. The `onOverridesChanged` hook
 * re-reads the file into the engine and runs `syncDisabledRules` so the
 * effect is visible immediately without restart.
 */
function handleRuleOverridesMutate(projectDir, body, res, log, onOverridesChanged) {
  const { action, rule_id, reason } = body ?? {};
  if (!rule_id || typeof rule_id !== 'string') {
    return sendJson(res, 400, { error: 'rule_id required' });
  }
  try {
    let state;
    if (action === 'force_enable')       state = addForceEnable(projectDir, rule_id, reason ?? '', { log });
    else if (action === 'force_disable') state = addForceDisable(projectDir, rule_id, reason ?? '', { log });
    else if (action === 'clear')         state = removeOverride(projectDir, rule_id, { log });
    else return sendJson(res, 400, { error: 'action must be force_enable | force_disable | clear' });

    try { onOverridesChanged?.(); } catch (e) { log(`onOverridesChanged failed: ${e.message}`); }
    sendJson(res, 200, state);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
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

function handleAnalyticsRebuild(analyticsStore, sessionsDir, onAnalyticsRebuild, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  if (!sessionsDir) return sendJson(res, 400, { error: 'sessions dir not configured' });
  try {
    const result = analyticsStore.rebuild(sessionsDir);
    try { onAnalyticsRebuild?.(); } catch {}
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

function handleRuleScores(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const minEmitted = parseInt(url.searchParams.get('min_emitted') || '5', 10);
    const scores = ruleScores(analyticsStore, { minEmitted });
    sendJson(res, 200, { scores });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleRulePerformance(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const minEmitted = parseInt(url.searchParams.get('min_emitted') || '1', 10);
    const scores = rulePerformance(analyticsStore, { minEmitted });
    sendJson(res, 200, { scores });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleFixRulePerformance(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const minProposed = parseInt(url.searchParams.get('min_proposed') || '1', 10);
    const scores = fixRulePerformance(analyticsStore, { minProposed });
    sendJson(res, 200, { scores });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleRuleDrilldown(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const ruleId = url.searchParams.get('rule_id');
    if (!ruleId) return sendJson(res, 400, { error: 'rule_id parameter required' });
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
    const data = ruleDrilldown(analyticsStore, ruleId, { limit });
    sendJson(res, 200, data);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleSuggestedRules(analyticsStore, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const suggestions = suggestedRules(analyticsStore).map(s => {
      const guards = synthesizeGuardPredicate(analyticsStore, s.check, s.template_fp);
      return {
        ...s,
        when: guards,
        template: generateRuleTemplate(s, guards),
      };
    });
    sendJson(res, 200, { suggestions });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleCases(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const check = url.searchParams.get('check');
    if (!check) return sendJson(res, 400, { error: 'check parameter required' });
    const cases = retrieveCasesByCheck(analyticsStore, check, { minCases: 1 });
    sendJson(res, 200, { cases });
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
