/**
 * diagnostic-record unit tests — pin the typed builder, the param extractor
 * registry, and the message-template masking algorithm. Fingerprint stability
 * across instances is owned by tests/upstream/diagnostic-fingerprint.test.js;
 * this file focuses on the per-check extraction contract.
 */

import { describe, it, expect } from 'bun:test';
import {
  DIAGNOSTIC_RECORD_VERSION,
  KNOWN_EXTRACTOR_CHECKS,
  makeDiagnosticRecord,
  fingerprint,
  templateFingerprint,
  messageTemplate,
  templateOf,
  extractParams,
} from '../../src/core/diagnostic-record.js';

describe('diagnostic-record: messageTemplate masking', () => {
  it('masks single-quoted identifiers', () => {
    expect(messageTemplate("Variable 'foo' is undefined"))
      .toBe('Variable <id> is undefined');
  });

  it('masks double-quoted identifiers', () => {
    expect(messageTemplate('Cannot find "products/index"'))
      .toBe('Cannot find <id>');
  });

  it('masks backticked identifiers', () => {
    expect(messageTemplate('Use `render` instead of `include`'))
      .toBe('Use <id> instead of <id>');
  });

  it('masks bare integers and floats', () => {
    expect(messageTemplate('Line 42 column 7.5 broken'))
      .toBe('Line <n> column <n> broken');
  });

  it('masks hex literals', () => {
    expect(messageTemplate('Color #fff value 0xff is invalid'))
      .toBe('Color #fff value <n> is invalid');
  });

  it('does not chew embedded numerics inside identifiers', () => {
    // "html5" stays intact (not "html<n>") because the regex is word-anchored.
    expect(messageTemplate('html5 doctype required')).toBe('html5 doctype required');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(messageTemplate('   foo   bar  ')).toBe('foo bar');
  });

  it('returns empty string for non-strings', () => {
    expect(messageTemplate(null)).toBe('');
    expect(messageTemplate(undefined)).toBe('');
    expect(messageTemplate(123)).toBe('');
  });

  it('templateOf falls back to generic mask when no override exists', () => {
    expect(templateOf('UnknownFilter', "Unknown filter 'foo'"))
      .toBe(messageTemplate("Unknown filter 'foo'"));
  });
});

describe('diagnostic-record: fingerprint hashing', () => {
  it('fingerprint is stable for same (check, file, template)', () => {
    const a = fingerprint('MissingPartial', 'app/x.liquid', "Cannot find <id>");
    const b = fingerprint('MissingPartial', 'app/x.liquid', "Cannot find <id>");
    expect(a).toBe(b);
  });

  it('fingerprint differs on file change', () => {
    const a = fingerprint('MissingPartial', 'app/a.liquid', "<id> not found");
    const b = fingerprint('MissingPartial', 'app/b.liquid', "<id> not found");
    expect(a).not.toBe(b);
  });

  it('fingerprint differs on check change', () => {
    const a = fingerprint('MissingPartial', 'app/x.liquid', "<id>");
    const b = fingerprint('UnknownFilter', 'app/x.liquid', "<id>");
    expect(a).not.toBe(b);
  });

  it('templateFingerprint ignores file path entirely', () => {
    const a = templateFingerprint('MissingPartial', '<id> not found');
    const b = templateFingerprint('MissingPartial', '<id> not found');
    expect(a).toBe(b);
  });

  it('templateFingerprint differs from fingerprint', () => {
    const tpl = '<id> not found';
    expect(templateFingerprint('MissingPartial', tpl))
      .not.toBe(fingerprint('MissingPartial', 'a.liquid', tpl));
  });
});

