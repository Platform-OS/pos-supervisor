// Tier 3 promotion tests — every Bucket B `.unmatched` check that gained a
// rule module in task 3 phase 1. Scope: stable rule_id, structured hint,
// guidance fix that doesn't compete with the existing fix-generator
// heuristic (where one exists). Each describe block targets one check.

import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';

import { rules as UnrecognizedRules } from '../../../src/core/rules/UnrecognizedRenderPartialArguments.js';
import { rules as SchemaPropertyRules } from '../../../src/core/rules/SchemaProperty.js';
import { rules as SchemaYAMLRules } from '../../../src/core/rules/SchemaYAML.js';
import { rules as MissingSlugRules } from '../../../src/core/rules/MissingSlug.js';
import { rules as MissingContentRules } from '../../../src/core/rules/MissingContentForLayout.js';
import { rules as ParserBlockingRules } from '../../../src/core/rules/ParserBlockingScript.js';
import { rules as TranslationLocaleRules } from '../../../src/core/rules/TranslationMissingLocaleKey.js';

describe('UnrecognizedRenderPartialArguments rule', () => {
  beforeEach(() => { clearRules(); registerRules(UnrecognizedRules); });

  test('extracts argument + partial from message and renders concrete options', () => {
    const r = runRules({
      check: 'UnrecognizedRenderPartialArguments',
      params: {},
      message: "Unknown argument 'extra' in render tag for partial 'shared/card'.",
    }, {});
    expect(r.rule_id).toBe('UnrecognizedRenderPartialArguments.default');
    expect(r.hint_md).toContain('`extra`');
    expect(r.hint_md).toContain('`shared/card`');
    expect(r.hint_md).toContain('`@param`');
    // For project partials, all three options (drop / declare / rename) are valid.
    expect(r.hint_md).toContain('Add a matching `@param`');
  });

  test('module partials disable the "add @param" option', () => {
    const r = runRules({
      check: 'UnrecognizedRenderPartialArguments',
      params: {},
      message: "Unknown argument 'params' in render tag for partial 'modules/common-styling/toasts'.",
    }, {});
    expect(r.hint_md).toContain('module partials are read-only');
    expect(r.fixes[0].description).toContain('Module partials are read-only');
  });

  test('falls back gracefully when the message can\'t be parsed', () => {
    const r = runRules({
      check: 'UnrecognizedRenderPartialArguments',
      params: {},
      message: 'unparseable nonsense',
    }, {});
    expect(r.rule_id).toBe('UnrecognizedRenderPartialArguments.default');
    expect(r.hint_md).toContain('the unrecognized argument');
    expect(r.hint_md).toContain('the target partial');
  });
});

describe('SchemaProperty rule', () => {
  beforeEach(() => { clearRules(); registerRules(SchemaPropertyRules); });

  const cases = [
    { msg: 'Property name `created_at` conflicts with built-in field. Built-in fields (id, created_at, updated_at, table) are added automatically.', sub: 'builtin_conflict' },
    { msg: 'Duplicate property name `email`. Property names must be unique within a schema.', sub: 'duplicate_name' },
    { msg: 'Property name `2nd_field` must start with a letter, not a digit.', sub: 'invalid_identifier' },
    { msg: 'Property name `myField` should use snake_case (lowercase letters, numbers, underscores).', sub: 'snake_case' },
    { msg: 'Property `avatar`: Unknown upload option `cdn`. Valid options: acl, max_size, content_type.', sub: 'upload_options' },
    { msg: 'properties[2]: Missing required `name` key.', sub: 'missing_field' },
    { msg: 'Property `email`: `required` is not a schema-level concept in platformOS. Validation must be done in mutations/commands.', sub: 'misleading_key' },
    { msg: 'Property `email`: some unfamiliar message', sub: 'default' },
  ];

  for (const { msg, sub } of cases) {
    test(`routes "${msg.slice(0, 40)}..." → SchemaProperty.${sub}`, () => {
      const r = runRules({ check: 'pos-supervisor:SchemaProperty', params: {}, message: msg }, {});
      expect(r.rule_id).toBe(`SchemaProperty.${sub}`);
      expect(r.fixes).toHaveLength(1);
      expect(r.fixes[0].type).toBe('guidance');
      expect(r.see_also.tool).toBe('domain_guide');
      expect(r.see_also.args.domain).toBe('schema');
    });
  }
});

