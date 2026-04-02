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

    // Send initialize on stdin so stdio server doesn't block
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');

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
    expect(body.version).toBe('0.2.0');
  });

  it('GET /tools returns 9 tools', async () => {
    const { status, body } = await httpGet('/tools');
    expect(status).toBe(200);
    expect(body.tools).toHaveLength(10);

    const names = body.tools.map(t => t.name);
    expect(names).toContain('validate_code');
    expect(names).toContain('enrich_error');
    expect(names).toContain('domain_guide');
    expect(names).toContain('analyze_project');
    expect(names).toContain('lookup');
    expect(names).toContain('server_status');
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

describe('HTTP POST /mcp (JSON-RPC 2.0)', () => {
  it('handles initialize', async () => {
    const { status, body } = await httpPost('/mcp', {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    });

    expect(status).toBe(200);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('pos-supervisor');
  });

  it('handles tools/list', async () => {
    const { status, body } = await httpPost('/mcp', {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });

    expect(status).toBe(200);
    expect(body.result.tools).toHaveLength(10);
  });

  it('handles tools/call', async () => {
    const { status, body } = await httpPost('/mcp', {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'domain_guide', arguments: { domain: 'graphql', section: 'gotchas' } },
    });

    expect(status).toBe(200);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(3);
    const content = JSON.parse(body.result.content[0].text);
    expect(content.domain).toBe('graphql');
  });

  it('returns error for unknown method', async () => {
    const { status, body } = await httpPost('/mcp', {
      jsonrpc: '2.0', id: 4, method: 'nonexistent', params: {},
    });

    expect(status).toBe(200); // JSON-RPC errors are 200 with error field
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('Method not found');
  });

  it('returns error for unknown tool in tools/call', async () => {
    const { status, body } = await httpPost('/mcp', {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'fake_tool', arguments: {} },
    });

    expect(status).toBe(200);
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toContain('Unknown tool');
  });
});
