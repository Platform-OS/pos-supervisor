/**
 * Diagnostic fingerprint stability — pins the masking algorithm + extracted
 * params for known LSP / structural diagnostic messages.
 *
 * Why this is "upstream": fingerprints are the analytics-layer identity
 * for a diagnostic. Anything that would change them — a tweak to the
 * masking regex in diagnostic-record.js OR an upstream LSP message format
 * change — would silently invalidate every dashboard scorecard that hangs
 * off `template_fp`. This test makes such a change loud:
 *   - if YOU intentionally bumped the masking algorithm, regenerate the
 *     pinned fingerprints below and bump DIAGNOSTIC_RECORD_VERSION
 *   - if the LSP changed its message format, fix the extractor or template
 *     override before bumping (analytics history won't replay otherwise)
 *
 * Hashes are sha1 hex strings so they're deterministic across machines and
 * Bun versions.
 */

import { describe, it, expect } from 'bun:test';
import {
  templateOf,
  templateFingerprint,
  fingerprint,
  extractParams,
  makeDiagnosticRecord,
} from '../../src/core/diagnostic-record.js';

// One row per check we care about. `samples` is the list of distinct LSP
// messages we've observed; they MUST all collapse to the same template_fp.
// `expected_template` and `expected_template_fp` are the pinned values.
const FIXTURES = [
  {
    check: 'MissingPartial',
    samples: [
      "'forms/login' does not exist",
      "'modules/core/_helpers' does not exist",
    ],
    expected_template: '<id> does not exist',
    expected_template_fp: '40c4e1d01f5a7d9a533afd9dd30d5476d3a8f0e7',
    expected_params: { partial: 'forms/login' },
  },
  {
    check: 'UnknownFilter',
    samples: [
      "Unknown filter 'json'",
      "Unknown filter 'totally_made_up'",
    ],
    expected_template: 'Unknown filter <id>',
    expected_template_fp: '8316c722fc77735b0c910d8e641a9738de614bde',
    expected_params: { filter: 'json' },
  },
  {
    check: 'UndefinedObject',
    samples: [
      "The object 'product' is undefined",
      "The object 'context_alias' is undefined",
    ],
    expected_template: 'The object <id> is undefined',
    expected_template_fp: '0c2d6c531571d7b992a04d376506355c49f8c06f',
    expected_params: { variable: 'product' },
  },
  {
    check: 'UnusedAssign',
    samples: [
      "The variable 'x' is assigned but not used",
      "The variable 'tmp_value' is assigned but not used",
    ],
    expected_template: 'The variable <id> is assigned but not used',
    expected_template_fp: '95c4bd44b70db0bd055b71bac359e9f43e657d13',
    expected_params: { variable: 'x' },
  },
  {
    check: 'TranslationKeyExists',
    samples: [
      "Translation key 'foo.bar.baz' not found.",
      "Translation key 'errors.login.invalid' not found.",
    ],
    expected_template: 'Translation key <id> not found.',
    expected_template_fp: '5e8202ce67ec71d879e74ff72794cdf39d86f1d9',
    expected_params: { key: 'foo.bar.baz' },
  },
  {
    check: 'MissingRenderPartialArguments',
    samples: [
      "Missing required argument 'email' in render tag for partial 'sessions/form'",
      "Missing required argument 'name' in render tag for partial 'users/profile'",
    ],
    expected_template: 'Missing required argument <id> in render tag for partial <id>',
    expected_template_fp: 'b11026d409d275c74cced1c558fe6bc551d8316c',
    expected_params: { partial: 'sessions/form', missing_param: 'email' },
  },
  {
    check: 'DeprecatedTag',
    samples: [
      "Tag 'include' is deprecated, use 'render'",
      "Tag 'parse_json' is deprecated, use 'assign'",
    ],
    expected_template: 'Tag <id> is deprecated, use <id>',
    expected_template_fp: 'e90d8c42f0463351bc1cf5f14375afabb43ff4fe',
    expected_params: { tag: 'include', replacement: 'render' },
  },
  {
    check: 'UnknownProperty',
    samples: [
      "Unknown property `name` on `current_user`",
      "Unknown property `slug` on `current_page`",
    ],
    expected_template: 'Unknown property <id> on <id>',
    expected_template_fp: '0da54aaa0a737429a152327283e50e664e899288',
    expected_params: { property: 'name', object: 'current_user' },
  },
  {
    check: 'GraphQLCheck',
    samples: [
      'Cannot query field "name" on type "Record"',
      'Cannot query field "slug" on type "Record"',
    ],
    expected_template: 'Cannot query field <id> on type <id>',
    expected_template_fp: '89868bdc426b9a6b4cb483e67bac42b10ab3ed86',
    expected_params: { category: 'unknown_field_record', field: 'name', type: 'Record' },
  },

  // ── ValidFrontmatter ─ pos-cli 6.0.7 multi-shape check ──────────────────────
  // The check emits 8 distinct shapes. We pin one representative per shape so a
  // template change in any shape is loud. The file-type label (Page/Form/etc.)
  // is intentionally NOT masked — each (category, file_type) pair is a distinct
  // analytics axis. The rule_id (set by the rule engine in core/rules/
  // ValidFrontmatter.js) groups across file types when needed.
  {
    check: 'ValidFrontmatter',
    samples: [
      "Missing required frontmatter field 'name' in Form file",
      "Missing required frontmatter field 'resource' in Form file",
    ],
    expected_template: 'Missing required frontmatter field <id> in Form file',
    expected_template_fp: '91177b77c72d510aedb42cd4d4e4dd275e2843c9',
    expected_params: { category: 'missing_required', field: 'name', file_type: 'Form' },
  },
  {
    check: 'ValidFrontmatter',
    samples: [
      "Unknown frontmatter field 'cache' in Page file",
      "Unknown frontmatter field 'title' in Page file",
    ],
    expected_template: 'Unknown frontmatter field <id> in Page file',
    expected_template_fp: '2461ba62fdf60c6335e84cf44e8f154134df30b5',
    expected_params: { category: 'unknown_field', field: 'cache', file_type: 'Page' },
  },
  {
    check: 'ValidFrontmatter',
    samples: [
      "Layout 'application' does not exist",
      "Layout 'modules/core/admin' does not exist",
    ],
    expected_template: 'Layout <id> does not exist',
    expected_template_fp: '20eb602a8f963006b5123f6e53975a17fdcbdd68',
    expected_params: { category: 'layout_missing', layout: 'application' },
  },
  {
    check: 'ValidFrontmatter',
    samples: [
      "Invalid value 'POST' for 'method'. Must be one of: get, post, put, delete, patch",
      "Invalid value 'PUT' for 'method'. Must be one of: get, post, put, delete, patch",
    ],
    expected_template: 'Invalid value <id> for <id>. Must be one of: get, post, put, delete, patch',
    expected_template_fp: '055be883904858626da77da6c2a3436cabba3dfa',
    expected_params: {
      category: 'invalid_enum',
      value: 'POST',
      field: 'method',
      allowed: 'get, post, put, delete, patch',
    },
  },
  {
    check: 'ValidFrontmatter',
    samples: [
      "'layout_name' is deprecated",
      "'layout_path' is deprecated",
    ],
    expected_template: '<id> is deprecated',
    expected_template_fp: 'f34f5eb90a978fc0c05eccf2846ab86decedda7a',
    expected_params: { category: 'deprecated_field', field: 'layout_name' },
  },
  {
    check: 'ValidFrontmatter',
    samples: [
      "Authorization policy 'guest_only' does not exist",
      "Authorization policy 'admin_only' does not exist",
    ],
    expected_template: 'Authorization policy <id> does not exist',
    expected_template_fp: '21a6e70cef5fe5a0ac1c991425efd284504e7ecb',
    expected_params: { category: 'association_missing', label: 'Authorization policy', name: 'guest_only' },
  },

  // ── JsonLiteralQuoteStyle ─ single-shot constant message ────────────────────
  {
    check: 'JsonLiteralQuoteStyle',
    samples: [
      'Use double quotes for string literals inside object/array literals (e.g. \'{"key": "value"}\', not "{\'key\': \'value\'}").',
    ],
    expected_template: 'Use double quotes for string literals inside object/array literals (e.g. <id>, not <id>).',
    expected_template_fp: '6330c359bab9fa907940ee6b41fc4f4ebef8dace',
    expected_params: {},
  },

  // ── DuplicateFunctionArguments ─ render and function variants ──────────────
  {
    check: 'DuplicateFunctionArguments',
    samples: [
      "Duplicate argument 'foo' in function tag for partial 'helpers/can_do'.",
      "Duplicate argument 'bar' in function tag for partial 'helpers/format'.",
    ],
    expected_template: 'Duplicate argument <id> in function tag for partial <id>.',
    expected_template_fp: '02a96cb3b3010a94fac5eba0d545690f948184bb',
    expected_params: { argument: 'foo', tag_kind: 'function', partial: 'helpers/can_do' },
  },
  {
    check: 'DuplicateFunctionArguments',
    samples: [
      "Duplicate argument 'name' in render tag for partial 'forms/login'.",
      "Duplicate argument 'email' in render tag for partial 'forms/signup'.",
    ],
    expected_template: 'Duplicate argument <id> in render tag for partial <id>.',
    expected_template_fp: '49a0e3b1f5cfdc41996898948d303ecc8fc9d710',
    expected_params: { argument: 'name', tag_kind: 'render', partial: 'forms/login' },
  },
];

