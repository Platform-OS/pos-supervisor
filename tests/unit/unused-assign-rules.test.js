import { describe, it, expect, beforeEach } from 'bun:test';
import { registerRules, clearRules, runRules, hasRules } from '../../src/core/rules/engine.js';
import { rules } from '../../src/core/rules/UnusedAssign.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';

function buildGraph(overrides = {}) {
  return buildFactGraph({
    pages: {},
    partials: {
      'blog_posts/list': {
        path: 'app/views/partials/blog_posts/list.liquid',
        params: ['page'],
        renders: ['blog_posts/card'],
        render_calls: [{ partial: 'blog_posts/card', args: ['blog_post'] }],
        function_calls: [{ variable: 'items', path: 'queries/blog_posts/search' }],
        rendered_by: [],
      },
      'blog_posts/card': {
        path: 'app/views/partials/blog_posts/card.liquid',
        params: ['blog_post'],
        renders: [],
        render_calls: [],
        function_calls: [],
        rendered_by: [],
      },
    },
    commands: {},
    queries: {
      'app/lib/queries/blog_posts/search.liquid': {
        params: ['query'],
        graphql_calls: [],
        function_calls: [],
      },
    },
    graphql: {},
    schema: {},
    layouts: {},
    translations: {},
    assets: [],
    ...overrides,
  });
}

describe('UnusedAssign rules', () => {
  beforeEach(() => {
    clearRules();
    registerRules(rules);
  });

  it('registers rules for UnusedAssign', () => {
    expect(hasRules('UnusedAssign')).toBe(true);
  });

  it('suppresses when variable is passed to render', () => {
    const graph = buildGraph();
    const diag = {
      check: 'UnusedAssign',
      params: { variable: 'blog_post' },
      message: "'blog_post' is assigned but never used",
      file: 'app/views/partials/blog_posts/list.liquid',
      line: 5,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UnusedAssign.passed_to_render');
    expect(result.confidence).toBe(0.95);
    expect(result.suppress).toBe(true);
  });

  it('identifies function call result variable', () => {
    const graph = buildGraph();
    const diag = {
      check: 'UnusedAssign',
      params: { variable: 'items' },
      message: "'items' is assigned but never used",
      file: 'app/views/partials/blog_posts/list.liquid',
      line: 3,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UnusedAssign.passed_to_function');
    expect(result.confidence).toBe(0.8);
  });

  it('falls through to generic for truly unused variables', () => {
    const graph = buildGraph();
    const diag = {
      check: 'UnusedAssign',
      params: { variable: 'totally_unused' },
      message: "'totally_unused' is assigned but never used",
      file: 'app/views/partials/blog_posts/list.liquid',
      line: 10,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UnusedAssign.generic');
    expect(result.confidence).toBe(0.5);
  });

  it('handles missing params gracefully', () => {
    const graph = buildGraph();
    const diag = {
      check: 'UnusedAssign',
      params: {},
      message: 'some weird message',
      file: 'app/views/partials/blog_posts/list.liquid',
      line: 1,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UnusedAssign.generic');
  });

  it('handles file with no render or function calls', () => {
    const graph = buildGraph();
    const diag = {
      check: 'UnusedAssign',
      params: { variable: 'unused' },
      message: "'unused' is assigned but never used",
      file: 'app/views/partials/blog_posts/card.liquid',
      line: 1,
    };
    const result = runRules(diag, { graph });
    expect(result.rule_id).toBe('UnusedAssign.generic');
  });
});
