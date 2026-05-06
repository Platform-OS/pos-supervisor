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

  // Pre-fix the page hint recommended `context.<name>` even though by the
  // time this rule runs we know the variable is NOT in the context-props
  // shortlist. Agents applied that suggestion → fresh UnknownProperty
  // error → 100% regression in DEMO. The hint may still NAME `context.<name>`
  // when explicitly warning the agent off it, but must not list it as a
  // recommended source.
  test('does NOT recommend context.<name> for an unknown variable in a page', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'voyager_pack' }, file: 'app/views/pages/index.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.generic');
    // The pre-fix harmful phrasing is `Use \`context.<name>\` for built-in objects`.
    // After the fix the hint must not include any "Use `context.<name>`" /
    // "→ `context.<name>`" recommendation (i.e. the variable name appearing
    // immediately after `context.` as a top-level property).
    expect(result.hint_md).not.toMatch(/Use\s+`?context\.voyager_pack`?/);
    expect(result.hint_md).not.toMatch(/→\s+`?context\.voyager_pack`?/);
    // The hint should warn against the suggestion.
    expect(result.hint_md).toMatch(/Adding `context\.voyager_pack`.*UnknownProperty/);
    // And list the real legitimate sources for a page.
    expect(result.hint_md).toContain('context.params.voyager_pack');
    expect(result.hint_md).toContain('graphql');
    expect(result.hint_md).toContain('assign');
  });

  test('layout hint points at content_for, not context.<name>', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'site_title' }, file: 'app/views/layouts/theme.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.generic');
    expect(result.hint_md).not.toMatch(/Use\s+`?context\.site_title`?/);
    expect(result.hint_md).toContain('content_for');
  });

  test('non-page non-layout falls back to assign/graphql/function guidance without recommending context.<name>', () => {
    // file is something the regex doesn't match — simulate a top-level asset.
    const diag = { check: 'UndefinedObject', params: { variable: 'foo' }, file: 'app/assets/whatever.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.generic');
    expect(result.hint_md).not.toMatch(/Use\s+`?context\.foo`?/);
    expect(result.hint_md).toContain('assign');
    expect(result.hint_md).toContain('@param');
  });
});

describe('UndefinedObject — edge cases', () => {
  test('falls through to .default when variable param is missing', () => {
    const diag = { check: 'UndefinedObject', params: {} };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UndefinedObject.default');
  });
});

describe('UndefinedObject.default catch-all', () => {
  test('does NOT preempt .shopify_object', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'product' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.shopify_object');
  });

  test('does NOT preempt .context_prefix', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'params' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.context_prefix');
  });

  test('does NOT preempt .declare_param in partials', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'props' }, file: 'app/views/partials/header.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.declare_param');
  });

  test('does NOT preempt .generic when variable is extracted', () => {
    const diag = { check: 'UndefinedObject', params: { variable: 'xyz' }, file: 'app/views/pages/index.html.liquid' };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UndefinedObject.generic');
  });

  test('fires when extraction failed entirely (no params, no file)', () => {
    const diag = { check: 'UndefinedObject' };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UndefinedObject.default');
    expect(result.confidence).toBeLessThan(0.5);
  });

  test('hint covers the three canonical resolutions (page / partial / local)', () => {
    const diag = { check: 'UndefinedObject', params: {} };
    const result = runRules(diag, facts);
    expect(result.hint_md).toContain('context.');
    expect(result.hint_md).toContain('@param');
    expect(result.hint_md).toContain('assign');
  });
});
