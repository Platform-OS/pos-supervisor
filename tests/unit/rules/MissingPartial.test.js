import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/MissingPartial.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

const FIXTURE_MAP = {
  pages: {
    'blog_posts:get': { path: 'app/views/pages/blog_posts/index.html.liquid', slug: 'blog_posts', method: 'get', renders: ['blog_posts/list'], function_calls: [] },
  },
  partials: {
    'blog_posts/list': { path: 'app/views/partials/blog_posts/list.liquid', params: [], renders: ['blog_posts/card'], function_calls: [], rendered_by: [] },
    'blog_posts/card': { path: 'app/views/partials/blog_posts/card.liquid', params: [], renders: [], function_calls: [], rendered_by: [] },
    'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid', params: [], renders: [], function_calls: [], rendered_by: [] },
  },
  commands: {},
  queries: {},
  graphql: {},
  schema: {},
  layouts: {},
  translations: {},
  assets: [],
};

const graph = buildFactGraph(FIXTURE_MAP);
const facts = { graph };

beforeEach(() => {
  clearRules();
  registerRules(rules);
});

describe('MissingPartial.module_path', () => {
  test('fires for module partial paths', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/user/helpers/auth' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
    expect(result.see_also.tool).toBe('module_info');
    expect(result.see_also.args.name).toBe('user');
    expect(result.confidence).toBe(0.9);
  });

  test('does not fire for project partials', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/missing' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('MissingPartial.module_path');
  });
});

describe('MissingPartial.file_exists', () => {
  test('fires when target file exists in graph', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/card' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.file_exists');
    expect(result.hint_md).toContain('exists');
  });
});

describe('MissingPartial.suggest_nearest', () => {
  test('suggests similar partials for near-miss names', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/lst' }, file: 'app/views/pages/blog_posts/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.suggest_nearest');
    expect(result.hint_md).toContain('blog_posts/list');
  });

  test('skips for module paths', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/user/lst' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
  });
});

describe('MissingPartial.create_file', () => {
  test('suggests creating a new partial', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'invoices/summary' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.create_file');
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].type).toBe('create_file');
    expect(result.fixes[0].path).toBe('app/views/partials/invoices/summary.liquid');
  });

  test('suggests creating a command', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'commands/products/create' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.create_file');
    expect(result.fixes[0].path).toBe('app/lib/commands/products/create.liquid');
  });

  test('suggests creating a query', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'queries/products/find' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.create_file');
    expect(result.fixes[0].path).toBe('app/lib/queries/products/find.liquid');
  });

  test('does not suggest create for existing files', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'blog_posts/card' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('MissingPartial.create_file');
  });

  test('does not suggest create for module paths', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'modules/core/commands/execute' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('MissingPartial.module_path');
  });
});

describe('MissingPartial — edge cases', () => {
  test('returns null when partial param is missing', () => {
    const diag = { check: 'MissingPartial', params: {} };
    const result = runRules(diag, facts);
    expect(result).toBeNull();
  });

  test('returns null when params is undefined', () => {
    const diag = { check: 'MissingPartial' };
    const result = runRules(diag, facts);
    expect(result).toBeNull();
  });

  test('rule_id is always set in result', () => {
    const diag = { check: 'MissingPartial', params: { partial: 'invoices/receipt' } };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBeDefined();
    expect(result.rule_id.startsWith('MissingPartial.')).toBe(true);
  });
});
