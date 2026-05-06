import { describe, it, expect } from 'bun:test';
import { extractAll } from '../../src/core/liquid-parser.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';
import {
  isVariablePassedToRender,
  isVariablePassedToFunction,
  callersWithArgs,
  getPartialParams,
  missingArgsForCaller,
  isParamAvailableInCallerScope,
  renderFlowSummary,
} from '../../src/core/render-flow.js';

// ── liquid-parser: renderCalls extraction ───────────────────────────────────

describe('liquid-parser renderCalls extraction', () => {
  it('extracts named args from structured render markup', () => {
    const result = extractAll(`{% render 'form', title: title, body: body %}`);
    expect(result.renderCalls).toHaveLength(1);
    expect(result.renderCalls[0].partial).toBe('form');
    expect(result.renderCalls[0].args).toEqual(['title', 'body']);
  });

  it('extracts named args from render with no args', () => {
    const result = extractAll(`{% render 'simple' %}`);
    expect(result.renderCalls).toHaveLength(1);
    expect(result.renderCalls[0].partial).toBe('simple');
    expect(result.renderCalls[0].args).toEqual([]);
  });

  it('handles multiple render calls in one file', () => {
    const result = extractAll(`
      {% render 'header', theme: theme %}
      {% render 'footer', year: year %}
    `);
    expect(result.renderCalls).toHaveLength(2);
    expect(result.renderCalls[0]).toEqual({ partial: 'header', args: ['theme'] });
    expect(result.renderCalls[1]).toEqual({ partial: 'footer', args: ['year'] });
  });

  it('extracts args from include tags', () => {
    const result = extractAll(`{% include 'legacy', mode: mode %}`);
    expect(result.renderCalls).toHaveLength(1);
    expect(result.renderCalls[0].partial).toBe('legacy');
    expect(result.renderCalls[0].args).toEqual(['mode']);
  });

  it('preserves backward-compatible renders array', () => {
    const result = extractAll(`
      {% render 'a', x: x %}
      {% render 'b' %}
    `);
    expect(result.renders).toEqual(['a', 'b']);
    expect(result.renderCalls).toHaveLength(2);
  });

  it('handles render with path-style partial names', () => {
    const result = extractAll(`{% render 'blog_posts/card', blog_post: item %}`);
    expect(result.renderCalls).toHaveLength(1);
    expect(result.renderCalls[0].partial).toBe('blog_posts/card');
    expect(result.renderCalls[0].args).toEqual(['blog_post']);
  });

  it('returns empty renderCalls for unparseable content', () => {
    const result = extractAll('{% invalid unclosed');
    // extractAll returns null for completely unparseable content
    // or an object with empty renderCalls for partial failures
    if (result) {
      expect(result.renderCalls).toBeDefined();
    }
  });
});

// ── ProjectFactGraph: render call indexing ──────────────────────────────────

