// InvalidLayout end-to-end coverage:
//   1. structural emitter detects the project's layout-extension convention
//      and bakes the right `Expected file:` path into the message.
//   2. fix-generator's `extractLayoutPath` lifts that path verbatim.
//   3. The new `InvalidLayout.default` rule attaches a stable rule_id +
//      create_file fix that lands at the correct path.
//   4. `suppressUpstreamFrontmatterDup` drops the upstream
//      `ValidFrontmatter.layout_missing` even when its line diverges from
//      our structural emission — matched by layout NAME, not just line.

import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules as InvalidLayoutRules } from '../../../src/core/rules/InvalidLayout.js';
import { generateStructuralWarnings } from '../../../src/core/structural-warnings.js';
import { suppressUpstreamFrontmatterDup } from '../../../src/core/diagnostic-pipeline.js';
import { parseLiquidFile, extractAllFromAST } from '../../../src/core/liquid-parser.js';

beforeEach(() => { clearRules(); registerRules(InvalidLayoutRules); });

function emit(projectDir, content, file = 'app/views/pages/x.liquid') {
  const ast = parseLiquidFile(content);
  const structural = extractAllFromAST(ast);
  return generateStructuralWarnings(ast, content, file, structural, new Set(), { projectDir });
}

describe('InvalidLayout — structural emitter detects layout extension', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'invalid-layout-'));
    mkdirSync(join(dir, 'app/views/layouts'), { recursive: true });
    // Project uses BARE .liquid (DEMO convention).
    writeFileSync(join(dir, 'app/views/layouts/application.liquid'), '<html>{{ content_for_layout }}</html>');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('emitter picks `.liquid` extension when project uses bare suffix', () => {
    const ws = emit(dir, '---\nlayout: nonexistent\n---\n<h1>x</h1>');
    const inv = ws.find(w => w.check === 'pos-supervisor:InvalidLayout');
    expect(inv).toBeDefined();
    expect(inv.message).toContain('app/views/layouts/nonexistent.liquid');
    expect(inv.message).not.toContain('nonexistent.html.liquid');
  });

  test('rule lifts the corrected path into the create_file fix', () => {
    const ws = emit(dir, '---\nlayout: nonexistent\n---\n<h1>x</h1>');
    const inv = ws.find(w => w.check === 'pos-supervisor:InvalidLayout');
    const r = runRules({ check: inv.check, message: inv.message }, {});
    expect(r.rule_id).toBe('InvalidLayout.default');
    expect(r.fixes[0].type).toBe('create_file');
    expect(r.fixes[0].path).toBe('app/views/layouts/nonexistent.liquid');
    expect(r.fixes[0].path).not.toContain('html.liquid');
  });
});

describe('InvalidLayout — emitter picks `.html.liquid` when project uses it', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'invalid-layout-html-'));
    mkdirSync(join(dir, 'app/views/layouts'), { recursive: true });
    writeFileSync(join(dir, 'app/views/layouts/application.html.liquid'), '<html>{{ content_for_layout }}</html>');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('extension matches the existing convention', () => {
    const ws = emit(dir, '---\nlayout: nonexistent\n---\n<h1>x</h1>');
    const inv = ws.find(w => w.check === 'pos-supervisor:InvalidLayout');
    expect(inv.message).toContain('nonexistent.html.liquid');
  });
});

describe('InvalidLayout — defaults to `.liquid` when layouts dir is empty', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'invalid-layout-empty-'));
    mkdirSync(join(dir, 'app/views/layouts'), { recursive: true });
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('no existing layouts → bare suffix (modern convention)', () => {
    const ws = emit(dir, '---\nlayout: app\n---\n<h1>x</h1>');
    const inv = ws.find(w => w.check === 'pos-supervisor:InvalidLayout');
    expect(inv.message).toContain('app/views/layouts/app.liquid');
  });
});

