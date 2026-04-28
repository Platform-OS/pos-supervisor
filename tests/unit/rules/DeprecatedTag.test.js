import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/DeprecatedTag.js';

beforeEach(() => { clearRules(); registerRules(rules); });

describe('DeprecatedTag rule (upstream LSP)', () => {
  test('include subrule fires on params.tag', () => {
    const result = runRules({
      check: 'DeprecatedTag',
      params: { tag: 'include', replacement: 'render' },
      message: "Deprecated tag 'include': replaced by render",
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.include');
    expect(result.hint_md).toContain('isolated scope');
    expect(result.fixes[0].description).toContain('render');
  });

  test('hash_assign subrule fires on params.tag', () => {
    const result = runRules({
      check: 'DeprecatedTag',
      params: { tag: 'hash_assign' },
      message: "Deprecated tag 'hash_assign'",
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.hash_assign');
    expect(result.hint_md).toContain('assign x["key"]');
  });

  test('parse_json subrule fires on params.tag', () => {
    const result = runRules({
      check: 'DeprecatedTag',
      params: { tag: 'parse_json' },
      message: "Deprecated tag 'parse_json'",
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.parse_json');
    expect(result.hint_md).toContain('| parse_json');
    expect(result.hint_md).toContain('capture');
  });

  test('falls through to default for unknown deprecated tag', () => {
    const result = runRules({
      check: 'DeprecatedTag',
      params: { tag: 'foobar' },
      message: "Deprecated tag 'foobar'",
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.default');
  });

  test('default rule reads tag/replacement from params when present', () => {
    const result = runRules({
      check: 'DeprecatedTag',
      params: { tag: 'foobar', replacement: 'baz' },
      message: 'irrelevant',
    }, {});
    expect(result.hint_md).toContain('`{% foobar %}`');
    expect(result.hint_md).toContain('Use `{% baz %}` instead.');
  });
});

describe('DeprecatedTag rule (pos-supervisor structural variant)', () => {
  test('include subrule fires on raw message even without params.tag', () => {
    // structural-warnings emits messages WITHOUT populating params.tag
    // (no extractor for `pos-supervisor:DeprecatedTag` in diagnostic-record).
    // The raw-message gate must catch it.
    const result = runRules({
      check: 'pos-supervisor:DeprecatedTag',
      params: {},
      message: '`{% include %}` is deprecated. Use `{% render %}` instead — render has isolated scope.',
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.include');
  });

  test('hash_assign subrule fires on raw message', () => {
    const result = runRules({
      check: 'pos-supervisor:DeprecatedTag',
      params: {},
      message: '`{% hash_assign %}` is deprecated. Use `{% assign var["key"] = "value" %}`.',
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.hash_assign');
  });

  test('parse_json subrule fires on raw message', () => {
    const result = runRules({
      check: 'pos-supervisor:DeprecatedTag',
      params: {},
      message: '`{% parse_json %}` is deprecated.',
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.parse_json');
  });

  test('default fires when no known tag matches', () => {
    const result = runRules({
      check: 'pos-supervisor:DeprecatedTag',
      params: {},
      message: '`{% future_tag %}` is deprecated.',
    }, {});
    expect(result.rule_id).toBe('DeprecatedTag.default');
  });
});

describe('DeprecatedTag rule — guidance-only fix policy', () => {
  test('every subrule emits a single guidance fix (heuristic owns text_edit)', () => {
    for (const tag of ['include', 'hash_assign', 'parse_json']) {
      const result = runRules({
        check: 'DeprecatedTag',
        params: { tag },
        message: `Deprecated tag '${tag}'`,
      }, {});
      expect(result.fixes).toHaveLength(1);
      expect(result.fixes[0].type).toBe('guidance');
    }
  });

  test('default fallback emits no fix — no actionable next step without a known tag', () => {
    const result = runRules({
      check: 'DeprecatedTag',
      params: { tag: 'foobar' },
      message: 'irrelevant',
    }, {});
    expect(result.fixes).toEqual([]);
  });
});
