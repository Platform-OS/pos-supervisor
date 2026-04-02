import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from './helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describe('validate_intent — generation_context on success', () => {
  it('includes generation_context for create actions', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add search page',
        changes: [
          {
            path: 'app/views/pages/blog_posts/search.html.liquid',
            role: 'page',
            action: 'create',
            references: { partials: ['blog_posts/search_form'] },
          },
          {
            path: 'app/views/partials/blog_posts/search_form.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.generation_context).toBeDefined();
    // Each create action should have a generation_context entry
    expect(result.generation_context['app/views/pages/blog_posts/search.html.liquid']).toBeDefined();
    expect(result.generation_context['app/views/partials/blog_posts/search_form.liquid']).toBeDefined();
  });

  it('generation_context includes role', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add partial',
        changes: [{ path: 'app/views/partials/test_gc.liquid', role: 'partial', action: 'create' }],
      },
    });
    expect(result.ok).toBe(true);
    const ctx = result.generation_context['app/views/partials/test_gc.liquid'];
    expect(ctx.role).toBe('partial');
  });

  it('generation_context includes rules for the role', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add page',
        changes: [{ path: 'app/views/pages/test_gc.html.liquid', role: 'page', action: 'create' }],
      },
    });
    expect(result.ok).toBe(true);
    const ctx = result.generation_context['app/views/pages/test_gc.html.liquid'];
    expect(ctx.rules).toBeDefined();
    expect(ctx.rules.length).toBeGreaterThan(0);
  });

  it('generation_context includes available_partials for pages', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add page',
        changes: [{ path: 'app/views/pages/test_gc2.html.liquid', role: 'page', action: 'create' }],
      },
    });
    expect(result.ok).toBe(true);
    const ctx = result.generation_context['app/views/pages/test_gc2.html.liquid'];
    expect(ctx.available_partials).toBeDefined();
    expect(ctx.available_partials.length).toBeGreaterThan(0);
  });

  it('does not include generation_context for update actions', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Update existing page',
        changes: [{
          path: 'app/views/pages/blog_posts/index.html.liquid',
          role: 'page',
          action: 'update',
          references: { partials: ['blog_posts/list'] },
        }],
      },
    });
    expect(result.ok).toBe(true);
    // No generation_context for update-only plans (or empty)
    const gc = result.generation_context ?? {};
    expect(Object.keys(gc)).toHaveLength(0);
  });
});

describe('validate_intent — educational why field on failure', () => {
  it('missing_partial error includes why field', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Render nonexistent partial',
        changes: [{
          path: 'app/views/pages/blog_posts/index.html.liquid',
          role: 'page',
          action: 'update',
          references: { partials: ['nonexistent/widget'] },
        }],
      },
    });
    expect(result.ok).toBe(false);
    const missing = result.errors.find(e => e.type === 'missing_partial');
    expect(missing).toBeDefined();
    expect(missing.why).toBeDefined();
    expect(missing.why.length).toBeGreaterThan(20);
  });

  it('invalid_path_for_role error includes why field', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Wrong directory',
        changes: [{
          path: 'app/views/partials/wrong.liquid',
          role: 'page',
          action: 'create',
        }],
      },
    });
    expect(result.ok).toBe(false);
    const pathErr = result.errors.find(e => e.type === 'invalid_path_for_role');
    expect(pathErr).toBeDefined();
    expect(pathErr.why).toBeDefined();
    expect(pathErr.why).toContain('directory');
  });
});
