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

describe('project_map — full scope', () => {
  it('returns project metadata', async () => {
    const result = await server.callTool('project_map', { scope: 'full', force_refresh: true });
    expect(result.project.has_config).toBe(true);
    expect(result.project.environments).toContain('staging');
    expect(result.project.modules).toContain('user');
  });

  it('parses schema with correct properties', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    expect(result.schema.blog_post).toBeDefined();
    expect(result.schema.blog_post.properties).toHaveLength(3);
    expect(result.schema.blog_post.properties.map(p => p.name)).toEqual(['title', 'body', 'author_id']);
  });

  it('parses GraphQL operations', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    // GraphQL keys are relative to app/graphql/ without extension
    const search = result.graphql['blog_posts/search'];
    expect(search).toBeDefined();
    expect(search.operation).toBe('query');
    expect(search.args.length).toBeGreaterThanOrEqual(1);

    const create = result.graphql['blog_posts/create'];
    expect(create).toBeDefined();
    expect(create.operation).toBe('mutation');
  });

  it('indexes pages by slug', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    expect(result.pages['blog_posts']).toBeDefined();
    expect(result.pages['blog_posts'].renders).toContain('blog_posts/list');
    expect(result.pages['blog_posts/show']).toBeDefined();
  });

  it('indexes partials with rendered_by reverse index', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    const list = result.partials['blog_posts/list'];
    expect(list).toBeDefined();
    // list.liquid is rendered by index page
    expect(list.rendered_by.length).toBeGreaterThan(0);

    const card = result.partials['blog_posts/card'];
    expect(card).toBeDefined();
    expect(card.params).toContain('blog_post');
  });

  it('detects commands', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    // Commands are indexed by full relative path (e.g. 'app/lib/commands/blog_posts/create/main.liquid')
    const createCmds = Object.keys(result.commands).filter(k => k.includes('blog_posts/create'));
    expect(createCmds.length).toBeGreaterThan(0);
    const [firstKey] = createCmds;
    expect(result.commands[firstKey].phases).toBeDefined();
    expect(Array.isArray(result.commands[firstKey].phases)).toBe(true);
  });

  it('includes queries', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    const searchQuery = Object.entries(result.queries).find(([k]) => k.includes('blog_posts/search'));
    expect(searchQuery).toBeDefined();
  });

  it('includes translations', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    expect(result.translations.en).toBeDefined();
    // en.yml has top-level 'en:' key, so flattenYaml produces 'en.blog_posts.title'
    expect(result.translations.en['en.blog_posts.title']).toBe('Blog Posts');
  });

  it('includes assets', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    expect(result.assets).toBeDefined();
    expect(Array.isArray(result.assets)).toBe(true);
    expect(result.assets.length).toBeGreaterThan(0);
    // Should contain app.css (possibly with subdirectory path)
    expect(result.assets.some(a => a.includes('app.css'))).toBe(true);
  });

  it('includes file_counts summary', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    expect(result.summary.file_counts.schema).toBe(1);
    expect(result.summary.file_counts.graphql).toBe(4);
    expect(result.summary.file_counts.pages).toBe(2);
    expect(result.summary.file_counts.assets).toBeGreaterThan(0);
  });

  it('detects resource completeness', async () => {
    const result = await server.callTool('project_map', { scope: 'full' });
    const blogPost = result.summary.resources.blog_post;
    expect(blogPost).toBeDefined();
    expect(blogPost.schema).toBeDefined();
    expect(blogPost.graphql.length).toBeGreaterThan(0);
  });
});

describe('project_map — around scope', () => {
  it('returns files connected to a path', async () => {
    const result = await server.callTool('project_map', {
      scope: 'around',
      path: 'app/views/pages/blog_posts/index.html.liquid',
    });
    expect(result).toBeDefined();
    expect(result.files).toBeDefined();
  });

  it('requires path parameter', async () => {
    const result = await server.callTool('project_map', { scope: 'around' });
    expect(result.error).toBeDefined();
  });
});

describe('project_map — caching', () => {
  it('returns same data on second call (cache hit)', async () => {
    const r1 = await server.callTool('project_map', { scope: 'full', force_refresh: true });
    const r2 = await server.callTool('project_map', { scope: 'full' });
    expect(r1.summary.file_counts).toEqual(r2.summary.file_counts);
  });
});
