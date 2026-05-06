import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', '..', 'bin', 'pos-supervisor.js');
const HTTP_PORT = 13737; // Unlikely to conflict

let proc;
let ready = false;

/**
 * Start the MCP server with HTTP enabled and wait for it to be ready.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    proc = spawn('node', [BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        POS_SUPERVISOR_HTTP_PORT: String(HTTP_PORT),
        POS_SUPERVISOR_PROJECT_DIR: process.cwd(),
      },
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes('HTTP server listening') && !ready) {
        ready = true;
        resolve();
      }
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (!ready) reject(new Error(`Server exited with code ${code}\n${stderr}`));
    });

    // MCP protocol: initialize then notify initialized
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }) + '\n');
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    setTimeout(() => {
      if (!ready) reject(new Error(`Server didn't start within timeout\n${stderr}`));
    }, 15000);
  });
}

async function httpGet(path) {
  const res = await fetch(`http://localhost:${HTTP_PORT}${path}`);
  return { status: res.status, body: await res.json() };
}

async function httpPost(path, body) {
  const res = await fetch(`http://localhost:${HTTP_PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  await startServer();
});

afterAll(() => {
  if (proc) {
    proc.stdin.end();
    proc.kill('SIGTERM');
  }
});

describe('HTTP GET endpoints', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await httpGet('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.server).toBe('pos-supervisor');
    expect(body.version).toBeDefined();
  });

  it('GET /tools returns 11 tools', async () => {
    const { status, body } = await httpGet('/tools');
    expect(status).toBe(200);
    expect(body.tools).toHaveLength(11);

    const names = body.tools.map(t => t.name);
    expect(names).toContain('validate_code');
    expect(names).toContain('enrich_error');
    expect(names).toContain('domain_guide');
    expect(names).toContain('analyze_project');
    expect(names).toContain('lookup');
    expect(names).toContain('server_status');
    expect(names).toContain('load_development_guide');
  });
});

describe('HTTP GET /api/hints', () => {
  it('list mode returns both static md hints and rule-driven check names', async () => {
    const { status, body } = await httpGet('/api/hints');
    expect(status).toBe(200);
    expect(Array.isArray(body.hints)).toBe(true);
    expect(Array.isArray(body.checks)).toBe(true);

    // Legacy md hints — sample from src/data/hints/
    expect(body.hints).toContain('GraphQLCheck');
    // Rule-driven (no md file) — must be present after the fix.
    expect(body.hints).toContain('GraphQLVariablesCheck');
    expect(body.hints).toContain('PartialCallArguments');

    // Per-check sources metadata
    const gqlVars = body.checks.find(c => c.name === 'GraphQLVariablesCheck');
    expect(gqlVars).toBeDefined();
    expect(gqlVars.sources).toContain('rule');
    expect(gqlVars.sources).not.toContain('static');

    const gqlCheck = body.checks.find(c => c.name === 'GraphQLCheck');
    expect(gqlCheck).toBeDefined();
    expect(gqlCheck.sources).toContain('static');
  });

  it('GET ?name=<static-check> returns md content with source=static', async () => {
    const { status, body } = await httpGet('/api/hints?name=GraphQLCheck');
    expect(status).toBe(200);
    expect(body.name).toBe('GraphQLCheck');
    expect(body.source).toBe('static');
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(20);
  });

  // Repro for the dashboard 404 reported on 2026-04-28: rule-driven checks
  // had no md file, the endpoint 404'd, drilldown showed "Failed to load".
  it('GET ?name=GraphQLVariablesCheck synthesizes a rule doc instead of 404', async () => {
    const { status, body } = await httpGet('/api/hints?name=GraphQLVariablesCheck');
    expect(status).toBe(200);
    expect(body.name).toBe('GraphQLVariablesCheck');
    expect(body.source).toBe('rule');
    expect(Array.isArray(body.rule_ids)).toBe(true);
    // Sub-rule ids must be present in the synthesized doc.
    expect(body.rule_ids).toContain('GraphQLVariablesCheck.required');
    expect(body.rule_ids).toContain('GraphQLVariablesCheck.unknown');
    expect(body.rule_ids).toContain('GraphQLVariablesCheck.parser_blind_spot');
    expect(body.content).toContain('GraphQLVariablesCheck');
    expect(body.content).toContain('Rule-driven');
    expect(body.content).toContain('src/core/rules/GraphQLVariablesCheck.js');
    // Each sub-rule must be documented with priority + when() source.
    expect(body.content).toContain('parser_blind_spot');
    expect(body.content).toContain('priority');
  });

  it('GET ?name=<unknown> still 404s when neither md nor rule exists', async () => {
    const { status, body } = await httpGet('/api/hints?name=NoSuchCheckEverDefined');
    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('GET ?name=<pos-supervisor:Foo> resolves prefixed rule-driven checks', async () => {
    // pos-supervisor:InvalidLayout is registered with the prefix, has no md
    // file, and the dashboard splits on the first dot when computing
    // baseCheck — so the colon prefix must round-trip cleanly.
    const { status, body } = await httpGet(
      '/api/hints?name=' + encodeURIComponent('pos-supervisor:InvalidLayout')
    );
    expect(status).toBe(200);
    expect(body.source).toBe('rule');
    expect(body.name).toBe('pos-supervisor:InvalidLayout');
    // Module path strips the `pos-supervisor:` prefix when we point at the
    // file the developer must edit — the rule files are not namespaced.
    expect(body.content).toContain('src/core/rules/InvalidLayout.js');
  });

  it('GET ?name=<pos-supervisor:Foo> with both md and rule prefers static md', async () => {
    // pos-supervisor:NonGetRenderingPage has BOTH a md file and a rule
    // module. The endpoint must serve the md (legacy enricher path is what
    // agents actually consume) and the rule sub-rules remain reachable via
    // the per-check rule_ids list elsewhere in the dashboard.
    const { status, body } = await httpGet(
      '/api/hints?name=' + encodeURIComponent('pos-supervisor:NonGetRenderingPage')
    );
    expect(status).toBe(200);
    expect(body.source).toBe('static');
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(20);
  });
});

describe('HTTP POST /call', () => {
  it('executes domain_guide tool', async () => {
    const { status, body } = await httpPost('/call', {
      tool: 'domain_guide',
      params: { domain: 'partials', section: 'gotchas' },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    expect(body.result.domain).toBe('partials');
    expect(body.result.content.length).toBeGreaterThan(100);
  });

  it('accepts "name" alias for tool field', async () => {
    const { status, body } = await httpPost('/call', {
      name: 'domain_guide',
      params: { domain: 'pages' },
    });

    expect(status).toBe(200);
    expect(body.result.domain).toBe('pages');
  });

  it('returns 400 for missing tool name', async () => {
    const { status, body } = await httpPost('/call', { params: {} });
    expect(status).toBe(400);
    expect(body.error).toContain('Missing tool name');
  });

  it('returns 404 for unknown tool', async () => {
    const { status, body } = await httpPost('/call', {
      tool: 'nonexistent_tool',
      params: {},
    });
    expect(status).toBe(404);
    expect(body.error).toContain('Unknown tool');
  });
});
