import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getCheckKnowledge,
  getTriggeredGotchas,
  isShopifyObject,
  isShopifyFilter,
  getDomainRule,
  getLanguageFeature,
  _resetKnowledge,
} from '../../src/core/knowledge-loader.js';

beforeEach(() => {
  _resetKnowledge();
});

// ── Check knowledge ──────────────────────────────────────────────────────────

describe('knowledge-loader: getCheckKnowledge', () => {
  it('returns check knowledge with default context', () => {
    const k = getCheckKnowledge('UndefinedObject');
    expect(k).not.toBeNull();
    expect(k.summary).toContain('not defined');
    expect(k.hint).toBeTruthy();
  });

  it('returns context-specific hint for page', () => {
    const k = getCheckKnowledge('UndefinedObject', 'page');
    expect(k.hint).toContain('context.');
  });

  it('returns context-specific hint for partial', () => {
    const k = getCheckKnowledge('UndefinedObject', 'partial');
    expect(k.hint).toContain('{% doc %}');
  });

  it('returns default hint when context not found', () => {
    const k = getCheckKnowledge('UndefinedObject', 'some_unknown_context');
    expect(k.hint).toBeTruthy(); // falls back to default
  });

  it('returns null for unknown check', () => {
    const k = getCheckKnowledge('CompletelyFakeCheck');
    expect(k).toBeNull();
  });

  it('includes shopify_guidance for UndefinedObject', () => {
    const k = getCheckKnowledge('UndefinedObject');
    expect(k.shopify_guidance).toContain('Shopify');
  });

  it('returns knowledge for all defined checks', () => {
    const checks = [
      'UndefinedObject', 'UnknownFilter', 'GraphQLCheck', 'ConvertIncludeToRender',
      'DeprecatedTag', 'MissingPartial', 'MissingRenderPartialArguments',
      'NestedGraphQLQuery', 'LiquidHTMLSyntaxError', 'TranslationKeyExists',
      'UnknownProperty', 'HardcodedRoutes', 'ImgLazyLoading', 'ImgWidthAndHeight',
      'InvalidHashAssignTarget', 'MissingAsset', 'MetadataParamsCheck',
    ];
    for (const check of checks) {
      const k = getCheckKnowledge(check);
      expect(k).not.toBeNull();
      expect(k.summary).toBeTruthy();
      expect(k.hint).toBeTruthy();
    }
  });
});

// ── Triggered gotchas ────────────────────────────────────────────────────────

describe('knowledge-loader: getTriggeredGotchas', () => {
  it('returns domain rule and always-triggered gotchas', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(),
      tags: new Set(),
      filters: new Set(),
    });
    expect(result).not.toBeNull();
    expect(result.rule).toContain('Pages');
    // Should include "always" gotchas even with empty triggers
    expect(result.gotchas.length).toBeGreaterThan(0);
    expect(result.gotchas.some(g => g.id === 'pages_title')).toBe(true);
  });

  it('includes check-triggered gotchas when check is present', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(['UndefinedObject']),
      tags: new Set(),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'pages_context_prefix')).toBe(true);
  });

  it('excludes check-triggered gotchas when check is absent', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(),
      tags: new Set(),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'pages_context_prefix')).toBe(false);
  });

  it('triggers tag-based gotchas', () => {
    const result = getTriggeredGotchas('partials', {
      checks: new Set(),
      tags: new Set(['graphql']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'partials_no_graphql')).toBe(true);
  });

  it('returns null for unknown domain', () => {
    const result = getTriggeredGotchas('completely_fake_domain', {});
    expect(result).toBeNull();
  });

  it('works with empty triggers object', () => {
    const result = getTriggeredGotchas('graphql', {});
    expect(result).not.toBeNull();
    expect(result.rule).toBeTruthy();
  });

  it('returns gotchas for all defined domains', () => {
    const domains = ['pages', 'partials', 'graphql', 'commands', 'queries', 'translations', 'layouts', 'schema', 'config'];
    for (const domain of domains) {
      const result = getTriggeredGotchas(domain, {});
      expect(result).not.toBeNull();
      expect(result.rule).toBeTruthy();
    }
  });

  it('gotchas have required fields', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(['UndefinedObject', 'NestedGraphQLQuery', 'ConvertIncludeToRender']),
      tags: new Set(),
      filters: new Set(),
    });
    for (const g of result.gotchas) {
      expect(g.id).toBeTruthy();
      expect(g.message).toBeTruthy();
      expect(g.severity).toBeTruthy();
    }
  });
});

