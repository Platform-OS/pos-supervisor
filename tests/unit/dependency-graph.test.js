/**
 * dependency-graph unit tests — pins the edge resolution and orphaned file
 * classification that Phase 2.2 introduces. These are pure-function tests
 * against a synthetic project_map shape — no LSP, no filesystem.
 */

import { describe, it, expect } from 'bun:test';
import {
  buildDependencyGraph,
  detectOrphanedFiles,
  resolveRenderTarget,
  resolveFunctionTarget,
  resolveGraphqlTarget,
} from '../../src/core/dependency-graph.js';

// ── Resolvers ────────────────────────────────────────────────────────────────

describe('dependency-graph: resolvers', () => {
  it('resolveRenderTarget uses projectMap partial path when known', () => {
    const map = { partials: { 'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid' } } };
    expect(resolveRenderTarget('blog_posts/form', map)).toBe('app/views/partials/blog_posts/form.liquid');
  });

  it('resolveRenderTarget falls back to canonical path for unknown partials', () => {
    expect(resolveRenderTarget('widgets/card', { partials: {} })).toBe('app/views/partials/widgets/card.liquid');
  });

  it('resolveRenderTarget handles modules/ prefix', () => {
    expect(resolveRenderTarget('modules/common-styling/init', { partials: {} }))
      .toBe('modules/common-styling/init.liquid');
  });

  it('resolveFunctionTarget maps commands/ paths to app/lib', () => {
    expect(resolveFunctionTarget('commands/blog_posts/create'))
      .toBe('app/lib/commands/blog_posts/create.liquid');
  });

  it('resolveFunctionTarget maps queries/ paths to app/lib', () => {
    expect(resolveFunctionTarget('queries/blog_posts/search'))
      .toBe('app/lib/queries/blog_posts/search.liquid');
  });

  it('resolveFunctionTarget preserves modules/ prefix', () => {
    expect(resolveFunctionTarget('modules/user/helpers/can_do_or_unauthorized'))
      .toBe('modules/user/helpers/can_do_or_unauthorized.liquid');
  });

  it('resolveGraphqlTarget maps op names to app/graphql', () => {
    expect(resolveGraphqlTarget('blog_posts/search')).toBe('app/graphql/blog_posts/search.graphql');
  });
});

// ── Graph construction ──────────────────────────────────────────────────────

