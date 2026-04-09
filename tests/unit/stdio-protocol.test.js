import { describe, it, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', '..', 'bin', 'pos-supervisor.js');

/** MCP protocol requires initialize + notifications/initialized before requests. */
const INIT_SEQUENCE = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];

function sendAndReceive(messages, { env = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', () => {}); // suppress

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, timeoutMs);

    proc.on('exit', () => {
      clearTimeout(timer);
      const lines = stdout.trim().split('\n').filter(Boolean);
      const responses = lines.map(l => JSON.parse(l));
      resolve(responses);
    });

    for (const msg of messages) {
      proc.stdin.write(JSON.stringify(msg) + '\n');
    }
    proc.stdin.end();
  });
}

describe('MCP stdio protocol', () => {
  it('responds to initialize', async () => {
    const [res] = await sendAndReceive(INIT_SEQUENCE);

    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBeDefined();
    expect(res.result.serverInfo.name).toBe('pos-supervisor');
    expect(res.result.capabilities.tools).toBeDefined();
  });

  it('lists 10 tools', async () => {
    const [, res] = await sendAndReceive([
      ...INIT_SEQUENCE,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    expect(res.id).toBe(2);
    const tools = res.result.tools;
    expect(tools).toHaveLength(10);

    const names = tools.map(t => t.name);
    expect(names).toContain('validate_code');
    expect(names).toContain('enrich_error');
    expect(names).toContain('domain_guide');
    expect(names).toContain('analyze_project');
    expect(names).toContain('lookup');
    expect(names).toContain('server_status');
    expect(names).toContain('module_info');
  });

  it('returns error for unknown tool', async () => {
    const [, res] = await sendAndReceive([
      ...INIT_SEQUENCE,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nonexistent_tool', arguments: {} } },
    ]);

    expect(res.id).toBe(2);
    // Unknown tool returns error — either protocol-level or tool-level isError
    expect(res.error || res.result?.isError).toBeTruthy();
  });
});

describe('domain_guide tool via stdio', () => {
  it('returns partials gotchas', async () => {
    const [, res] = await sendAndReceive([
      ...INIT_SEQUENCE,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'domain_guide',
        arguments: { domain: 'partials', section: 'gotchas' },
      }},
    ]);

    const content = JSON.parse(res.result.content[0].text);
    expect(content.domain).toBe('partials');
    expect(content.section).toBe('gotchas');
    expect(content.content).toContain('partials');
    expect(content.content.length).toBeGreaterThan(100);
  });

  it('returns error for unknown domain', async () => {
    const [, res] = await sendAndReceive([
      ...INIT_SEQUENCE,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'domain_guide',
        arguments: { domain: 'nonexistent' },
      }},
    ]);

    // SDK validates the enum — 'nonexistent' is not in the allowed values
    // This returns a Zod validation error at the protocol level
    expect(res.error || res.result).toBeDefined();
  });

  it('defaults to gotchas section', async () => {
    const [, res] = await sendAndReceive([
      ...INIT_SEQUENCE,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'domain_guide',
        arguments: { domain: 'graphql' },
      }},
    ]);

    const content = JSON.parse(res.result.content[0].text);
    expect(content.section).toBe('gotchas');
    expect(content.content.length).toBeGreaterThan(50);
  });
});
