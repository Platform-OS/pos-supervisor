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
  test('falls through to .default when key param is missing', () => {
    const diag = { check: 'TranslationKeyExists', params: {} };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('TranslationKeyExists.default');
  });
});

describe('TranslationKeyExists.default catch-all', () => {
  test('does NOT preempt .array_index_misuse', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'app.title[0]' },
      message: "'app.title[0]' does not have a matching translation entry",
    };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
  });

  test('does NOT preempt .suggest_nearest', () => {
    const diag = { check: 'TranslationKeyExists', params: { key: 'app.titl' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.suggest_nearest');
  });

  test('does NOT preempt .create_key for a brand-new key with no near matches', () => {
    const diag = { check: 'TranslationKeyExists', params: { key: 'a.completely.disjoint.brand_new.key' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('TranslationKeyExists.create_key');
  });

  test('fires when extraction failed entirely', () => {
    const diag = { check: 'TranslationKeyExists' };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('TranslationKeyExists.default');
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  test('hint warns against locale-prefix typos and points at app/translations/', () => {
    const diag = { check: 'TranslationKeyExists' };
    const result = runRules(diag, facts);
    expect(result.hint_md).toContain('app/translations/');
    expect(result.hint_md).toContain('| t');
    expect(result.hint_md).toContain('locale');
  });
});

// Realistic translations shape — what `flattenYaml` actually emits when the
// YAML root is `en:` (the platformOS-required wrapper). Every key carries
// the locale prefix.
const realisticGraph = buildFactGraph({
  pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {},
  translations: {
    en: {
      'en.landing.problem.items': ['a', 'b'],
      'en.landing.problem.title': 'Problem',
      'en.landing.proof.title': 'Proof',
      'en.app.user.title': 'User',
      'en.app.user.name': 'Name',
    },
  },
  assets: [],
});
const realisticFacts = { graph: realisticGraph };

describe('TranslationKeyExists.suggest_nearest — locale-prefix correctness', () => {
  test('hint emits bare keys (no `en.` prefix) for graph keys built from realistic YAML', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'app.usr.title' },
      message: "'app.usr.title' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.suggest_nearest');
    // Suggested key must NOT carry the `en.` prefix — Liquid's `| t` filter
    // re-prepends the locale, so suggesting `en.app.user.title` makes the
    // agent's call resolve to `en.en.app.user.title` and fail again.
    expect(result.hint_md).toContain('app.user.title');
    expect(result.hint_md).not.toMatch(/`en\.app\.user\.title`/);
    expect(result.fixes[0].description).not.toMatch(/`en\.app\.user\.title`/);
  });

  test('hint warns explicitly against including the locale prefix', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'app.usr.title' },
      message: "'app.usr.title' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.hint_md).toMatch(/do NOT include `en\.`/i);
  });

  test('agent supplied an `en.`-prefixed key — rule strips it before matching', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'en.app.usr.title' },
      message: "'en.app.usr.title' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.suggest_nearest');
    expect(result.hint_md).toContain('app.user.title');
  });

  test('brand-new key with no close match falls through to create_key (stricter threshold)', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'app.brand_new_feature.label' },
      message: "'app.brand_new_feature.label' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.create_key');
  });

  test('one-character typo on a real key still suggests', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'app.user.namee' },
      message: "'app.user.namee' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.suggest_nearest');
    expect(result.hint_md).toContain('app.user.name');
  });
});

describe('TranslationKeyExists.create_key — locale-prefix correctness', () => {
  test('agent-supplied `en.` prefix is stripped before YAML emission', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'en.products.heading' },
      message: "'en.products.heading' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.create_key');
    // The YAML snippet nests under `products:` (NOT `en: products:`) because
    // the file already has the `en:` root and prepending again would create
    // `en.en.products.heading` at lookup time.
    expect(result.hint_md).toMatch(/^products:/m);
    expect(result.hint_md).not.toMatch(/^en:\s*\n\s*products:/m);
  });

  test('clarifies the YAML must nest under the existing `en:` root', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'app.greeting' },
      message: "'app.greeting' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.fixes[0].description).toMatch(/nested under the existing `en:` root/);
  });
});

describe('TranslationKeyExists.array_index_misuse — defensive gate', () => {
  test('hint suggests bare arrayKey even when agent prefixed with `en.`', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'en.landing.problem.items[2]' },
      message: "'en.landing.problem.items[2]' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
    // The `assign items = '...'` snippet must NOT include `en.` — the agent
    // would otherwise write `'en.landing.problem.items' | t` and re-trigger
    // the prefix double-up.
    expect(result.hint_md).toMatch(/assign items = 'landing\.problem\.items'/);
    expect(result.hint_md).not.toMatch(/assign items = 'en\.landing\.problem\.items'/);
  });

  test('raw-message gate: catches `[N]` even when params.key extraction loses it', () => {
    // Belt-and-suspenders: if the extractor ever drops the bracket from
    // params.key (LSP shape change, encoding bug), the raw-message regex
    // still routes to array_index_misuse instead of letting suggest_nearest
    // emit a misleading parent-key suggestion.
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'landing.problem.items' },               // no [N] in params
      message: "'landing.problem.items[3]' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
  });

  test('suggest_nearest is gated by raw-message regex too', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'landing.problem.items' },
      message: "'landing.problem.items[3]' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    // Even though params.key has no [N] and is Levenshtein-close to a real key,
    // the rule must defer to array_index_misuse via the raw-message gate.
    expect(result.rule_id).not.toBe('TranslationKeyExists.suggest_nearest');
  });

  test('create_key is gated by raw-message regex too', () => {
    const diag = {
      check: 'TranslationKeyExists',
      params: { key: 'something_unrelated' },
      message: "'something_unrelated[0]' does not have a matching translation entry",
    };
    const result = runRules(diag, realisticFacts);
    expect(result.rule_id).toBe('TranslationKeyExists.array_index_misuse');
  });
});
