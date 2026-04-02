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

describe('validate_intent — pending resolution within plan', () => {
  it('page + new partial in same plan passes', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add blog sidebar',
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
    expect((result.errors ?? []).filter(e => e.type === 'missing_partial')).toHaveLength(0);
  });

  it('same plan without partial fails', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add blog sidebar',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/sidebar'] },
          },
          // sidebar partial NOT in plan
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'missing_partial')).toBe(true);
  });

  it('multi-file plan with all cross-refs resolved passes', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Create comment system',
        changes: [
          {
            path: 'app/views/pages/blog_posts/comments.html.liquid',
            role: 'page',
            action: 'create',
            references: { partials: ['blog_posts/comment_form', 'blog_posts/comment_list'] },
          },
          {
            path: 'app/views/partials/blog_posts/comment_form.liquid',
            role: 'partial',
            action: 'create',
          },
          {
            path: 'app/views/partials/blog_posts/comment_list.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('plan referencing existing project partial passes', async () => {
    // blog_posts/list already exists in the fixture project
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add featured section to blog index',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/list', 'blog_posts/card'] },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('plan referencing non-existent partial without creating it fails', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add weather widget',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/weather_widget'] },
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'missing_partial' && e.ref === 'blog_posts/weather_widget')).toBe(true);
  });

  it('plan with GraphQL cross-ref resolved in same plan passes', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add product search',
        changes: [
          {
            path: 'app/lib/queries/products/search.liquid',
            role: 'query',
            action: 'create',
            references: { graphql: ['products/search'] },
          },
          {
            path: 'app/graphql/products/search.graphql',
            role: 'graphql',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('plan referencing existing project GraphQL operation passes', async () => {
    // blog_posts/search already exists in the fixture project
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Create blog search query wrapper',
        changes: [
          {
            path: 'app/lib/queries/blog_posts/full_search.liquid',
            role: 'query',
            action: 'create',
            references: { graphql: ['blog_posts/search'] },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('plan with missing GraphQL cross-ref fails', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add review search',
        changes: [
          {
            path: 'app/lib/queries/reviews/search.liquid',
            role: 'query',
            action: 'create',
            references: { graphql: ['reviews/search'] },
          },
          // reviews/search.graphql NOT in plan
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'missing_graphql')).toBe(true);
  });

  it('successful plan returns pending_files list', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Add notification partials',
        changes: [
          {
            path: 'app/views/partials/notifications/toast.liquid',
            role: 'partial',
            action: 'create',
          },
          {
            path: 'app/views/partials/notifications/banner.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.pending_files).toBeDefined();
    expect(result.pending_files.length).toBeGreaterThan(0);
    expect(result.pending_files).toContain('app/views/partials/notifications/toast.liquid');
    expect(result.pending_files).toContain('app/views/partials/notifications/banner.liquid');
  });
});
