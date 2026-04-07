import { describe, it, expect, setDefaultTimeout } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

setDefaultTimeout(30_000);

const BIN = join(import.meta.dir, '..', '..', 'bin', 'pos-supervisor.js');

function callTool(name, args = {}, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, POS_SUPERVISOR_PROJECT_DIR: process.cwd() },
    });

    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', () => {});

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, timeoutMs);

    proc.on('exit', () => {
      clearTimeout(timer);
      const lines = stdout.trim().split('\n').filter(Boolean);
      try {
        const last = JSON.parse(lines[lines.length - 1]);
        const content = JSON.parse(last.result.content[0].text);
        resolve(content);
      } catch (e) {
        reject(new Error(`Failed to parse response: ${e.message}\nOutput: ${stdout.slice(0, 500)}`));
      }
    });

    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name, arguments: args },
    }) + '\n');
    proc.stdin.end();
  });
}

describe('server_status tool', () => {
  it('returns server info and component status', async () => {
    const result = await callTool('server_status');

    expect(result.server).toBe('pos-supervisor');
    expect(result.version).toBe('0.2.0');
    expect(result.project_dir).toBeDefined();
    expect(typeof result.pos_cli.found).toBe('boolean');
    expect(typeof result.lsp.initialized).toBe('boolean');
    expect(typeof result.indexes.schema).toBe('boolean');
    expect(typeof result.indexes.objects).toBe('boolean');
    expect(typeof result.indexes.filters).toBe('boolean');
    expect(typeof result.indexes.tags).toBe('boolean');
  });
});

describe('input validation', () => {
  it('validate_code rejects missing file_path', async () => {
    const result = await callTool('validate_code', { content: 'hello' });
    expect(result.status).toBe('error');
    expect(result.errors[0].check).toBe('InputError');
  });

  it('validate_code rejects path traversal', async () => {
    const result = await callTool('validate_code', {
      file_path: '../../../etc/passwd',
      content: 'hello',
    });
    expect(result.status).toBe('error');
    expect(result.errors[0].check).toBe('InputError');
    expect(result.errors[0].message).toContain('within the project directory');
  });

  it('enrich_error rejects missing check_name', async () => {
    const result = await callTool('enrich_error', {
      file_path: 'app/views/pages/test.liquid',
      error_message: 'test error',
    });
    expect(result.error).toContain('check_name');
  });

  it('lookup rejects missing mode', async () => {
    const result = await callTool('lookup', {
      file_path: 'app/views/pages/test.liquid',
    });
    expect(result.error).toContain('mode');
  });

  it('analyze_project with empty files scans app/ directory', async () => {
    const result = await callTool('analyze_project', { files: [] });
    // Test fixture has no app/ dir, so it falls back to scanning error
    expect(result.error).toContain('app/');
  });
});
