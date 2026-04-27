import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/TranslationKeyExists.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

const graph = buildFactGraph({
  pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {},
  translations: { en: { 'app.title': 'Blog', 'app.subtitle': 'Posts', 'common.save': 'Save', 'common.cancel': 'Cancel' } },
  assets: [],
});
const facts = { graph };

beforeEach(() => { clearRules(); registerRules(rules); });

describe('TranslationKeyExists.suggest_nearest', () => {
  test('suggests similar keys', () => {
    const diag = { check: 'TranslationKeyExists', params: { key: 'app.titl' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.suggest_nearest');
    expect(result.hint_md).toContain('app.title');
  });

  test('suggests from common namespace', () => {
    const diag = { check: 'TranslationKeyExists', params: { key: 'common.sav' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.suggest_nearest');
    expect(result.hint_md).toContain('common.save');
  });
});

describe('TranslationKeyExists.create_key', () => {
  test('suggests creating new key with YAML snippet', () => {
    const diag = { check: 'TranslationKeyExists', params: { key: 'products.new.heading' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.create_key');
    expect(result.hint_md).toContain('products');
    expect(result.hint_md).toContain('heading');
    expect(result.hint_md).toContain('en.yml');
  });

  test('handles single-segment key', () => {
    const diag = { check: 'TranslationKeyExists', params: { key: 'greeting' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.create_key');
    expect(result.hint_md).toContain('greeting');
  });
});

describe('TranslationKeyExists.array_index_misuse', () => {
  test('fires on `key[0]` and provides iteration guidance instead of nearest', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'landing.problem.items[0]' },
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
    // Hint references the canonical iteration pattern, NOT a "did you mean" suggestion.
    expect(result.hint_md).toMatch(/assign items/);
    expect(result.hint_md).toMatch(/landing\.problem\.items/);
    // The arrayKey reference must NOT carry the [0] suffix.
    expect(result.hint_md).not.toMatch(/landing\.problem\.items\[0\]['"]\s*\| t/);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].type).toBe('guidance');
    expect(result.fixes[0].description).toMatch(/\{% for item in items %\}/);
    expect(result.confidence).toBe(0.9);
  });

  test('also catches multi-segment indices (`items[12]`)', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'landing.problem.items[12]' },
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
  });

  test('suggest_nearest does NOT fire for indexed keys (would be misleading)', () => {
    // Even with a Levenshtein-close parent key in the graph, the array-index
    // rule wins by priority. The suggest_nearest path is gated by an explicit
    // check so it never produces "did you mean en.parent.items".
    const indexedFacts = {
      graph: buildFactGraph({
        pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {},
        translations: { en: { 'landing.problem.items': ['a', 'b'] } },
        assets: [],
      }),
    };
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'landing.problem.items[0]' },
    };
    const result = runRules(diag, indexedFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
    expect(result.rule_id).not.toBe('TranslationKeyExists.suggest_nearest');
  });

  test('create_key does NOT fire for indexed keys (would propose nonsense YAML)', () => {
    // Empty translations graph forces create_key to be the only otherwise-eligible rule.
    // Array-index rule must still win.
    const emptyFacts = {
      graph: buildFactGraph({
        pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {},
        translations: {}, assets: [],
      }),
    };
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'landing.problem.items[0]' },
    };
    const result = runRules(diag, emptyFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
  });
});

describe('TranslationKeyExists — edge cases', () => {
  test('returns null when key param is missing', () => {
    const diag = { check: 'TranslationKeyExists', params: {} };
    expect(runRules(diag, facts)).toBeNull();
  });
});
