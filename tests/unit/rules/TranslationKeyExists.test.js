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

describe('TranslationKeyExists — edge cases', () => {
  test('returns null when key param is missing', () => {
    const diag = { check: 'TranslationKeyExists', params: {} };
    expect(runRules(diag, facts)).toBeNull();
  });
});