describe('diagnostic-record: extractParams per check', () => {
  it('UnknownFilter: pulls filter name', () => {
    expect(extractParams('UnknownFilter', "Unknown filter 'json'"))
      .toEqual({ filter: 'json' });
  });

  it('UnknownFilter: empty when no quoted name', () => {
    expect(extractParams('UnknownFilter', 'Unknown filter')).toEqual({});
  });

  it('UndefinedObject: pulls variable name', () => {
    expect(extractParams('UndefinedObject', "Variable 'product' is undefined"))
      .toEqual({ variable: 'product' });
  });

  it('UnusedAssign: pulls variable name', () => {
    expect(extractParams('UnusedAssign', "The variable 'x' is assigned but not used"))
      .toEqual({ variable: 'x' });
  });

  it('MissingPartial: pulls partial name', () => {
    expect(extractParams('MissingPartial', "'forms/login' does not exist"))
      .toEqual({ partial: 'forms/login' });
  });

  it('TranslationKeyExists: pulls key + flags typo suggestion', () => {
    expect(extractParams('TranslationKeyExists', "Translation key 'a.b.c' not found. Did you mean 'a.b.cd'?"))
      .toEqual({ key: 'a.b.c', has_typo_suggestion: 'true' });
  });

  it('UnknownProperty: pulls property and object', () => {
    expect(extractParams('UnknownProperty', "Unknown property `name` on `current_user`"))
      .toEqual({ property: 'name', object: 'current_user' });
  });

  it('DeprecatedTag: pulls tag and replacement', () => {
    expect(extractParams('DeprecatedTag', "Tag 'include' is deprecated, use 'render'"))
      .toEqual({ tag: 'include', replacement: 'render' });
  });

  it('DeprecatedTag: include defaults replacement to render', () => {
    expect(extractParams('DeprecatedTag', "'include' is deprecated"))
      .toEqual({ tag: 'include', replacement: 'render' });
  });

  it('MissingRenderPartialArguments: pulls partial + missing param', () => {
    expect(extractParams('MissingRenderPartialArguments',
      "Missing required argument 'email' in render tag for partial 'sessions/form'"))
      .toEqual({ partial: 'sessions/form', missing_param: 'email' });
  });

  it('MetadataParamsCheck: classifies function vs render', () => {
    expect(extractParams('MetadataParamsCheck', 'Missing param in function call'))
      .toEqual({ is_function_call: 'true' });
    expect(extractParams('MetadataParamsCheck', 'Missing param in render tag'))
      .toEqual({ is_function_call: 'false' });
  });

  it('GraphQLCheck: unused variable', () => {
    expect(extractParams('GraphQLCheck', 'Variable "$id" is never used in operation "x"'))
      .toEqual({ category: 'unused_variable', variable: 'id' });
  });

  it('GraphQLCheck: unknown field on Record', () => {
    expect(extractParams('GraphQLCheck', 'Cannot query field "name" on type "Record"'))
      .toEqual({ category: 'unknown_field_record', field: 'name', type: 'Record' });
  });

  it('GraphQLCheck: unknown field on other type', () => {
    expect(extractParams('GraphQLCheck', 'Cannot query field "foo" on type "Bar"'))
      .toEqual({ category: 'unknown_field_other', field: 'foo', type: 'Bar' });
  });

  it('GraphQLCheck: type mismatch (filter)', () => {
    expect(extractParams('GraphQLCheck',
      'Variable "$id" of type "ID!" used in position expecting type "UniqIdFilter"'))
      .toEqual({
        category: 'type_mismatch_filter',
        variable: 'id',
        actual_type: 'ID!',
        expected_type: 'UniqIdFilter',
      });
  });

  it('GraphQLCheck: generic fallback for unrecognized format', () => {
    expect(extractParams('GraphQLCheck', 'Some unknown graphql error'))
      .toEqual({ category: 'generic' });
  });

  it('returns {} for an unknown check', () => {
    expect(extractParams('NotARealCheck', 'whatever')).toEqual({});
  });

  it('exposes the registry of known checks', () => {
    expect(KNOWN_EXTRACTOR_CHECKS).toContain('MissingPartial');
    expect(KNOWN_EXTRACTOR_CHECKS).toContain('GraphQLCheck');
    expect(KNOWN_EXTRACTOR_CHECKS.length).toBeGreaterThan(5);
  });
});

