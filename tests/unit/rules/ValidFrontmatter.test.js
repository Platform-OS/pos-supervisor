/**
 * ValidFrontmatter rule attribution + hint routing per category.
 *
 * Each category in the rule module dispatches on `diag.params.category`
 * (set by the EXTRACTOR in core/diagnostic-record.js). These tests pin:
 *   - The right rule fires for each category.
 *   - Hint content surfaces the field/file_type/value the agent needs.
 *   - The fallback rule covers the unknown shape so every emit is attributed.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/ValidFrontmatter.js';

const facts = {}; // Frontmatter rules don't depend on fact graph.

beforeEach(() => { clearRules(); registerRules(rules); });
afterEach(() => { clearRules(); });

function diag(category, extra = {}) {
  return {
    check: 'ValidFrontmatter',
    params: { category, ...extra },
    message: '',
    file: 'app/views/pages/x.liquid',
    line: 3,
    column: 0,
  };
}

describe('ValidFrontmatter.home_deprecated', () => {
  test('attributes home-rename diagnostics', () => {
    const r = runRules(diag('home_deprecated'), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.home_deprecated');
    expect(r.hint_md).toMatch(/index\.html\.liquid/);
    expect(r.confidence).toBe(0.85);
  });
});

describe('ValidFrontmatter.missing_required', () => {
  test('names the required field and file type in the hint', () => {
    const r = runRules(diag('missing_required', { field: 'name', file_type: 'Form' }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.missing_required');
    expect(r.hint_md).toMatch(/`name`/);
    expect(r.hint_md).toMatch(/Form/);
    expect(r.see_also?.tool).toBe('domain_guide');
  });

  test('falls back gracefully when file_type is unknown', () => {
    const r = runRules(diag('missing_required', { field: 'method' }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.missing_required');
    expect(r.hint_md).toMatch(/`method`/);
  });
});

describe('ValidFrontmatter.unknown_field', () => {
  test('names the offending key', () => {
    const r = runRules(diag('unknown_field', { field: 'cache', file_type: 'Page' }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.unknown_field');
    expect(r.hint_md).toMatch(/`cache`/);
  });
});

describe('ValidFrontmatter.deprecated_field', () => {
  test('names the deprecated key', () => {
    const r = runRules(diag('deprecated_field', { field: 'layout_name' }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.deprecated_field');
    expect(r.hint_md).toMatch(/`layout_name`/);
  });
});

describe('ValidFrontmatter.invalid_enum', () => {
  test('uppercase HTTP method gets case-canonicalisation guidance', () => {
    const r = runRules(diag('invalid_enum', {
      field: 'method',
      value: 'POST',
      allowed: 'get, post, put, delete, patch',
    }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.invalid_enum');
    // Canonical-case suggestion ('post') surfaces in the hint.
    expect(r.hint_md).toMatch(/`post`/);
  });

  test('truly out-of-range value gets allowed-list guidance', () => {
    const r = runRules(diag('invalid_enum', {
      field: 'method',
      value: 'connect',
      allowed: 'get, post, put, delete, patch',
    }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.invalid_enum');
    expect(r.hint_md).toMatch(/get, post, put, delete, patch/);
  });
});

describe('ValidFrontmatter.layout_false', () => {
  test('explains the YAML-boolean footgun', () => {
    const r = runRules(diag('layout_false'), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.layout_false');
    expect(r.hint_md).toMatch(/`layout: ''`/);
    expect(r.confidence).toBe(0.9);
  });
});

describe('ValidFrontmatter.layout_missing', () => {
  test('app-level layout produces the canonical expected path', () => {
    const r = runRules(diag('layout_missing', { layout: 'application' }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.layout_missing');
    expect(r.hint_md).toMatch(/app\/views\/layouts\/application\./);
  });

  test('module-prefixed layout produces the module expected path', () => {
    const r = runRules(diag('layout_missing', { layout: 'modules/core/admin' }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.layout_missing');
    expect(r.hint_md).toMatch(/modules\/core\/public\/views\/layouts\/admin\./);
  });
});

describe('ValidFrontmatter.association_missing', () => {
  test('preserves the upstream label', () => {
    const r = runRules(diag('association_missing', {
      label: 'Authorization policy',
      name: 'guest_only',
    }), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.association_missing');
    expect(r.hint_md).toMatch(/Authorization policy/);
    expect(r.hint_md).toMatch(/`guest_only`/);
  });
});

describe('ValidFrontmatter.fallback', () => {
  test('attributes unknown shapes (so analytics never see .unmatched)', () => {
    const r = runRules(diag('unknown'), facts);
    expect(r.rule_id).toBe('ValidFrontmatter.fallback');
    expect(r.confidence).toBe(0.5);
  });

  test('also catches diagnostics with no params at all', () => {
    const r = runRules({ check: 'ValidFrontmatter', message: 'mystery message' }, facts);
    expect(r.rule_id).toBe('ValidFrontmatter.fallback');
  });
});
