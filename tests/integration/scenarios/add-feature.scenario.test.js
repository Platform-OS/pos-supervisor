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

describe('Agent scenario: add a new query feature', () => {
  it('completes project_map → scaffold → validate_intent → validate_code', async () => {
    // Step 1: Agent calls project_map to understand the project
    const map = await server.callTool('project_map', { scope: 'full', force_refresh: true });
    expect(map.project.has_config).toBe(true);
    expect(map.schema.blog_post).toBeDefined();

    // Step 2: Agent generates a query scaffold
    const scaffold = await server.callTool('scaffold', {
      type: 'query',
      name: 'recent_posts',
      properties: [{ name: 'limit', type: 'integer' }],
    });
    expect(scaffold.files.length).toBeGreaterThan(0);
    expect(scaffold.conflicts).toHaveLength(0);

    // Step 3: Agent validates the plan
    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);
    expect(intent.pending_files.length).toBeGreaterThan(0);

    // Step 4: Agent validates each file before writing
    for (const file of scaffold.files) {
      if (file.path.endsWith('.liquid')) {
        const validation = await server.callTool('validate_code', {
          file_path: file.path,
          content: file.content,
          mode: 'quick',
          pending_files: intent.pending_files,
        });
        // Should have no errors (scaffold generates correct code)
        expect(validation.errors.length).toBe(0);
      }
    }
  });

  it('completes project_map → manual plan → validate_intent → validate_code for update', async () => {
    // Step 1: Agent calls project_map
    const map = await server.callTool('project_map', { scope: 'full' });
    expect(map.pages['blog_posts']).toBeDefined();

    // Step 2: Agent plans an update to the blog index page
    const intent = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add pagination to blog post index',
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
    expect(intent.ok).toBe(true);

    // Step 3: Agent validates the updated page content
    const updatedContent = `---
slug: blog_posts
---
{% assign page = context.params.page | default: 1 %}
{% render 'blog_posts/list', page: page %}`;

    const validation = await server.callTool('validate_code', {
      file_path: 'app/views/pages/blog_posts/index.html.liquid',
      content: updatedContent,
      mode: 'quick',
      pending_files: intent.pending_files,
    });
    // Structural parsing should succeed; linter may flag extra param as warning
    expect(validation.structural).toBeDefined();
    expect(validation.structural.slug).toBe('blog_posts');
    expect(validation.structural.renders_used).toContain('blog_posts/list');
  });
});

describe('Agent scenario: add CRUD feature end-to-end', () => {
  it('completes project_map → scaffold(crud) → validate_intent → validate_code for all files', async () => {
    // Step 1: Agent checks what exists
    const map = await server.callTool('project_map', { scope: 'full', force_refresh: true });
    expect(map.project.has_config).toBe(true);

    // Step 2: Agent generates a full CRUD scaffold for a new resource
    const scaffold = await server.callTool('scaffold', {
      type: 'crud',
      name: 'event',
      properties: [
        { name: 'name', type: 'string' },
        { name: 'date', type: 'datetime' },
        { name: 'capacity', type: 'integer' },
      ],
    });
    expect(scaffold.files.length).toBeGreaterThanOrEqual(20);
    expect(scaffold.conflicts).toHaveLength(0);

    // Step 3: Agent validates the full plan
    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);
    expect(intent.pending_files.length).toBeGreaterThan(0);

    // Step 4: Agent validates each liquid file
    const liquidFiles = scaffold.files.filter(f => f.path.endsWith('.liquid'));
    expect(liquidFiles.length).toBeGreaterThan(0);

    for (const file of liquidFiles) {
      const validation = await server.callTool('validate_code', {
        file_path: file.path,
        content: file.content,
        mode: 'quick',
        pending_files: intent.pending_files,
      });
      // Filter MissingPartial for modules/* — test fixture only has modules/user installed
      const realErrors = validation.errors.filter(e =>
        !(e.check === 'MissingPartial' && /^'modules\//.test(e.message))
      );
      expect(realErrors.length).toBe(0);
    }
  });
});

describe('Agent scenario: plan with missing dependencies detected', () => {
  it('validate_intent catches missing partial reference before any code is written', async () => {
    // Step 1: Agent maps the project
    const map = await server.callTool('project_map', { scope: 'full' });

    // Step 2: Agent creates an incomplete plan (forgets to include a new partial)
    const intent = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add product showcase page',
        changes: [
          {
            path: 'app/views/pages/products/showcase.html.liquid',
            role: 'page',
            action: 'create',
            references: { partials: ['products/gallery', 'products/details'] },
          },
          {
            path: 'app/views/partials/products/gallery.liquid',
            role: 'partial',
            action: 'create',
          },
          // products/details partial is MISSING from the plan
        ],
      },
    });

    // validate_intent should catch the missing partial
    expect(intent.ok).toBe(false);
    expect(intent.errors.some(e => e.type === 'missing_partial' && e.ref === 'products/details')).toBe(true);

    // Step 3: Agent fixes the plan by adding the missing partial
    const fixedIntent = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add product showcase page',
        changes: [
          {
            path: 'app/views/pages/products/showcase.html.liquid',
            role: 'page',
            action: 'create',
            references: { partials: ['products/gallery', 'products/details'] },
          },
          {
            path: 'app/views/partials/products/gallery.liquid',
            role: 'partial',
            action: 'create',
          },
          {
            path: 'app/views/partials/products/details.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });

    // Fixed plan should pass
    expect(fixedIntent.ok).toBe(true);
  });

  it('validate_intent catches wrong path for role before any code is written', async () => {
    // Agent puts a page in the wrong directory
    const intent = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add contact page',
        changes: [
          {
            path: 'app/views/partials/contact.html.liquid',
            role: 'page',
            action: 'create',
          },
        ],
      },
    });

    // Should fail with invalid_path_for_role
    expect(intent.ok).toBe(false);
    expect(intent.errors.some(e => e.type === 'invalid_path_for_role')).toBe(true);
  });
});

describe('Agent scenario: API-only scaffold (no views)', () => {
  it('completes project_map → scaffold(api) → validate_intent → validate_code', async () => {
    // Step 1: Agent checks what exists
    const map = await server.callTool('project_map', { scope: 'full' });

    // Step 2: Agent generates API-only scaffold (no pages/partials)
    const scaffold = await server.callTool('scaffold', {
      type: 'api',
      name: 'notification',
      properties: [
        { name: 'message', type: 'string' },
        { name: 'read', type: 'boolean' },
      ],
    });
    expect(scaffold.files.some(f => f.path.includes('schema/'))).toBe(true);
    expect(scaffold.files.some(f => f.path.includes('graphql/'))).toBe(true);
    // API mode should NOT include pages or partials
    expect(scaffold.files.every(f => !f.path.includes('pages/'))).toBe(true);
    expect(scaffold.files.every(f => !f.path.includes('partials/'))).toBe(true);

    // Step 3: Validate the plan
    const intent = await server.callTool('validate_intent', {
      scaffold_output: scaffold,
    });
    expect(intent.ok).toBe(true);

    // Step 4: Validate each liquid file
    for (const file of scaffold.files) {
      if (file.path.endsWith('.liquid')) {
        const validation = await server.callTool('validate_code', {
          file_path: file.path,
          content: file.content,
          mode: 'quick',
          pending_files: intent.pending_files,
        });
        // Filter MissingPartial for modules/* — test fixture only has modules/user installed
        const realErrors = validation.errors.filter(e =>
          !(e.check === 'MissingPartial' && /^'modules\//.test(e.message))
        );
        expect(realErrors.length).toBe(0);
      }
    }
  });
});
