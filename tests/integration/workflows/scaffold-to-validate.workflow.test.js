import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;

beforeAll(async () => {
  server = await startServer(FIXTURE_DIR);
});

afterAll(() => {
  server?.stop();
});

describe('scaffold → validate_intent → validate_code workflow', () => {
  it('scaffold output passes validate_intent', async () => {
    const scaffold = await server.callTool('scaffold', {
      type: 'query',
      name: 'featured_posts',
      properties: [{ name: 'limit', type: 'integer' }],
    });
    expect(scaffold.files.length).toBeGreaterThan(0);

    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);
    expect(intent.pending_files.length).toBeGreaterThan(0);
  });

  it('pending_files suppress false MissingPartial in validate_code', async () => {
    // Generate a command scaffold (simple type avoids config conflicts)
    const scaffold = await server.callTool('scaffold', {
      type: 'command',
      name: 'product_archive',
      properties: [{ name: 'archived_at', type: 'datetime' }],
    });

    // Get the pending_files from validate_intent
    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);
    expect(intent.pending_files.length).toBeGreaterThan(0);

    // Validate each liquid file with pending_files
    for (const file of scaffold.files) {
      if (file.path.endsWith('.liquid')) {
        const validation = await server.callTool('validate_code', {
          file_path: file.path,
          content: file.content,
          mode: 'quick',
          pending_files: intent.pending_files,
        });
        // MissingPartial errors for pending files should be suppressed
        const missingPartialErrors = (validation.errors ?? []).filter(e => e.check === 'MissingPartial');
        const pendingPartialNames = new Set(
          intent.pending_files.map(f => f.replace(/^app\/views\/partials\//, '').replace(/\.liquid$/, ''))
        );
        for (const err of missingPartialErrors) {
          const nameMatch = err.message?.match(/['"]([^'"]+)['"]/);
          if (nameMatch) {
            // Any remaining MissingPartial should NOT be for a pending file
            expect(pendingPartialNames.has(nameMatch[1])).toBe(false);
          }
        }
      }
    }
  });

  it('scaffold with conflicts still passes validate_intent when conflicts are reported', async () => {
    // blog_post already exists in fixture — scaffold should report conflicts
    const scaffold = await server.callTool('scaffold', {
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }],
    });
    expect(scaffold.conflicts.length).toBeGreaterThan(0);

    // validate_intent should report scaffold_conflict errors
    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(false);
    expect(intent.errors.some(e => e.type === 'scaffold_conflict')).toBe(true);
  });

  it('query scaffold files pass validate_code individually', async () => {
    const scaffold = await server.callTool('scaffold', {
      type: 'query',
      name: 'recent_posts',
      properties: [{ name: 'limit', type: 'integer' }],
    });

    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);

    // Validate each liquid file from the scaffold
    for (const file of scaffold.files) {
      if (file.path.endsWith('.liquid')) {
        const validation = await server.callTool('validate_code', {
          file_path: file.path,
          content: file.content,
          mode: 'quick',
          pending_files: intent.pending_files,
        });
        expect(validation.errors.length).toBe(0);
      }
    }
  });

  it('command scaffold → validate_intent → validate_code chain', async () => {
    const scaffold = await server.callTool('scaffold', {
      type: 'command',
      name: 'order_approve',
      properties: [{ name: 'approved_at', type: 'datetime' }],
    });
    expect(scaffold.files.length).toBeGreaterThanOrEqual(3);

    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);

    // Validate all liquid files
    for (const file of scaffold.files) {
      if (file.path.endsWith('.liquid')) {
        const validation = await server.callTool('validate_code', {
          file_path: file.path,
          content: file.content,
          mode: 'quick',
          pending_files: intent.pending_files,
        });
        expect(validation.errors.length).toBe(0);
      }
    }
  });
});