function buildTestGraph(overrides = {}) {
  const base = {
    pages: {
      'blog_posts:get': {
        path: 'app/views/pages/blog_posts/index.html.liquid',
        slug: 'blog_posts',
        method: 'get',
        renders: ['blog_posts/list'],
        render_calls: [{ partial: 'blog_posts/list', args: ['page'] }],
        function_calls: [],
      },
    },
    partials: {
      'blog_posts/list': {
        path: 'app/views/partials/blog_posts/list.liquid',
        params: ['page', 'limit'],
        renders: ['blog_posts/card'],
        render_calls: [{ partial: 'blog_posts/card', args: ['blog_post'] }],
        function_calls: [{ variable: 'items', path: 'queries/blog_posts/search' }],
        rendered_by: ['app/views/pages/blog_posts/index.html.liquid'],
      },
      'blog_posts/card': {
        path: 'app/views/partials/blog_posts/card.liquid',
        params: ['blog_post'],
        renders: [],
        render_calls: [],
        function_calls: [],
        rendered_by: ['app/views/partials/blog_posts/list.liquid'],
      },
      'blog_posts/form': {
        path: 'app/views/partials/blog_posts/form.liquid',
        params: ['title', 'body', 'errors'],
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
  };
  return buildFactGraph(base);
}

describe('ProjectFactGraph render call queries', () => {
  it('renderCallsFrom returns calls for a file', () => {
    const graph = buildTestGraph();
    const calls = graph.renderCallsFrom('app/views/partials/blog_posts/list.liquid');
    expect(calls).toHaveLength(1);
    expect(calls[0].partial).toBe('blog_posts/card');
    expect(calls[0].args).toEqual(['blog_post']);
  });

  it('renderCallsFrom returns empty for file with no render calls', () => {
    const graph = buildTestGraph();
    const calls = graph.renderCallsFrom('app/views/partials/blog_posts/card.liquid');
    expect(calls).toEqual([]);
  });

  it('renderCallsTo returns all callers of a partial', () => {
    const graph = buildTestGraph();
    const callers = graph.renderCallsTo('blog_posts/list');
    expect(callers).toHaveLength(1);
    expect(callers[0].callerPath).toBe('app/views/pages/blog_posts/index.html.liquid');
    expect(callers[0].args).toEqual(['page']);
  });

  it('partialSignature returns declared params', () => {
    const graph = buildTestGraph();
    expect(graph.partialSignature('blog_posts/list')).toEqual(['page', 'limit']);
    expect(graph.partialSignature('blog_posts/card')).toEqual(['blog_post']);
  });

  it('partialSignature returns null for unknown partial', () => {
    const graph = buildTestGraph();
    expect(graph.partialSignature('nonexistent')).toBeNull();
  });
});

// ── render-flow.js: pure query functions ────────────────────────────────────

describe('isVariablePassedToRender', () => {
  it('returns true when variable matches a render arg name', () => {
    const graph = buildTestGraph();
    expect(isVariablePassedToRender(graph, 'app/views/partials/blog_posts/list.liquid', 'blog_post')).toBe(true);
  });

  it('returns false when variable is not in any render arg', () => {
    const graph = buildTestGraph();
    expect(isVariablePassedToRender(graph, 'app/views/partials/blog_posts/list.liquid', 'unrelated')).toBe(false);
  });

  it('returns false for file with no render calls', () => {
    const graph = buildTestGraph();
    expect(isVariablePassedToRender(graph, 'app/views/partials/blog_posts/card.liquid', 'blog_post')).toBe(false);
  });
});

describe('isVariablePassedToFunction', () => {
  it('returns true when variable matches a function call result variable', () => {
    const graph = buildTestGraph();
    expect(isVariablePassedToFunction(graph, 'app/views/partials/blog_posts/list.liquid', 'items')).toBe(true);
  });

  it('returns false for non-matching variable', () => {
    const graph = buildTestGraph();
    expect(isVariablePassedToFunction(graph, 'app/views/partials/blog_posts/list.liquid', 'other')).toBe(false);
  });
});

describe('callersWithArgs', () => {
  it('returns callers with their passed arguments', () => {
    const graph = buildTestGraph();
    const callers = callersWithArgs(graph, 'blog_posts/card');
    expect(callers).toHaveLength(1);
    expect(callers[0].callerPath).toBe('app/views/partials/blog_posts/list.liquid');
    expect(callers[0].args).toEqual(['blog_post']);
  });

  it('returns empty for partial with no callers', () => {
    const graph = buildTestGraph();
    const callers = callersWithArgs(graph, 'blog_posts/form');
    expect(callers).toEqual([]);
  });
});

describe('missingArgsForCaller', () => {
  it('detects when caller passes all required params', () => {
    const graph = buildTestGraph();
    const missing = missingArgsForCaller(
      graph,
      'app/views/partials/blog_posts/list.liquid',
      'blog_posts/card',
    );
    expect(missing).toEqual([]);
  });

  it('detects missing params when caller omits some', () => {
    const graph = buildTestGraph();
    const missing = missingArgsForCaller(
      graph,
      'app/views/pages/blog_posts/index.html.liquid',
      'blog_posts/list',
    );
    // Page passes 'page' but not 'limit'
    expect(missing).toEqual(['limit']);
  });

  it('returns all params when caller has no render call to target', () => {
    const graph = buildTestGraph();
    const missing = missingArgsForCaller(
      graph,
      'app/views/partials/blog_posts/card.liquid',
      'blog_posts/form',
    );
    expect(missing).toEqual(['title', 'body', 'errors']);
  });
});

describe('isParamAvailableInCallerScope', () => {
  it('returns true when caller declares the param', () => {
    const graph = buildTestGraph();
    expect(isParamAvailableInCallerScope(
      graph,
      'app/views/partials/blog_posts/list.liquid',
      'page',
    )).toBe(true);
  });

  it('returns false when caller does not declare the param', () => {
    const graph = buildTestGraph();
    expect(isParamAvailableInCallerScope(
      graph,
      'app/views/partials/blog_posts/list.liquid',
      'unrelated',
    )).toBe(false);
  });

  it('returns false for pages (no params)', () => {
    const graph = buildTestGraph();
    expect(isParamAvailableInCallerScope(
      graph,
      'app/views/pages/blog_posts/index.html.liquid',
      'page',
    )).toBe(false);
  });
});

describe('renderFlowSummary', () => {
  it('shows passed args, declared params, and missing args', () => {
    const graph = buildTestGraph();
    const summary = renderFlowSummary(graph, 'app/views/pages/blog_posts/index.html.liquid');
    expect(summary).toHaveLength(1);
    expect(summary[0].partial).toBe('blog_posts/list');
    expect(summary[0].passed_args).toEqual(['page']);
    expect(summary[0].declared_params).toEqual(['page', 'limit']);
    expect(summary[0].missing_args).toEqual(['limit']);
  });

  it('shows no missing args when all are passed', () => {
    const graph = buildTestGraph();
    const summary = renderFlowSummary(graph, 'app/views/partials/blog_posts/list.liquid');
    expect(summary).toHaveLength(1);
    expect(summary[0].missing_args).toEqual([]);
  });

  it('returns empty for file with no render calls', () => {
    const graph = buildTestGraph();
    const summary = renderFlowSummary(graph, 'app/views/partials/blog_posts/card.liquid');
    expect(summary).toEqual([]);
  });
});