// ── Shopify awareness ────────────────────────────────────────────────────────

describe('knowledge-loader: Shopify awareness', () => {
  it('detects Shopify objects', () => {
    expect(isShopifyObject('product')).toBe(true);
    expect(isShopifyObject('collection')).toBe(true);
    expect(isShopifyObject('cart')).toBe(true);
    expect(isShopifyObject('shop')).toBe(true);
    expect(isShopifyObject('customer')).toBe(true);
  });

  it('does not flag platformOS objects as Shopify', () => {
    expect(isShopifyObject('context')).toBe(false);
    expect(isShopifyObject('params')).toBe(false);
    expect(isShopifyObject('current_user')).toBe(false);
  });

  it('detects Shopify filters', () => {
    expect(isShopifyFilter('money')).toBe(true);
    expect(isShopifyFilter('money_with_currency')).toBe(true);
    expect(isShopifyFilter('img_tag')).toBe(true);
    expect(isShopifyFilter('link_to')).toBe(true);
  });

  it('does not flag platformOS filters as Shopify', () => {
    expect(isShopifyFilter('json')).toBe(false);
    expect(isShopifyFilter('downcase')).toBe(false);
    expect(isShopifyFilter('t')).toBe(false);
  });
});

// ── Domain rules ─────────────────────────────────────────────────────────────

describe('knowledge-loader: getDomainRule', () => {
  it('returns rule for known domain', () => {
    const rule = getDomainRule('pages');
    expect(rule).toContain('Pages');
  });

  it('returns null for unknown domain', () => {
    expect(getDomainRule('nonexistent')).toBeNull();
  });
});

// ── Language features ────────────────────────────────────────────────────────

describe('knowledge-loader: language features', () => {
  it('returns try_catch feature', () => {
    const f = getLanguageFeature('try_catch');
    expect(f).not.toBeNull();
    expect(f.summary).toContain('try');
    expect(f.syntax).toContain('{% try %}');
    expect(f.notes).toContain('error');
  });

  it('returns theme_render_rc feature', () => {
    const f = getLanguageFeature('theme_render_rc');
    expect(f).not.toBeNull();
    expect(f.syntax).toContain('theme_render_rc');
  });

  it('returns liquid_doc feature with annotations', () => {
    const f = getLanguageFeature('liquid_doc');
    expect(f).not.toBeNull();
    expect(f.annotations).toBeDefined();
    expect(f.annotations['@param']).toContain('NEVER pass null');
    expect(f.annotations['@prompt']).toBeTruthy();
    expect(f.annotations['@example']).toBeTruthy();
    expect(f.annotations['@description']).toBeTruthy();
  });

  it('returns graphql_field_completions feature', () => {
    const f = getLanguageFeature('graphql_field_completions');
    expect(f).not.toBeNull();
    expect(f.notes).toContain('LSP');
  });

  it('returns null for unknown feature', () => {
    expect(getLanguageFeature('nonexistent_feature')).toBeNull();
  });

  it('returns hash_literals feature', () => {
    const f = getLanguageFeature('hash_literals');
    expect(f).not.toBeNull();
    expect(f.summary).toContain('Hash');
    expect(f.syntax).toContain('assign');
    expect(f.replaces).toContain('parse_json');
    expect(f.migration).toBeTruthy();
  });

  it('returns array_literals feature', () => {
    const f = getLanguageFeature('array_literals');
    expect(f).not.toBeNull();
    expect(f.syntax).toContain('[');
    expect(f.replaces).toContain('parse_json');
  });

  it('returns assign_bracket_dot feature', () => {
    const f = getLanguageFeature('assign_bracket_dot');
    expect(f).not.toBeNull();
    expect(f.syntax).toContain('hash["greeting"]');
    expect(f.syntax).toContain('hash.farewell');
    expect(f.replaces).toContain('hash_assign');
  });

  it('returns array_append_operator feature', () => {
    const f = getLanguageFeature('array_append_operator');
    expect(f).not.toBeNull();
    expect(f.syntax).toContain('<<');
  });

  it('returns string_interpolation feature', () => {
    const f = getLanguageFeature('string_interpolation');
    expect(f).not.toBeNull();
    expect(f.requires).toContain('string_interpolation');
    expect(f.notes).toContain('Single-quoted');
  });

  it('returns parse_json_deprecation feature', () => {
    const f = getLanguageFeature('parse_json_deprecation');
    expect(f).not.toBeNull();
    expect(f.severity).toBe('deprecation');
    expect(f.syntax).toContain('assign');
  });

  it('returns hash_assign_deprecation feature', () => {
    const f = getLanguageFeature('hash_assign_deprecation');
    expect(f).not.toBeNull();
    expect(f.severity).toBe('deprecation');
    expect(f.syntax).toContain('assign');
  });
});

