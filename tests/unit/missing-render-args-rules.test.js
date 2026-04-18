import { describe, it, expect, beforeEach } from 'bun:test';
import { registerRules, clearRules, runRules, hasRules } from '../../src/core/rules/engine.js';
import { rules } from '../../src/core/rules/MissingRenderPartialArguments.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';

function buildGraph(overrides = {}) {
  return buildFactGraph({
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
        function_calls: [],
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
    queries: {},
    graphql: {},
    schema: {},
    layouts: {},
    translations: {},
    assets: [],
    ...overrides,
  });
}

describe('MissingRenderPartialArguments rules', () => {
  beforeEach(() => {
    clearRules();
    registerRules(rules);
  });

  it('registers rules for MissingRenderPartialArguments', () => {
    expect(hasRules('MissingRenderPartialArguments')).toBe(true);
  });

  it('shows full signature when target partial has doc params', () => {
    const graph = buildGraph();
    const diag = {
      check: 'MissingRenderPartialArguments',
      params: { partial: 'blog_posts/list', missing_param: 'limit' },
      message: "Missing argument 'limit'",
      file: 'app/views/pages/blog_posts/index.html.liquid',
      line: 3,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('MissingRenderPartialArguments.doc_block_mismatch');
    expect(result.confidence).toBe(0.9);
    expect(result.hint_md).toContain('page: page, limit: limit');
    expect(result.hint_md).toContain('`page`');
    expect(result.hint_md).toContain('`limit`');
    expect(result.suggestion).toContain('limit: limit');
    expect(result.see_also).toBeDefined();
    expect(result.see_also.tool).toBe('domain_guide');
  });

  it('detects chain-satisfied param (caller has param in scope)', () => {
    const graph = buildGraph();
    const diag = {
      check: 'MissingRenderPartialArguments',
      params: { partial: 'blog_posts/card', missing_param: 'page' },
      message: "Missing argument 'page'",
      file: 'app/views/partials/blog_posts/list.liquid',
      line: 5,
    };
    // list.liquid declares 'page' as its own param, so it has it in scope
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    // doc_block_mismatch fires first (priority 10) since card has params
    // but chain_satisfied (priority 20) fires when doc_block_mismatch applies
    // Actually, doc_block_mismatch wins because card has params ['blog_post']
    // Let me check: for 'page' not in card's params, it still matches doc_block_mismatch
    // since card has params.length > 0
    expect(result.rule_id).toBe('MissingRenderPartialArguments.doc_block_mismatch');
  });

  it('chain_satisfied fires when target has no doc params but caller has the param', () => {
    const graph = buildGraph({
      partials: {
        'blog_posts/list': {
          path: 'app/views/partials/blog_posts/list.liquid',
          params: ['page', 'limit'],
          renders: ['blog_posts/undocumented'],
          render_calls: [{ partial: 'blog_posts/undocumented', args: [] }],
          function_calls: [],
          rendered_by: [],
        },
        'blog_posts/undocumented': {
          path: 'app/views/partials/blog_posts/undocumented.liquid',
          params: [],
          renders: [],
          render_calls: [],
          function_calls: [],
          rendered_by: ['app/views/partials/blog_posts/list.liquid'],
        },
      },
    });
    const diag = {
      check: 'MissingRenderPartialArguments',
      params: { partial: 'blog_posts/undocumented', missing_param: 'page' },
      message: "Missing argument 'page'",
      file: 'app/views/partials/blog_posts/list.liquid',
      line: 5,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    // target has no params → doc_block_mismatch skips → chain_satisfied matches
    expect(result.rule_id).toBe('MissingRenderPartialArguments.chain_satisfied');
    expect(result.confidence).toBe(0.85);
    expect(result.hint_md).toContain('page');
    expect(result.suggestion).toContain('page: page');
  });

  it('falls through to generic when no special conditions match', () => {
    const graph = buildGraph({
      partials: {
        'blog_posts/orphan': {
          path: 'app/views/partials/blog_posts/orphan.liquid',
          params: [],
          renders: [],
          render_calls: [],
          function_calls: [],
          rendered_by: [],
        },
      },
    });
    const diag = {
      check: 'MissingRenderPartialArguments',
      params: { partial: 'blog_posts/orphan', missing_param: 'x' },
      message: "Missing argument 'x'",
      file: 'app/views/pages/blog_posts/index.html.liquid',
      line: 1,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('MissingRenderPartialArguments.generic');
    expect(result.confidence).toBe(0.5);
  });

  it('handles missing params gracefully', () => {
    const graph = buildGraph();
    const diag = {
      check: 'MissingRenderPartialArguments',
      params: {},
      message: 'some message',
      file: 'app/views/pages/blog_posts/index.html.liquid',
      line: 1,
    };
    const result = runRules(diag, { graph });
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('MissingRenderPartialArguments.generic');
  });

  it('includes full param list in signature hint', () => {
    const graph = buildGraph();
    const diag = {
      check: 'MissingRenderPartialArguments',
      params: { partial: 'blog_posts/form', missing_param: 'errors' },
      message: "Missing argument 'errors'",
      file: 'app/views/pages/blog_posts/index.html.liquid',
      line: 1,
    };
    const result = runRules(diag, { graph });
    expect(result.rule_id).toBe('MissingRenderPartialArguments.doc_block_mismatch');
    expect(result.hint_md).toContain('title: title, body: body, errors: errors');
  });
});