describe('dependency-graph: buildDependencyGraph', () => {
  it('seeds every file in projectMap with empty arrays', () => {
    const map = {
      pages:    { 'index:get':  { path: 'app/views/pages/index.html.liquid', renders: [], function_calls: [] } },
      partials: { 'card':       { path: 'app/views/partials/card.liquid', renders: [], function_calls: [] } },
      commands: { 'app/lib/commands/x.liquid': { graphql_calls: [], function_calls: [] } },
      queries:  { 'app/lib/queries/y.liquid':  { graphql_calls: [], function_calls: [] } },
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/views/pages/index.html.liquid']).toEqual({ depends_on: [], referenced_by: [] });
    expect(graph['app/views/partials/card.liquid']).toEqual({ depends_on: [], referenced_by: [] });
    expect(graph['app/lib/commands/x.liquid']).toEqual({ depends_on: [], referenced_by: [] });
    expect(graph['app/lib/queries/y.liquid']).toEqual({ depends_on: [], referenced_by: [] });
  });

  it('adds render edges from pages to partials with reverse mirror', () => {
    const map = {
      pages: {
        'blog_posts:get': {
          path: 'app/views/pages/blog_posts/index.html.liquid',
          renders: ['blog_posts/list'],
          function_calls: [],
        },
      },
      partials: {
        'blog_posts/list': { path: 'app/views/partials/blog_posts/list.liquid', renders: [], function_calls: [] },
      },
      commands: {}, queries: {}, graphql: {},
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/views/pages/blog_posts/index.html.liquid'].depends_on)
      .toContain('app/views/partials/blog_posts/list.liquid');
    expect(graph['app/views/partials/blog_posts/list.liquid'].referenced_by)
      .toContain('app/views/pages/blog_posts/index.html.liquid');
  });

  it('adds function-call edges from pages to commands', () => {
    const map = {
      pages: {
        'blog_posts:post': {
          path: 'app/views/pages/blog_posts/create.html.liquid',
          renders: [],
          function_calls: [{ variable: 'object', path: 'commands/blog_posts/create' }],
        },
      },
      partials: {},
      commands: { 'app/lib/commands/blog_posts/create.liquid': { graphql_calls: [], function_calls: [] } },
      queries:  {}, graphql: {},
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/views/pages/blog_posts/create.html.liquid'].depends_on)
      .toContain('app/lib/commands/blog_posts/create.liquid');
    expect(graph['app/lib/commands/blog_posts/create.liquid'].referenced_by)
      .toContain('app/views/pages/blog_posts/create.html.liquid');
  });

  it('adds function-call edges from multi-phase commands to their build/check subphases', () => {
    const map = {
      pages: {}, partials: {}, graphql: {}, queries: {},
      commands: {
        'app/lib/commands/blog_posts/create.liquid': {
          graphql_calls: [],
          function_calls: [
            { variable: 'data',   path: 'commands/blog_posts/create/build' },
            { variable: 'errors', path: 'commands/blog_posts/create/check' },
          ],
        },
        'app/lib/commands/blog_posts/create/build.liquid': { graphql_calls: [], function_calls: [] },
        'app/lib/commands/blog_posts/create/check.liquid': { graphql_calls: [], function_calls: [] },
      },
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/lib/commands/blog_posts/create.liquid'].depends_on)
      .toContain('app/lib/commands/blog_posts/create/build.liquid');
    expect(graph['app/lib/commands/blog_posts/create.liquid'].depends_on)
      .toContain('app/lib/commands/blog_posts/create/check.liquid');
    expect(graph['app/lib/commands/blog_posts/create/build.liquid'].referenced_by)
      .toContain('app/lib/commands/blog_posts/create.liquid');
  });

  it('adds graphql edges from commands to graphql ops', () => {
    const map = {
      pages: {}, partials: {}, queries: {},
      commands: {
        'app/lib/commands/blog_posts/create.liquid': {
          graphql_calls: [{ queryName: 'blog_posts/create' }],
          function_calls: [],
        },
      },
      graphql: { 'blog_posts/create': {} },
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/lib/commands/blog_posts/create.liquid'].depends_on)
      .toContain('app/graphql/blog_posts/create.graphql');
    expect(graph['app/graphql/blog_posts/create.graphql'].referenced_by)
      .toContain('app/lib/commands/blog_posts/create.liquid');
  });

  it('deduplicates edges — adding the same render twice yields one edge', () => {
    const map = {
      pages: {
        'p:get': {
          path: 'app/views/pages/p.html.liquid',
          renders: ['x', 'x', 'x'],
          function_calls: [],
        },
      },
      partials: { 'x': { path: 'app/views/partials/x.liquid', renders: [], function_calls: [] } },
      commands: {}, queries: {}, graphql: {},
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/views/pages/p.html.liquid'].depends_on).toEqual(['app/views/partials/x.liquid']);
  });

  it('merges LSP overlay edges on top of project_map edges', () => {
    const map = {
      pages: { 'p:get': { path: 'app/views/pages/p.html.liquid', renders: ['a'], function_calls: [] } },
      partials: {
        'a': { path: 'app/views/partials/a.liquid', renders: [], function_calls: [] },
        'b': { path: 'app/views/partials/b.liquid', renders: [], function_calls: [] },
      },
      commands: {}, queries: {}, graphql: {},
    };
    const lspOverlay = {
      'app/views/pages/p.html.liquid': {
        depends_on: ['app/views/partials/b.liquid'], // LSP knows about a dynamic render
        referenced_by: [],
      },
    };
    const graph = buildDependencyGraph(map, lspOverlay);
    // Both the static and the dynamic edge should land on the page.
    expect(graph['app/views/pages/p.html.liquid'].depends_on)
      .toContain('app/views/partials/a.liquid');
    expect(graph['app/views/pages/p.html.liquid'].depends_on)
      .toContain('app/views/partials/b.liquid');
    // Reverse edges are mirrored for both.
    expect(graph['app/views/partials/b.liquid'].referenced_by)
      .toContain('app/views/pages/p.html.liquid');
  });
});

// ── Orphaned files ───────────────────────────────────────────────────────────

describe('dependency-graph: detectOrphanedFiles', () => {
  it('flags a partial that nothing references', () => {
    const map = {
      pages: {}, partials: { 'unused': { path: 'app/views/partials/unused.liquid' } },
      commands: {}, queries: {},
    };
    const graph = {
      'app/views/partials/unused.liquid': { depends_on: [], referenced_by: [] },
    };
    expect(detectOrphanedFiles(graph, map)).toContain('app/views/partials/unused.liquid');
  });

  it('never flags a page as dead — pages are HTTP entry points', () => {
    const map = {
      pages: { 'p:get': { path: 'app/views/pages/p.html.liquid' } },
      partials: {}, commands: {}, queries: {},
    };
    const graph = {
      'app/views/pages/p.html.liquid': { depends_on: [], referenced_by: [] },
    };
    expect(detectOrphanedFiles(graph, map)).not.toContain('app/views/pages/p.html.liquid');
  });

  it('exempts build/check/execute subphase files anywhere in the path', () => {
    const map = { pages: {}, partials: {}, commands: {}, queries: {} };
    const graph = {
      'app/lib/commands/blog_posts/create/build.liquid': { depends_on: [], referenced_by: [] },
      'app/lib/commands/blog_posts/update/check.liquid': { depends_on: [], referenced_by: [] },
      'app/lib/commands/execute.liquid':                 { depends_on: [], referenced_by: [] },
    };
    const dead = detectOrphanedFiles(graph, map);
    expect(dead).not.toContain('app/lib/commands/blog_posts/create/build.liquid');
    expect(dead).not.toContain('app/lib/commands/blog_posts/update/check.liquid');
    expect(dead).not.toContain('app/lib/commands/execute.liquid');
  });

  it('flags a parent command whose callers disappeared (regression — F-010 create.liquid/delete.liquid)', () => {
    const map = {
      pages: {},
      partials: {},
      commands: { 'app/lib/commands/blog_posts/create.liquid': {} },
      queries:  {},
    };
    const graph = {
      'app/lib/commands/blog_posts/create.liquid': { depends_on: [], referenced_by: [] },
    };
    expect(detectOrphanedFiles(graph, map)).toContain('app/lib/commands/blog_posts/create.liquid');
  });

  it('does NOT flag a command whose caller is in the graph', () => {
    const map = {
      pages:    { 'p:post': { path: 'app/views/pages/p.html.liquid' } },
      partials: {},
      commands: { 'app/lib/commands/x/create.liquid': {} },
      queries:  {},
    };
    const graph = {
      'app/views/pages/p.html.liquid':    { depends_on: ['app/lib/commands/x/create.liquid'], referenced_by: [] },
      'app/lib/commands/x/create.liquid': { depends_on: [], referenced_by: ['app/views/pages/p.html.liquid'] },
    };
    expect(detectOrphanedFiles(graph, map)).not.toContain('app/lib/commands/x/create.liquid');
  });

  it('skips external module paths (they are read-only)', () => {
    const map = { pages: {}, partials: {}, commands: {}, queries: {} };
    const graph = {
      'modules/user/helpers/thing.liquid': { depends_on: [], referenced_by: [] },
    };
    expect(detectOrphanedFiles(graph, map)).toEqual([]);
  });
});