describe('SchemaYAML rule', () => {
  beforeEach(() => { clearRules(); registerRules(SchemaYAMLRules); });

  test('attaches stable rule_id + hint with common YAML pitfalls', () => {
    const r = runRules({
      check: 'pos-supervisor:SchemaYAML',
      params: {},
      message: 'Invalid YAML syntax: expected a single document in the stream',
    }, {});
    expect(r.rule_id).toBe('SchemaYAML.default');
    expect(r.hint_md).toContain('Single document only');
    expect(r.hint_md).toContain('Indentation mismatch');
    expect(r.see_also.args.domain).toBe('schema');
  });
});

describe('MissingSlug rule', () => {
  beforeEach(() => { clearRules(); registerRules(MissingSlugRules); });

  test('promotes to stable rule_id and emits guidance only (heuristic owns text_edit)', () => {
    const r = runRules({
      check: 'pos-supervisor:MissingSlug',
      params: {},
      message: 'Page is missing `slug` in front matter.',
    }, {});
    expect(r.rule_id).toBe('MissingSlug.default');
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].type).toBe('guidance');
    expect(r.hint_md).toContain('kebab-case');
    expect(r.hint_md).toContain(':param');
    expect(r.see_also.args.domain).toBe('pages');
  });
});

describe('MissingContentForLayout rule', () => {
  beforeEach(() => { clearRules(); registerRules(MissingContentRules); });

  test('promotes to stable rule_id and explains content_for_layout vs yield', () => {
    const r = runRules({
      check: 'pos-supervisor:MissingContentForLayout',
      params: {},
      message: 'Layout is missing `{{ content_for_layout }}`.',
    }, {});
    expect(r.rule_id).toBe('MissingContentForLayout.default');
    expect(r.hint_md).toContain('`{{ content_for_layout }}`');
    expect(r.hint_md).toContain('{% yield');
    expect(r.fixes[0].type).toBe('guidance');
    expect(r.see_also.args.domain).toBe('layouts');
  });
});

describe('ParserBlockingScript rule', () => {
  beforeEach(() => { clearRules(); registerRules(ParserBlockingRules); });

  test('emits decision tree (defer / async / end-of-body)', () => {
    const r = runRules({
      check: 'ParserBlockingScript',
      params: {},
      message: 'Avoid parser blocking scripts by adding `defer` or `async`',
    }, {});
    expect(r.rule_id).toBe('ParserBlockingScript.default');
    expect(r.hint_md).toContain('defer');
    expect(r.hint_md).toContain('async');
    expect(r.fixes[0].description).toContain('defer');
  });
});

describe('TranslationMissingLocaleKey rule', () => {
  beforeEach(() => { clearRules(); registerRules(TranslationLocaleRules); });

  test('extracts locale from message and emits before/after YAML example', () => {
    const r = runRules({
      check: 'pos-supervisor:TranslationMissingLocaleKey',
      params: {},
      message: "Translation file has no top-level locale key. Top-level keys found: app. Wrap the entire tree in the file's locale (e.g. `en:`) — platformOS indexes translations by locale at the root.",
    }, {});
    expect(r.rule_id).toBe('TranslationMissingLocaleKey.default');
    expect(r.hint_md).toMatch(/Wrap the entire tree under `en:`/);
    expect(r.hint_md).toContain('# BEFORE');
    expect(r.hint_md).toContain('# AFTER');
    // Extracted locale appears in the generated example.
    expect(r.hint_md).toMatch(/^en:/m);
    expect(r.see_also.args.domain).toBe('translations');
  });

  test('handles non-en locales (de, pt-BR)', () => {
    const r = runRules({
      check: 'pos-supervisor:TranslationMissingLocaleKey',
      params: {},
      message: "Translation file has no top-level locale key. Top-level keys found: app. Wrap the entire tree in the file's locale (e.g. `pt-BR:`) — platformOS indexes translations by locale at the root.",
    }, {});
    expect(r.hint_md).toMatch(/Wrap the entire tree under `pt-BR:`/);
    expect(r.hint_md).toMatch(/^pt-BR:/m);
  });

  test('falls back to `en` when locale hint missing from message', () => {
    const r = runRules({
      check: 'pos-supervisor:TranslationMissingLocaleKey',
      params: {},
      message: 'Translation file has no top-level locale key.',
    }, {});
    expect(r.hint_md).toMatch(/Wrap the entire tree under `en:`/);
  });
});
