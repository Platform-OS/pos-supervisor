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

describe('scaffold — crud', () => {
  it('generates complete CRUD file set', async () => {
    const result = await server.callTool('scaffold', {
      type: 'crud',
      name: 'product',
      properties: [
        { name: 'title', type: 'string' },
        { name: 'price', type: 'float' },
      ],
    });
    expect(result.files.length).toBeGreaterThanOrEqual(20);
    expect(result.creation_order).toBeDefined();
    expect(result.summary).toBeDefined();
    // Should have schema, graphql, commands, queries, pages, partials
    expect(result.files.some(f => f.path.includes('schema/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('graphql/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('commands/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('pages/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('partials/'))).toBe(true);
  });

  it('detects conflicts with existing files', async () => {
    const result = await server.callTool('scaffold', {
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }],
    });
    // blog_post already exists in fixture — should have conflicts
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});

describe('scaffold — command', () => {
  it('generates 4-file command set', async () => {
    const result = await server.callTool('scaffold', {
      type: 'command',
      name: 'product_approve',
      properties: [{ name: 'approved_at', type: 'datetime' }],
    });
    expect(result.files).toHaveLength(4); // main + build + check + graphql
    // Scaffold generates: create.liquid (main), create/build.liquid, create/check.liquid
    expect(result.files.some(f => f.path.includes('build.liquid'))).toBe(true);
    expect(result.files.some(f => f.path.includes('check.liquid'))).toBe(true);
    expect(result.files.some(f => f.path.endsWith('.liquid') && !f.path.includes('/build') && !f.path.includes('/check'))).toBe(true);
    expect(result.files.some(f => f.path.includes('.graphql'))).toBe(true);
  });
});

describe('scaffold — query', () => {
  it('generates 2-file query set', async () => {
    const result = await server.callTool('scaffold', {
      type: 'query',
      name: 'featured_posts',
      properties: [{ name: 'limit', type: 'integer' }],
    });
    expect(result.files).toHaveLength(2); // query wrapper + graphql
    expect(result.files.some(f => f.path.endsWith('.liquid'))).toBe(true);
    expect(result.files.some(f => f.path.endsWith('.graphql'))).toBe(true);
  });
});

describe('scaffold — partial', () => {
  it('generates 1 partial with doc block', async () => {
    const result = await server.callTool('scaffold', {
      type: 'partial',
      name: 'blog_post_sidebar',
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('partials/');
    expect(result.files[0].content).toContain('{% doc %}');
  });
});

describe('scaffold — page', () => {
  it('generates 1 page with frontmatter', async () => {
    const result = await server.callTool('scaffold', {
      type: 'page',
      name: 'about',
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('pages/');
    expect(result.files[0].content).toContain('slug:');
  });
});

describe('scaffold — api', () => {
  it('generates headless CRUD (no views/translations)', async () => {
    const result = await server.callTool('scaffold', {
      type: 'api',
      name: 'event',
      properties: [
        { name: 'name', type: 'string' },
        { name: 'date', type: 'datetime' },
      ],
    });
    expect(result.files.some(f => f.path.includes('schema/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('graphql/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('commands/'))).toBe(true);
    // No pages or partials in api mode
    expect(result.files.every(f => !f.path.includes('pages/'))).toBe(true);
    expect(result.files.every(f => !f.path.includes('partials/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feature 9: next_step in scaffold
// ---------------------------------------------------------------------------

describe('scaffold — next_step guidance', () => {
  it('scaffold write:false includes next_step mentioning validate_intent', async () => {
    const result = await server.callTool('scaffold', {
      type: 'partial',
      name: 'test_next_step',
    });
    // write defaults to false, so next_step should tell agent to call validate_intent
    expect(result.next_step).toBeDefined();
    expect(result.next_step).toContain('validate_intent');
  });

  it('scaffold with conflicts includes next_step mentioning conflicts', async () => {
    // blog_post already exists in fixture — will have conflicts
    const result = await server.callTool('scaffold', {
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }],
    });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.next_step).toBeDefined();
    expect(result.next_step).toMatch(/conflict/i);
  });

  it('scaffold write:false with no conflicts still mentions validate_intent', async () => {
    const result = await server.callTool('scaffold', {
      type: 'query',
      name: 'unique_test_query_xyz',
      properties: [{ name: 'limit', type: 'integer' }],
    });
    // No conflicts for a unique name
    expect((result.conflicts ?? []).length).toBe(0);
    expect(result.next_step).toBeDefined();
    expect(result.next_step).toContain('validate_intent');
  });
});