describe('diagnostic-record: makeDiagnosticRecord', () => {
  const RAW = {
    check: 'MissingPartial',
    severity: 'error',
    message: "'forms/login' does not exist",
    line: 12,
    column: 4,
  };

  it('builds a frozen record with v + fp + template_fp + params', () => {
    const r = makeDiagnosticRecord(RAW, { file: 'app/views/pages/x.liquid', source: 'lsp' });
    expect(r.v).toBe(DIAGNOSTIC_RECORD_VERSION);
    expect(r.check).toBe('MissingPartial');
    expect(r.severity).toBe('error');
    expect(r.file).toBe('app/views/pages/x.liquid');
    expect(r.source).toBe('lsp');
    expect(r.message).toBe(RAW.message);
    expect(r.message_template).toBe('<id> does not exist');
    expect(r.params).toEqual({ partial: 'forms/login' });
    expect(typeof r.fp).toBe('string');
    expect(r.fp).toHaveLength(40); // sha1 hex
    expect(typeof r.template_fp).toBe('string');
    expect(r.template_fp).toHaveLength(40);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.position)).toBe(true);
    expect(Object.isFrozen(r.params)).toBe(true);
  });

  it('two records on the same (check, file, template) share fp', () => {
    const a = makeDiagnosticRecord(RAW, { file: 'a.liquid', source: 'lsp' });
    const b = makeDiagnosticRecord(
      { ...RAW, message: "'forms/signup' does not exist" }, // different identifier, same template
      { file: 'a.liquid', source: 'lsp' },
    );
    expect(a.fp).toBe(b.fp);
    expect(a.template_fp).toBe(b.template_fp);
  });

  it('records on different files share template_fp but not fp', () => {
    const a = makeDiagnosticRecord(RAW, { file: 'a.liquid', source: 'lsp' });
    const b = makeDiagnosticRecord(RAW, { file: 'b.liquid', source: 'lsp' });
    expect(a.fp).not.toBe(b.fp);
    expect(a.template_fp).toBe(b.template_fp);
  });

  it('position falls back to 0 when raw has no line/column', () => {
    const r = makeDiagnosticRecord(
      { check: 'MissingPartial', severity: 'error', message: "<id>" },
      { file: 'x.liquid', source: 'lsp' },
    );
    expect(r.position).toEqual({ line: 0, character: 0, end_line: 0, end_character: 0 });
  });

  it('honors explicit end_line / end_character', () => {
    const r = makeDiagnosticRecord(
      { ...RAW, end_line: 14, end_character: 22 },
      { file: 'x.liquid', source: 'lsp' },
    );
    expect(r.position.end_line).toBe(14);
    expect(r.position.end_character).toBe(22);
  });

  it('normalizes numeric LSP severity codes', () => {
    const err = makeDiagnosticRecord({ ...RAW, severity: 1 }, { file: 'x', source: 'lsp' });
    const warn = makeDiagnosticRecord({ ...RAW, severity: 2 }, { file: 'x', source: 'lsp' });
    const info = makeDiagnosticRecord({ ...RAW, severity: 3 }, { file: 'x', source: 'lsp' });
    expect(err.severity).toBe('error');
    expect(warn.severity).toBe('warning');
    expect(info.severity).toBe('info');
  });

  it('throws on missing required fields', () => {
    expect(() => makeDiagnosticRecord(null, { file: 'x', source: 'lsp' })).toThrow();
    expect(() => makeDiagnosticRecord({}, { file: 'x', source: 'lsp' })).toThrow(/check/);
    expect(() => makeDiagnosticRecord(RAW, { source: 'lsp' })).toThrow(/file/);
    expect(() => makeDiagnosticRecord(RAW, { file: 'x' })).toThrow(/source/);
  });

  it('records origin when supplied', () => {
    const r = makeDiagnosticRecord(RAW, {
      file: 'x', source: 'lsp',
      origin: { check_runner_version: '4.5.5', lsp_version: '4.5.5' },
    });
    expect(r.origin).toEqual({ check_runner_version: '4.5.5', lsp_version: '4.5.5' });
  });
});