describe('suppressUpstreamFrontmatterDup — by layout name, line-independent', () => {
  test('drops ValidFrontmatter `layout_missing` when InvalidLayout names same layout, even on different lines', () => {
    const result = {
      errors: [],
      warnings: [
        {
          check: 'pos-supervisor:InvalidLayout',
          severity: 'warning',
          message: 'Layout `application` not found. Expected file: `app/views/layouts/application.liquid`.',
          line: 2,
          column: 0,
        },
        {
          check: 'ValidFrontmatter',
          severity: 'warning',
          message: "Layout 'application' does not exist",
          line: 99,                      // intentionally NOT 2 — would survive line-only dedup
          column: 0,
        },
      ],
      infos: [],
    };
    const removed = suppressUpstreamFrontmatterDup(result);
    expect(removed).toBe(1);
    expect(result.warnings.map(w => w.check)).toEqual(['pos-supervisor:InvalidLayout']);
    expect(result.infos[0].message).toContain('Suppressed 1 ValidFrontmatter');
  });

  test('keeps unrelated ValidFrontmatter (different layout name)', () => {
    const result = {
      errors: [],
      warnings: [
        { check: 'pos-supervisor:InvalidLayout', message: 'Layout `application` not found. Expected file: `app/views/layouts/application.liquid`.', line: 2 },
        { check: 'ValidFrontmatter', message: "Layout 'other_layout' does not exist", line: 5 },
      ],
      infos: [],
    };
    suppressUpstreamFrontmatterDup(result);
    expect(result.warnings.map(w => w.check)).toEqual(['pos-supervisor:InvalidLayout', 'ValidFrontmatter']);
  });

  test('keeps non-layout ValidFrontmatter categories (deprecated_field, missing_required, etc.)', () => {
    const result = {
      errors: [],
      warnings: [
        { check: 'pos-supervisor:InvalidLayout', message: 'Layout `application` not found. Expected file: `app/views/layouts/application.liquid`.', line: 2 },
        { check: 'ValidFrontmatter', message: 'Missing required frontmatter field `slug` in Page file', line: 1 },
        { check: 'ValidFrontmatter', message: '`layout_name` is deprecated. Use `layout` instead.', line: 3 },
      ],
      infos: [],
    };
    suppressUpstreamFrontmatterDup(result);
    expect(result.warnings.map(w => w.message.slice(0, 30))).toEqual([
      'Layout `application` not found',
      'Missing required frontmatter f',
      '`layout_name` is deprecated. U',
    ]);
  });

  test('still dedups on line match when layout-name match is unavailable', () => {
    // pos-supervisor:InvalidFrontMatter (NOT InvalidLayout) — line is the
    // only signal the dedup has for this pair.
    const result = {
      errors: [],
      warnings: [
        { check: 'pos-supervisor:InvalidFrontMatter', message: 'Unknown front-matter key', line: 4 },
        { check: 'ValidFrontmatter', message: 'Unknown frontmatter field `weird` in Page file', line: 4 },
      ],
      infos: [],
    };
    const removed = suppressUpstreamFrontmatterDup(result);
    expect(removed).toBe(1);
    expect(result.warnings.map(w => w.check)).toEqual(['pos-supervisor:InvalidFrontMatter']);
  });
});

describe('InvalidLayout rule — defensive paths', () => {
  test('falls back to guidance when message lacks the Expected-file clause', () => {
    const r = runRules({
      check: 'pos-supervisor:InvalidLayout',
      message: 'Layout `app` was not found.',          // no `Expected file:` clause
    }, {});
    expect(r.rule_id).toBe('InvalidLayout.default');
    expect(r.fixes[0].type).toBe('guidance');
  });

  test('see_also points at layouts domain guide', () => {
    const r = runRules({
      check: 'pos-supervisor:InvalidLayout',
      message: 'Layout `app` not found. Expected file: `app/views/layouts/app.liquid`.',
    }, {});
    expect(r.see_also.tool).toBe('domain_guide');
    expect(r.see_also.args.domain).toBe('layouts');
  });
});
