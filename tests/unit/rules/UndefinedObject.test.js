import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/UndefinedObject.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

const graph = buildFactGraph({ pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [] });
const facts = { graph };

beforeEach(() => { clearRules(); registerRules(rules); });

describe('UndefinedObject.shopify_object', () => {
  test('fires for Shopify theme objects', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'product' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.shopify_object');
    expect(result.confidence).toBe(0.95);
    expect(result.hint_md).toContain('Shopify');
  });

  test('fires for cart', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'cart' }, file: 'app/views/pages/cart.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.shopify_object');
  });

  test('does not fire for non-Shopify variables', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'my_var' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('UndefinedObject.shopify_object');
  });
});

describe('UndefinedObject.context_prefix', () => {
  test('fires for bare context properties in pages', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'params' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.context_prefix');
    expect(result.hint_md).toContain('context.params');
  });

  test('fires for session in pages', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'session' }, file: 'app/views/pages/login.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.context_prefix');
  });

  test('does not fire in partials', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'params' }, file: 'app/views/partials/header.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('UndefinedObject.context_prefix');
  });

  test('does not fire for non-context variables', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'my_var' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).not.toBe('UndefinedObject.context_prefix');
  });
});

describe('UndefinedObject.declare_param', () => {
  test('fires for undefined var in partials', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'item' }, file: 'app/views/partials/card.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.declare_param');
    expect(result.hint_md).toContain('@param');
    expect(result.hint_md).toContain('item');
  });

  test('fires for undefined var in commands', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'object' }, file: 'app/lib/commands/blog_posts/create.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.declare_param');
    expect(result.hint_md).toContain('command');
  });

  test('fires for undefined var in queries', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'id' }, file: 'app/lib/queries/blog_posts/find.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.declare_param');
    expect(result.hint_md).toContain('query');
  });
});

describe('UndefinedObject.generic', () => {
  test('fallback for unknown var in pages', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'xyz' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.generic');
    expect(result.confidence).toBe(0.5);
  });
});

describe('UndefinedObject — edge cases', () => {
  test('returns null when variable param is missing', () => {
    const diag = { check: 'UndefinedObject', params: {} };
    expect(runRules(diag, facts)).toBeNull();
  });
});
