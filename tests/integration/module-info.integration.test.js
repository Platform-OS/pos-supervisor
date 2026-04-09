import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from './helpers/server.js';

setDefaultTimeout(30_000);

let server;

beforeAll(async () => {
  server = await startServer(FIXTURE_DIR);
});

afterAll(() => {
  server?.stop();
});

describe('module_info — list mode', () => {
  it('lists installed modules', async () => {
    const result = await server.callTool('module_info', {});
    expect(result.modules).toBeDefined();
    // modules is array of objects { name, display_name, version, ... }
    expect(result.modules.some(m => m.name === 'user')).toBe(true);
  });
});

describe('module_info — user module', () => {
  it('returns overview for user module', async () => {
    const result = await server.callTool('module_info', { name: 'user' });
    expect(result).toBeDefined();
    // Should have some API surface info
  });

  it('returns specific section', async () => {
    const result = await server.callTool('module_info', { name: 'user', section: 'gotchas' });
    expect(result).toBeDefined();
  });
});

describe('module_info — error handling', () => {
  it('returns error for non-existent module', async () => {
    const { status, body } = await server.callToolRaw('module_info', { name: 'nonexistent_module' });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBeDefined();
  });
});
