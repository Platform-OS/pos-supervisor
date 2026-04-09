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

describe('validate_intent — valid plans', () => {
  it('accepts plan with existing references', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add tag filter to blog post index',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: {
              partials: ['blog_posts/list'],
            },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.pending_files).toBeDefined();
  });

  it('returns pending_files for all planned paths', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Create search page',
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
    expect(result.pending_files).toContain('app/views/pages/blog_posts/search.html.liquid');
    expect(result.pending_files).toContain('app/views/partials/blog_posts/search_form.liquid');
  });
});

describe('validate_intent — error detection', () => {
  it('catches missing partial not in plan', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Render new sidebar',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/sidebar'] },
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'missing_partial')).toBe(true);
  });

  it('catches wrong directory for role', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Create misplaced file',
        changes: [
          {
            path: 'app/views/pages/thing.liquid',
            role: 'command',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validate_intent — pending resolution', () => {
  it('resolves partial reference within same plan', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add sidebar to blog',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/sidebar'] },
          },
          {
            path: 'app/views/partials/blog_posts/sidebar.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    // sidebar is in the plan, so missing_partial should NOT fire
    expect((result.errors ?? []).filter(e => e.type === 'missing_partial')).toHaveLength(0);
  });
});

describe('validate_intent — scaffold_output mode', () => {
  it('validates scaffold output directly', async () => {
    // First generate scaffold output
    const scaffold = await server.callTool('scaffold', {
      type: 'query',
      name: 'popular_posts',
      properties: [{ name: 'limit', type: 'integer' }],
    });

    // Then validate the scaffold output
    const result = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(result.ok).toBe(true);
    expect(result.pending_files).toBeDefined();
    expect(result.pending_files.length).toBeGreaterThan(0);
  });
});

describe('validate_intent — input coercion', () => {
  it('coerces changes from JSON string to array', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Test coercion',
        changes: JSON.stringify([
          {
            path: 'app/views/partials/test.liquid',
            role: 'partial',
            action: 'create',
          },
        ]),
      },
    });
    // Should not fail with schema error — coercion should fire
    expect((result.errors ?? []).every(e => e.type !== 'schema_error')).toBe(true);
  });

  it('accepts scaffold_output as a JSON string (MCP stdio agents pass text content directly)', async () => {
    // Agents using the MCP stdio transport receive tool results as text content.
    // They may pass scaffold_output as a JSON-encoded string rather than a parsed object.
    const scaffold = await server.callTool('scaffold', {
      type: 'query',
      name: 'string_coercion_test',
      properties: [{ name: 'limit', type: 'integer' }],
    });

    // Simulate what an MCP stdio agent does: pass the JSON-stringified scaffold output
    const result = await server.callTool('validate_intent', {
      scaffold_output: JSON.stringify(scaffold),
    });

    // Should work identically to passing the object directly
    expect(result.ok).toBe(true);
    expect(result.pending_files).toBeDefined();
    expect(result.pending_files.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Feature 5: Module API cross-reference (module_ref_path_not_found)
// ---------------------------------------------------------------------------

describe('validate_intent — module API cross-reference', () => {
  it('module ref to installed module with valid path: no module_ref_path_not_found', async () => {
    // The fixture project has 'user' module installed with
    // modules/user/public/views/partials/lib/helpers/can_do.liquid
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Use user module helper',
        changes: [
          {
            path: 'app/views/pages/test_module_ref.html.liquid',
            role: 'page',
            action: 'create',
            references: {
              partials: ['modules/user/lib/helpers/can_do'],
            },
          },
        ],
      },
    });
    // Should NOT have module_ref_path_not_found for a valid module path
    const pathNotFound = (result.warnings ?? []).filter(w => w.type === 'module_ref_path_not_found');
    expect(pathNotFound).toHaveLength(0);
  });

  it('module ref to installed module with invalid path: gets module_ref_path_not_found', async () => {
    // 'user' module is installed but this path doesn't exist
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Use nonexistent module path',
        changes: [
          {
            path: 'app/views/pages/test_bad_module_ref.html.liquid',
            role: 'page',
            action: 'create',
            references: {
              partials: ['modules/user/lib/helpers/nonexistent_helper_xyz'],
            },
          },
        ],
      },
    });
    // Should have module_ref_path_not_found warning for installed but missing path
    const pathNotFound = (result.warnings ?? []).filter(w => w.type === 'module_ref_path_not_found');
    expect(pathNotFound.length).toBeGreaterThan(0);
    expect(pathNotFound[0].module).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// Feature 7: next_step in validate_intent success
// ---------------------------------------------------------------------------

describe('validate_intent — next_step on success', () => {
  it('successful validation includes next_step field', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Update blog post page',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/list'] },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.next_step).toBeDefined();
    expect(typeof result.next_step).toBe('string');
    expect(result.next_step.length).toBeGreaterThan(0);
  });

  it('next_step mentions pending_files when pending_files is non-empty', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Create new feature',
        changes: [
          {
            path: 'app/views/pages/blog_posts/search.html.liquid',
            role: 'page',
            action: 'create',
            references: { partials: ['blog_posts/search_results'] },
          },
          {
            path: 'app/views/partials/blog_posts/search_results.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.pending_files.length).toBeGreaterThan(0);
    expect(result.next_step).toBeDefined();
    expect(result.next_step).toContain('pending_files');
  });
});