// ── Triggered gotchas: new features ──────────────────────────────────────────

describe('knowledge-loader: v0.3.3 feature coverage', () => {
  it('triggers try_catch gotcha when try tag is used', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(),
      tags: new Set(['try']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'pages_try_catch')).toBe(true);
  });

  it('includes null/nil param gotcha for partials', () => {
    const result = getTriggeredGotchas('partials', {
      checks: new Set(),
      tags: new Set(),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'partials_null_param')).toBe(true);
  });
});

// ── Triggered gotchas: deprecation warnings ─────────────────────────────────

describe('knowledge-loader: deprecation gotchas', () => {
  it('triggers parse_json deprecation in pages', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(),
      tags: new Set(['parse_json']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'pages_parse_json_deprecated')).toBe(true);
    const g = result.gotchas.find(g => g.id === 'pages_parse_json_deprecated');
    expect(g.severity).toBe('deprecation');
    expect(g.message).toContain('assign');
  });

  it('triggers hash_assign deprecation in pages', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(),
      tags: new Set(['hash_assign']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'pages_hash_assign_deprecated')).toBe(true);
  });

  it('triggers parse_json deprecation in partials', () => {
    const result = getTriggeredGotchas('partials', {
      checks: new Set(),
      tags: new Set(['parse_json']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'partials_parse_json_deprecated')).toBe(true);
  });

  it('triggers hash_assign deprecation in partials', () => {
    const result = getTriggeredGotchas('partials', {
      checks: new Set(),
      tags: new Set(['hash_assign']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'partials_hash_assign_deprecated')).toBe(true);
  });

  it('triggers parse_json deprecation in commands', () => {
    const result = getTriggeredGotchas('commands', {
      checks: new Set(),
      tags: new Set(['parse_json']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'commands_parse_json_deprecated')).toBe(true);
  });

  it('triggers hash_assign deprecation in commands', () => {
    const result = getTriggeredGotchas('commands', {
      checks: new Set(),
      tags: new Set(['hash_assign']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'commands_hash_assign_deprecated')).toBe(true);
  });

  it('triggers parse_json deprecation in queries', () => {
    const result = getTriggeredGotchas('queries', {
      checks: new Set(),
      tags: new Set(['parse_json']),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'queries_parse_json_deprecated')).toBe(true);
  });

  it('does not trigger parse_json deprecation when tag not used', () => {
    const result = getTriggeredGotchas('pages', {
      checks: new Set(),
      tags: new Set(),
      filters: new Set(),
    });
    expect(result.gotchas.some(g => g.id === 'pages_parse_json_deprecated')).toBe(false);
    expect(result.gotchas.some(g => g.id === 'pages_hash_assign_deprecated')).toBe(false);
  });

  it('config domain includes string_interpolation gotcha', () => {
    const result = getTriggeredGotchas('config', {});
    expect(result.gotchas.some(g => g.id === 'config_string_interpolation')).toBe(true);
    const g = result.gotchas.find(g => g.id === 'config_string_interpolation');
    expect(g.message).toContain('string_interpolation');
  });
});