// Structural (pos-supervisor:*) checks intentionally have NO mask (the tag
// name in "HTML element <div> in page" is part of the identity, not an
// identifier to collapse). Phase A2 doesn't add structural extractors —
// they fall through to {} and a single-instance fingerprint, which is
// the right behavior for now.

describe('diagnostic-fingerprint: template + extractor pins', () => {
  for (const fix of FIXTURES) {
    describe(fix.check, () => {
      it('first sample produces the pinned message_template', () => {
        expect(templateOf(fix.check, fix.samples[0])).toBe(fix.expected_template);
      });

      it('all samples collapse to the same template_fp', () => {
        const fps = fix.samples.map((m) => templateFingerprint(fix.check, templateOf(fix.check, m)));
        expect(new Set(fps).size).toBe(1);
        expect(fps[0]).toBe(fix.expected_template_fp);
      });

      it('first sample yields the pinned extracted params', () => {
        expect(extractParams(fix.check, fix.samples[0])).toEqual(fix.expected_params);
      });
    });
  }
});

describe('diagnostic-fingerprint: full record assembly', () => {
  it('produces a deterministic fp for (check, file, template)', () => {
    const r1 = makeDiagnosticRecord(
      { check: 'MissingPartial', severity: 'error', message: "'a' does not exist", line: 0, column: 0 },
      { file: 'app/views/pages/x.liquid', source: 'lsp' },
    );
    const r2 = makeDiagnosticRecord(
      { check: 'MissingPartial', severity: 'error', message: "'b' does not exist", line: 99, column: 99 },
      { file: 'app/views/pages/x.liquid', source: 'lsp' },
    );
    expect(r1.fp).toBe(r2.fp);
    expect(r1.fp).toBe(fingerprint('MissingPartial', 'app/views/pages/x.liquid', '<id> does not exist'));
  });

  it('different files diverge fp but share template_fp', () => {
    const r1 = makeDiagnosticRecord(
      { check: 'MissingPartial', severity: 'error', message: "'a' does not exist" },
      { file: 'a.liquid', source: 'lsp' },
    );
    const r2 = makeDiagnosticRecord(
      { check: 'MissingPartial', severity: 'error', message: "'a' does not exist" },
      { file: 'b.liquid', source: 'lsp' },
    );
    expect(r1.fp).not.toBe(r2.fp);
    expect(r1.template_fp).toBe(r2.template_fp);
  });
});
