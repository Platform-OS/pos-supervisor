/**
 * Performance tests — verify tools respond within acceptable time budgets.
 * These tests don't check correctness (covered elsewhere), only latency.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from './helpers/server.js';

setDefaultTimeout(60_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

function timed(fn) {
  return async () => {
    const start = performance.now();
    const result = await fn();
    const ms = performance.now() - start;
    return { result, ms };
  };
}

describe('Performance: project_map', () => {
  it('full scan completes under 2s', async () => {
    const { ms } = await timed(() =>
      server.callTool('project_map', { scope: 'full', force_refresh: true })
    )();
    console.log(`  project_map full: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(2000);
  });

  it('cached call completes under 50ms', async () => {
    // Warm the cache
    await server.callTool('project_map', { scope: 'full', force_refresh: true });
    const { ms } = await timed(() =>
      server.callTool('project_map', { scope: 'full' })
    )();
    console.log(`  project_map cached: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(50);
  });

  it('around scope completes under 1s', async () => {
    const { ms } = await timed(() =>
      server.callTool('project_map', {
        scope: 'around',
        path: 'app/views/pages/blog_posts/index.html.liquid',
      })
    )();
    console.log(`  project_map around: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe('Performance: validate_code', () => {
  it('quick mode completes under 3s', async () => {
    const content = `---
slug: perf_test
---
{% render 'blog_posts/list' %}
{{ 'blog_posts.title' | t }}`;
    const { ms } = await timed(() =>
      server.callTool('validate_code', {
        file_path: 'app/views/pages/perf_test.html.liquid',
        content,
        mode: 'quick',
      })
    )();
    console.log(`  validate_code quick: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(3000);
  });

  it('full mode completes under 5s', async () => {
    const content = `---
slug: perf_test_full
---
{% render 'blog_posts/list' %}
{{ 'blog_posts.title' | t }}`;
    const { ms } = await timed(() =>
      server.callTool('validate_code', {
        file_path: 'app/views/pages/perf_test_full.html.liquid',
        content,
        mode: 'full',
      })
    )();
    console.log(`  validate_code full: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(5000);
  });

  it('large file (100+ lines) completes under 5s', async () => {
    const lines = ['---', 'slug: large_file', '---'];
    for (let i = 0; i < 50; i++) {
      lines.push(`{% assign var_${i} = 'value_${i}' %}`);
    }
    for (let i = 0; i < 50; i++) {
      lines.push(`<p>{{ var_${i} }}</p>`);
    }
    const content = lines.join('\n');
    const { ms } = await timed(() =>
      server.callTool('validate_code', {
        file_path: 'app/views/pages/large_perf.html.liquid',
        content,
        mode: 'quick',
      })
    )();
    console.log(`  validate_code large (${lines.length} lines): ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(5000);
  });
});

describe('Performance: scaffold', () => {
  it('crud scaffold completes under 500ms', async () => {
    const { ms } = await timed(() =>
      server.callTool('scaffold', {
        type: 'crud',
        name: 'perf_test_item',
        properties: [
          { name: 'title', type: 'string' },
          { name: 'body', type: 'text' },
          { name: 'count', type: 'integer' },
        ],
      })
    )();
    console.log(`  scaffold crud: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(500);
  });

  it('command scaffold completes under 200ms', async () => {
    const { ms } = await timed(() =>
      server.callTool('scaffold', {
        type: 'command',
        name: 'perf_test_cmd',
        properties: [{ name: 'status', type: 'string' }],
      })
    )();
    console.log(`  scaffold command: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(200);
  });
});

describe('Performance: validate_intent', () => {
  it('simple plan validates under 2s', async () => {
    const { ms } = await timed(() =>
      server.callTool('validate_intent', {
        intent: {
          goal: 'Performance test',
          changes: [
            {
              path: 'app/views/pages/blog_posts/index.html.liquid',
              role: 'page',
              action: 'update',
              references: { partials: ['blog_posts/list'] },
            },
          ],
        },
      })
    )();
    console.log(`  validate_intent simple: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(2000);
  });

  it('complex plan (10 files) validates under 3s', async () => {
    const changes = [];
    for (let i = 0; i < 5; i++) {
      changes.push({
        path: `app/views/pages/perf/page_${i}.html.liquid`,
        role: 'page',
        action: 'create',
        references: { partials: [`perf/partial_${i}`] },
      });
      changes.push({
        path: `app/views/partials/perf/partial_${i}.liquid`,
        role: 'partial',
        action: 'create',
      });
    }
    const { ms } = await timed(() =>
      server.callTool('validate_intent', {
        intent: { goal: 'Performance test complex', changes },
      })
    )();
    console.log(`  validate_intent complex (10 files): ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(3000);
  });
});

describe('Performance: domain_guide', () => {
  it('responds under 100ms', async () => {
    const { ms } = await timed(() =>
      server.callTool('domain_guide', { domain: 'partials', section: 'gotchas' })
    )();
    console.log(`  domain_guide: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(100);
  });
});

describe('Performance: module_info', () => {
  it('list mode responds under 500ms', async () => {
    const { ms } = await timed(() =>
      server.callTool('module_info', {})
    )();
    console.log(`  module_info list: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(500);
  });

  it('single module responds under 1s', async () => {
    const { ms } = await timed(() =>
      server.callTool('module_info', { name: 'user' })
    )();
    console.log(`  module_info user: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(1000);
  });
});
