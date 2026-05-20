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
import { withCheckLabels, withRuleLabels, ruleLabel } from './core/analytics-labels.js';
import { addPromotedRule, removePromotedRule, listPromotedRules } from './core/rules/promoted-rules.js';
import { reloadRules, loadAllRules } from './core/rules/index.js';
import { runRules, getDisabledRules, getAllChecksWithRules, getRulesForCheck, getDisabledRuleDetails, getForceEnabledRules, getForceDisabledRules } from './core/rules/engine.js';
import { loadOverrides, addForceEnable, addForceDisable, removeOverride } from './core/rule-overrides.js';
import { loadCacConfig, updateCacConfig, defaultCacConfig, VALID_MODES, VALID_ACTIONS } from './core/cac-config.js';
import { getRecentCacDecisions } from './core/cac-predictor.js';
import { extractParams, templateOf, KNOWN_EXTRACTOR_CHECKS } from './core/diagnostic-record.js';
import { buildFactGraph } from './core/project-fact-graph.js';

/**
 * HTTP server — REST endpoints for tool discovery, execution, and resources.
 * MCP protocol (JSON-RPC over stdio) is handled by the SDK transport in server.js.
 */
export function startHttp(registry, { port, log, version, logPath, getStatus, restartLsp, dataRoot, subscribeToEvents, posCliPath, nodeBin, projectDir, sessionsDir, saveSessionSummary, analyticsStore, blobStore, onAnalyticsRebuild, onOverridesChanged, onCacConfigChanged, switchEngineMode, getEngineMode }) {
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

      if (url.pathname === '/api/analytics/baseline') {
        return handleAnalyticsBaselineSet(analyticsStore, body, res);
      }

      if (url.pathname === '/api/pos-cli/data-clean') {
        return handlePosCliCommand(posCliPath, nodeBin, projectDir, body, 'data-clean', log, res);
      }

      if (url.pathname === '/api/pos-cli/deploy') {
        return handlePosCliCommand(posCliPath, nodeBin, projectDir, body, 'deploy', log, res);
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

      if (url.pathname === '/api/cac/config') {
        return handleCacConfigMutate(projectDir, body, res, log, onCacConfigChanged);
      }
    }

    // ── Analytics GET routes ──────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/api/analytics/stats') {
      if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
      return sendJson(res, 200, analyticsStore.stats());
    }

    if (method === 'GET' && url.pathname === '/api/analytics/baseline') {
      return handleAnalyticsBaselineGet(analyticsStore, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/scorecards') {
      return handleAnalyticsScorecards(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/sessions') {
      return handleAnalyticsSessions(analyticsStore, url, res);
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
      return handleSuggestedRules(analyticsStore, url, res);
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
      return handleFixAdoptionFunnel(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/knowledge-gaps') {
      return handleKnowledgeGaps(analyticsStore, url, res);
    }

    if (method === 'GET' && url.pathname === '/api/analytics/rule-heatmap') {
      return handleRuleHeatmap(analyticsStore, url, res);
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

    if (method === 'GET' && url.pathname === '/api/cac/config') {
      return handleCacConfigGet(projectDir, res, log);
    }

    if (method === 'GET' && url.pathname === '/api/cac/decisions') {
      return handleCacDecisions(url, res);
    }
    // POST /api/cac/config is dispatched inside the POST block above.

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

function handlePosCliCommand(posCliPath, nodeBin, projectDir, body, command, log, res) {
  if (!posCliPath) return sendJson(res, 503, { error: 'pos-cli not found' });
  if (!nodeBin) return sendJson(res, 503, { error: 'Node.js interpreter not found' });
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

  const child = spawn(nodeBin, [posCliPath, ...args], {
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
    // Hint filenames are bare check names (no `pos-supervisor:` prefix) — see
    // src/core/hint-loader.js. Strip the prefix when resolving the file path
    // so canonical check IDs still hit the corresponding md.
    const fileBase = name.replace(/^pos-supervisor:/, '');
    const file = join(hintsDir, `${fileBase}.md`);
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
  const ruleSet = new Set(ruleNames);
  // Canonicalize: when a rule registers under `pos-supervisor:<X>` and the
  // hint filename is bare `<X>.md`, surface the static entry under the
  // canonical (prefixed) name so the dedup at line 476 merges both sources.
  const canonicalStaticNames = staticNames.map(n => {
    const prefixed = `pos-supervisor:${n}`;
    return ruleSet.has(prefixed) ? prefixed : n;
  });
  const staticSet = new Set(canonicalStaticNames);
  const all = Array.from(new Set([...canonicalStaticNames, ...ruleNames])).sort();
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
  try {
    const since = parseSinceParam(url);
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
    const journey = diagnosticJourney(analyticsStore, templateFp, { since });
    sendJson(res, 200, { ...journey, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleConfidenceCalibration(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const buckets = parseInt(url.searchParams.get('buckets') || '10', 10);
    const calibration = confidenceCalibration(analyticsStore, {
      buckets: Math.min(Math.max(buckets, 2), 20),
      since,
    });
    sendJson(res, 200, { calibration, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleFixAdoptionFunnel(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const funnel = fixAdoptionFunnel(analyticsStore, { since });
    sendJson(res, 200, { ...funnel, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleKnowledgeGaps(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const gaps = knowledgeGaps(analyticsStore, { since });
    sendJson(res, 200, { gaps, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleRuleHeatmap(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const cells = ruleScoresByCategory(analyticsStore, { since });
    sendJson(res, 200, { cells, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
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

// ── Rule source-location index ───────────────────────────────────────────
//
// Maps rule_id → { file, line } by statically scanning every rule module's
// source for `id: 'X'` and `rule_id: 'X'` literals. Built lazily once per
// server process; reset by `resetRuleSourceIndex()` from tests so a test that
// adds rules can re-resolve.
//
// Template-literal id forms (e.g. DeprecatedTag's `id: \`${prefix(c)}.X\``)
// can't be resolved to a line number statically, so they fall back to a
// "first-segment guess" — `<First>.js` if it exists. The clickable link
// degrades from file:line to file-only in that case.
let _ruleSourceIndex = null;

export function resetRuleSourceIndex() { _ruleSourceIndex = null; }

function buildRuleSourceIndex() {
  const index = new Map();
  const dir = join(__dirname, 'core', 'rules');
  if (!existsSync(dir)) return index;

  const ID_PATTERN = /(?:^|[\s,])(?:id|rule_id):\s*['"]([\w.\-:]+)['"]/;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const abs = join(dir, file);
    let src;
    try { src = readFileSync(abs, 'utf8'); }
    catch { continue; }

    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(ID_PATTERN);
      if (!m) continue;
      // First occurrence wins — typically the registration line precedes any
      // re-emit inside `apply()`, which is the canonical location.
      if (!index.has(m[1])) {
        index.set(m[1], { file: `src/core/rules/${file}`, line: i + 1 });
      }
    }
  }
  return index;
}

function getRuleSource(ruleId) {
  if (!_ruleSourceIndex) _ruleSourceIndex = buildRuleSourceIndex();
  const hit = _ruleSourceIndex.get(ruleId);
  if (hit) return hit;

  // Template-literal fallback: the rule id was constructed dynamically (e.g.
  // DeprecatedTag's `${prefix}.include`). Guess the file from the first dotted
  // segment. Returns just `{ file, line: null }` so the inspector renders a
  // file link without a line anchor.
  const first = ruleId.split('.')[0];
  if (!first) return null;
  const guessAbs = join(__dirname, 'core', 'rules', `${first}.js`);
  if (existsSync(guessAbs)) {
    return { file: `src/core/rules/${first}.js`, line: null };
  }
  return null;
}

// ── /api/engine-map ─────────────────────────────────────────────────────
//
// Returns the structured rule-engine view consumed by the dashboard. The
// payload is intentionally rich — every field below is something the
// inspector / topology / dependency matrix renders directly without a
// follow-up HTTP call.
//
// Per-rule fields:
//   id, check (one of the checks this entry is registered against),
//   checks[]    — every check name this rule_id is registered against. The
//                 topology dedupes nodes by id and uses this to draw N links
//                 when a rule serves multiple checks (e.g. DeprecatedTag).
//   priority, needs[], graph_queries[],
//   disabled    — true iff the engine's `_disabledRules` set contains this id,
//   override    — { kind, reason }: kind ∈ 'auto_disabled' | 'force_enabled'
//                 | 'force_disabled' | null. Surfaces operator overrides as
//                 first-class state instead of buried analytics.
//   source      — { file, line | null }: clickable to the rule's definition.
//   score       — case-base aggregates extended with adoption_rate and label.
//
// Per-check fields:
//   total_emits     — sum of emits across this check's rules (for ordering
//                     and at-a-glance volume).
//   unmatched_count — emits stamped `<check>.unmatched`. The single biggest
//                     improvement signal for adding new rules.
//   matched_count   — emits routed to a real rule_id. matched + unmatched
//                     = total_emits.
//   source_files    — every rule module that registers a rule for this check
//                     (usually one, multi-check modules like DeprecatedTag
//                     register the same file for both their checks).
//   metadata_file   — `src/data/checks/<Check>.yml` if present.
//   hint_files      — full hint markdown filenames + base check + variant
//                     flag, replacing the older string-only `hints` field.
function handleEngineMap(analyticsStore, res) {
  try {
    loadAllRules();
    const checks = getAllChecksWithRules();
    const disabledSet = getDisabledRules();
    const disabledDetails = new Map(getDisabledRuleDetails().map(d => [d.rule_id, d]));
    const forceEnabled = getForceEnabledRules();
    const forceDisabled = getForceDisabledRules();

    const extractorChecks = [...KNOWN_EXTRACTOR_CHECKS];

    // Hint files index. We carry the base_check + is_variant flags so the
    // dashboard can filter by either the base check (`MissingPartial`) or a
    // variant suffix (`MissingPartial-invalid_lib_prefix`).
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

    // Check metadata YAML. One file per check name; not every check has one.
    const checkMetaDir = join(__dirname, 'data', 'checks');
    const checkMetaPresent = new Set();
    if (existsSync(checkMetaDir)) {
      for (const f of readdirSync(checkMetaDir)) {
        if (f.endsWith('.yml')) checkMetaPresent.add(f.replace(/\.yml$/, ''));
      }
    }

    // Case-base scores keyed by rule_id. Without analytics this is empty
    // (every rule node renders with score: null, label: 'INSUFFICIENT_DATA').
    let scores = [];
    if (analyticsStore) {
      try { scores = ruleScores(analyticsStore, { minEmitted: 1 }); } catch { /* no data yet */ }
    }
    const scoreMap = new Map(scores.map(s => [s.rule_id, s]));

    // Inverse index: rule_id → list of checks it's registered against. This
    // is the data that fixes the topology dedup bug — when a single rule_id
    // is bound to two checks (DeprecatedTag pattern), the inspector lists
    // both and the topology draws one node + two edges.
    const checksByRuleId = new Map();
    for (const check of checks) {
      for (const r of getRulesForCheck(check)) {
        if (!checksByRuleId.has(r.id)) checksByRuleId.set(r.id, []);
        checksByRuleId.get(r.id).push(check);
      }
    }

    // Per-check emit totals (matched vs unmatched). Populated only when an
    // analytics store is available; otherwise both counts are 0.
    const checkEmitTotals = new Map();      // checkName → total_emits
    const checkUnmatched = new Map();       // checkName → unmatched_count
    if (analyticsStore) {
      try {
        const rows = analyticsStore.query(`
          SELECT check_name, hint_rule_id, COUNT(*) as cnt
          FROM diagnostics
          WHERE suppressed = 0
          GROUP BY check_name, hint_rule_id
        `, []);
        for (const row of rows) {
          const total = checkEmitTotals.get(row.check_name) ?? 0;
          checkEmitTotals.set(row.check_name, total + row.cnt);
          if (row.hint_rule_id && row.hint_rule_id.endsWith('.unmatched')) {
            const u = checkUnmatched.get(row.check_name) ?? 0;
            checkUnmatched.set(row.check_name, u + row.cnt);
          }
        }
      } catch { /* analytics queries fail on an empty/locked DB — degrade */ }
    }

    function buildOverrideField(ruleId) {
      // Force-disable wins over everything (operator kill-switch). Then
      // force-enable (operator says "run even though analytics disabled it").
      // Then the case-base auto-disable. Then null.
      if (forceDisabled.has(ruleId)) {
        return { kind: 'force_disabled', reason: 'Operator override (force-disable).' };
      }
      if (forceEnabled.has(ruleId)) {
        const detail = disabledDetails.get(ruleId);
        const reason = detail
          ? `Operator override running a rule the case base auto-disabled (effectiveness ${(detail.effectiveness * 100).toFixed(0)}%, n=${detail.total_outcomes ?? 0}).`
          : 'Operator override (force-enable).';
        return { kind: 'force_enabled', reason };
      }
      const detail = disabledDetails.get(ruleId);
      if (detail) {
        const eff = Number.isFinite(detail.effectiveness) ? `${(detail.effectiveness * 100).toFixed(0)}%` : 'low';
        const n = detail.total_outcomes ?? 0;
        return {
          kind: 'auto_disabled',
          reason: `Case base auto-disabled — effectiveness ${eff} on n=${n} outcomes.`,
        };
      }
      return null;
    }

    function buildScoreField(score) {
      if (!score) return null;
      const adoptionRate = Number.isFinite(score.adoption_rate) ? score.adoption_rate : 0;
      const total_outcomes = score.total_outcomes ?? 0;
      // ruleLabel takes a rule-shape with .effectiveness / .total_outcomes /
      // .unmatched. Force false here — `<check>.unmatched` rule_ids have
      // their own label path computed downstream by the check node, never
      // by per-rule scoring.
      const label = ruleLabel({ effectiveness: score.effectiveness, total_outcomes, unmatched: false });
      return {
        emitted: score.emitted,
        resolved: score.resolved,
        regressed: score.regressed,
        unchanged: score.unchanged ?? 0,
        moved: score.moved ?? 0,
        adopted: score.adopted ?? 0,
        total_outcomes,
        resolution_rate: score.resolution_rate,
        regression_rate: score.regression_rate,
        adoption_rate: adoptionRate,
        effectiveness: score.effectiveness,
        label,
        disabled: score.disabled,
      };
    }

    const checkNodes = checks.map(check => {
      const rules = getRulesForCheck(check);
      const hasExtractor = extractorChecks.includes(check);
      const hints = hintFiles.filter(h => h.base_check === check);

      const ruleNodes = rules.map(r => {
        const deps = RULE_DEPS[r.id] || { needs: ['params'], graph_queries: [] };
        const score = scoreMap.get(r.id);
        const sourceLoc = getRuleSource(r.id);
        const allChecksForRule = checksByRuleId.get(r.id) ?? [check];
        return {
          id: r.id,
          check,                              // legacy field — preserved
          checks: allChecksForRule,           // NEW — every check this rule serves
          priority: r.priority,
          needs: deps.needs,
          graph_queries: deps.graph_queries,
          disabled: disabledSet.has(r.id),
          override: buildOverrideField(r.id),
          source: sourceLoc,
          score: buildScoreField(score),
        };
      });

      // Source files for this check: the unique set of rule modules that
      // register against it. Almost always one, but multi-check rule modules
      // (DeprecatedTag) lift this to N.
      const sourceFiles = [...new Set(
        ruleNodes
          .map(r => r.source?.file)
          .filter(Boolean),
      )];

      const totalEmits = checkEmitTotals.get(check) ?? 0;
      const unmatchedCount = checkUnmatched.get(check) ?? 0;

      return {
        check,
        has_extractor: hasExtractor,
        example_message: CHECK_EXAMPLES[check] || null,
        hints: hints.map(h => h.name),               // legacy — names only
        hint_files: hints,                           // NEW — full descriptors
        rules: ruleNodes,
        total_emits: totalEmits,
        unmatched_count: unmatchedCount,
        matched_count: Math.max(0, totalEmits - unmatchedCount),
        source_files: sourceFiles,
        metadata_file: checkMetaPresent.has(check)
          ? `src/data/checks/${check}.yml`
          : null,
      };
    });

    // Pipeline step descriptors. The dashboard renders a card per step; the
    // legacy string-only API is preserved as `pipeline_steps`, the richer
    // descriptor list is `pipeline` for the new card view.
    const pipeline_steps = [
      'LSP Diagnostics',
      'Structural Warnings',
      'Diagnostic Pipeline',
      'Rule Engine',
      'Error Enricher',
      'Fix Generator',
      'Scorecard',
    ];

    const pipeline = [
      {
        ord: 1,
        name: 'LSP Diagnostics',
        purpose: 'Ask pos-cli LSP for raw diagnostics on the open document. Falls back to pos-cli check run if the LSP is down.',
        source_file: 'src/core/lsp-client.js',
      },
      {
        ord: 2,
        name: 'Structural Warnings',
        purpose: 'AST-level checks the LSP does not provide (Shopify-object detection, GraphQL-in-partials, HTML-in-page, missing doc blocks).',
        source_file: 'src/core/structural-warnings.js',
      },
      {
        ord: 3,
        name: 'Diagnostic Pipeline',
        purpose: '17-step ordered post-processor: known-LSP-FP suppression, doc-param suppression, Shopify elevation, dedup, undocumented-target suppression, default-param suppression, module-helper suppression, orphan-partial suppression, pending-plan suppression (3 kinds), and disk-verification (4 kinds).',
        source_file: 'src/core/diagnostic-pipeline.js',
      },
      {
        ord: 4,
        name: 'Rule Engine',
        purpose: 'First-match-wins rule dispatch keyed by check name. Each match attaches hint, fixes, confidence, see-also, and (in adaptive mode) a case-base confidence adjustment.',
        source_file: 'src/core/rules/engine.js',
      },
      {
        ord: 5,
        name: 'Error Enricher',
        purpose: 'Fallback for checks without rule modules. Regex-extracts symbols from the LSP message and renders src/data/hints/<Check>.md templates.',
        source_file: 'src/core/error-enricher.js',
      },
      {
        ord: 6,
        name: 'Fix Generator',
        purpose: 'Materialises proposed_fixes for diagnostic shapes the rule layer cannot produce text edits for (insert, create_file, range-typed text_edit on parsed AST nodes).',
        source_file: 'src/core/fix-generator.js',
      },
      {
        ord: 7,
        name: 'Scorecard',
        purpose: 'Architectural quality score across doc-block coverage, layout correctness, slug formatting, etc. Stored on the response and surfaced under `scorecard:` for full mode.',
        source_file: 'src/core/fix-generator.js',
      },
    ];

    const coverage = {
      checks_with_rules: checks.length,
      checks_with_extractors: extractorChecks.length,
      total_rules: checks.reduce((n, c) => n + getRulesForCheck(c).length, 0),
      total_hints: hintFiles.length,
      disabled_rules: disabledSet.size,
      force_enabled_rules: forceEnabled.size,
      force_disabled_rules: forceDisabled.size,
      rules_needing_graph: Object.values(RULE_DEPS).filter(d => d.needs.includes('graph')).length,
      rules_needing_indexes: Object.values(RULE_DEPS).filter(d => d.needs.includes('filtersIndex') || d.needs.includes('objectsIndex') || d.needs.includes('tagsIndex')).length,
      rules_params_only: Object.values(RULE_DEPS).filter(d => d.needs.length === 1 && d.needs[0] === 'params').length,
    };

    sendJson(res, 200, {
      checks: checkNodes,
      pipeline_steps,                  // legacy
      pipeline,                        // NEW — rich descriptors
      coverage,
      hint_files: hintFiles,
    });
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

// ── CAC predictor (Cohen's Agentic Conjecture) ───────────────────────────
//
// Opt-in 4th gating axis. The validator behaves identically to a build
// without the predictor when `enabled: false`. These endpoints expose the
// persisted config + recent decision telemetry to the dashboard.

function handleCacConfigGet(projectDir, res, log) {
  try {
    const state = loadCacConfig(projectDir, { log });
    sendJson(res, 200, {
      config: state,
      defaults: defaultCacConfig(),
      valid_modes: VALID_MODES,
      valid_actions: VALID_ACTIONS,
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

/**
 * POST /api/cac/config
 *
 * Body: any subset of `{ enabled, mode, threshold, action, min_samples }`.
 * Unknown keys are dropped; out-of-range values are coerced to defaults.
 * The `onCacConfigChanged` hook re-reads the file into the live ref so the
 * change takes effect immediately for in-flight validate_code calls
 * (without requiring a server restart).
 */
function handleCacConfigMutate(projectDir, body, res, log, onCacConfigChanged) {
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, { error: 'body required' });
  }
  try {
    const state = updateCacConfig(projectDir, body, { log });
    try { onCacConfigChanged?.(); } catch (e) { log?.(`onCacConfigChanged failed: ${e.message}`); }
    sendJson(res, 200, { config: state });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleCacDecisions(url, res) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 200, 50);
  try {
    const decisions = getRecentCacDecisions(limit);
    sendJson(res, 200, {
      count: decisions.length,
      decisions,
      summary: summarizeCacDecisions(decisions),
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function summarizeCacDecisions(decisions) {
  const out = { allow: 0, downgrade: 0, suppress: 0, by_feature: {}, by_mode: {} };
  for (const d of decisions) {
    const dec = d.decision || 'allow';
    out[dec] = (out[dec] ?? 0) + 1;
    out.by_feature[d.feature] = (out.by_feature[d.feature] ?? 0) + 1;
    out.by_mode[d.mode] = (out.by_mode[d.mode] ?? 0) + 1;
  }
  return out;
}

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
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

/**
 * Parse the `since` query parameter into the value the analytics-queries +
 * case-base reporting paths accept:
 *
 *   - `?since=all`            → null  (explicit bypass — operator clicked
 *                                       "All time" in the dashboard)
 *   - `?since=ISO`            → string (explicit override)
 *   - `?since` absent / empty → undefined (function looks up meta baseline)
 *
 * Validates the ISO string by attempting Date parse; rejects with a thrown
 * Error so the surrounding try/catch returns 400. Strict validation is the
 * point — silently accepting garbage means an operator typing a bad date
 * sees stats they don't expect with no error.
 *
 * Exported so unit tests can pin the parsing contract without spinning up
 * the HTTP server. (Server startup uses bun:sqlite via analytics-store,
 * which fails under integration tests that spawn `node bin/...`.)
 */
export function parseSinceParam(url) {
  const raw = url.searchParams.get('since');
  if (raw == null || raw === '') return undefined;
  if (raw === 'all') return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`since must be 'all' or a valid ISO timestamp; got '${raw}'`);
  }
  return raw;
}

function handleAnalyticsBaselineGet(analyticsStore, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    sendJson(res, 200, analyticsStore.getBaselineMeta());
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function handleAnalyticsBaselineSet(analyticsStore, body, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    // Body shape: { baseline_ts: ISO } to set, { baseline_ts: null } to clear.
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'request body must be an object' });
    }
    if (!('baseline_ts' in body)) {
      return sendJson(res, 400, { error: 'missing required field: baseline_ts (ISO string or null)' });
    }
    analyticsStore.setBaselineTs(body.baseline_ts);
    sendJson(res, 200, { ok: true, ...analyticsStore.getBaselineMeta() });
  } catch (e) {
    // setBaselineTs throws TypeError on invalid input — surface as 400.
    const status = e instanceof TypeError ? 400 : 500;
    sendJson(res, status, { error: e.message });
  }
}

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
    const since = parseSinceParam(url);
    const sessionId = url.searchParams.get('session_id') || undefined;
    const minCohort = parseInt(url.searchParams.get('min_cohort') || '10', 10);
    const cards = checkScorecards(analyticsStore, { sessionId, minCohort, since });
    sendJson(res, 200, { scorecards: withCheckLabels(cards), since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleAnalyticsSessions(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const summaries = sessionSummaries(analyticsStore, { since });
    sendJson(res, 200, { sessions: summaries, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleAnalyticsRecommendations(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const threshold = parseFloat(url.searchParams.get('threshold') || '0.3');
    const recs = recommendations(analyticsStore, threshold, { since });
    sendJson(res, 200, { recommendations: recs, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleAnalyticsBigrams(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const sessionId = url.searchParams.get('session_id') || undefined;
    const bigrams = toolSequenceBigrams(analyticsStore, { sessionId, since });
    sendJson(res, 200, { bigrams, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleRuleScores(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const minEmitted = parseInt(url.searchParams.get('min_emitted') || '5', 10);
    const scores = ruleScores(analyticsStore, { minEmitted, since });
    sendJson(res, 200, { scores: withRuleLabels(scores), since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleRulePerformance(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const minEmitted = parseInt(url.searchParams.get('min_emitted') || '1', 10);
    const scores = rulePerformance(analyticsStore, { minEmitted, since });
    sendJson(res, 200, { scores: withRuleLabels(scores), since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleFixRulePerformance(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const minProposed = parseInt(url.searchParams.get('min_proposed') || '1', 10);
    const scores = fixRulePerformance(analyticsStore, { minProposed, since });
    sendJson(res, 200, { scores, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleRuleDrilldown(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const ruleId = url.searchParams.get('rule_id');
    if (!ruleId) return sendJson(res, 400, { error: 'rule_id parameter required' });
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
    const data = ruleDrilldown(analyticsStore, ruleId, { limit, since });
    sendJson(res, 200, { ...data, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleSuggestedRules(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const suggestions = suggestedRules(analyticsStore, new Set(), { since }).map(s => {
      // Forward the same since to guard synthesis so the inferred guard
      // window matches the suggestion window.
      const guards = synthesizeGuardPredicate(analyticsStore, s.check, s.template_fp, { since });
      return {
        ...s,
        when: guards,
        template: generateRuleTemplate(s, guards),
      };
    });
    sendJson(res, 200, { suggestions, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

function handleCases(analyticsStore, url, res) {
  if (!analyticsStore) return sendJson(res, 503, { error: 'analytics store not available' });
  try {
    const since = parseSinceParam(url);
    const check = url.searchParams.get('check');
    if (!check) return sendJson(res, 400, { error: 'check parameter required' });
    const cases = retrieveCasesByCheck(analyticsStore, check, { minCases: 1, since });
    sendJson(res, 200, { cases, since: resolvedSinceForResponse(analyticsStore, since) });
  } catch (e) {
    sendJson(res, sinceErrorStatus(e), { error: e.message });
  }
}

/**
 * Surface what the queries actually filtered by. When `since` was undefined
 * (meta default), this returns the meta value so the dashboard can show a
 * "Stats since: <ISO>" banner without a separate round-trip. When the
 * caller explicitly passed `?since=all`, returns null. Tolerates errors so
 * a missing baseline meta column never breaks the analytics response.
 */
function resolvedSinceForResponse(store, sinceArg) {
  if (sinceArg === null) return null;
  if (typeof sinceArg === 'string') return sinceArg;
  try {
    return store.getBaselineTs?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * `parseSinceParam` throws on a malformed `since` query param; surface as
 * 400 (client error). Anything else propagates the existing 500 path.
 */
function sinceErrorStatus(err) {
  if (err && typeof err.message === 'string' && err.message.includes("since must be")) return 400;
  return 500;
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
