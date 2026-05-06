// Tier 3 phase 2 — Levenshtein + structural rule modules:
// MissingAsset, OrphanedPartial, MissingPage, LiquidHTMLSyntaxError.

import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

import { rules as MissingAssetRules } from '../../../src/core/rules/MissingAsset.js';
import { rules as OrphanedPartialRules } from '../../../src/core/rules/OrphanedPartial.js';
import { rules as MissingPageRules } from '../../../src/core/rules/MissingPage.js';
import { rules as LiquidHTMLSyntaxErrorRules } from '../../../src/core/rules/LiquidHTMLSyntaxError.js';

describe('MissingAsset rule', () => {
  const graph = buildFactGraph({
    pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {},
    assets: ['images/logo.png', 'styles/main.css', 'styles/main.scss', 'scripts/app.js'],
  });
  const facts = { graph };

  beforeEach(() => { clearRules(); registerRules(MissingAssetRules); });

  test('subdir_prefix: bare filename matching a known-subdir asset → fix the reference', () => {
    const r = runRules({ check: 'MissingAsset', message: "'logo.png' does not exist" }, facts);
    expect(r.rule_id).toBe('MissingAsset.missing_subdir_prefix');
    expect(r.hint_md).toContain('images/logo.png');
    expect(r.fixes[0].description).toContain('images/logo.png');
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  test('suggest_nearest: typo in subdir asset → Levenshtein candidates', () => {
    const r = runRules({ check: 'MissingAsset', message: "'styles/maain.css' does not exist" }, facts);
    expect(r.rule_id).toBe('MissingAsset.suggest_nearest');
    expect(r.hint_md).toContain('styles/main.css');
  });

  test('create_file: no near match → propose creation, lower confidence', () => {
    const r = runRules({ check: 'MissingAsset', message: "'foo/bar.css' does not exist" }, facts);
    expect(r.rule_id).toBe('MissingAsset.create_file');
    expect(r.confidence).toBeLessThanOrEqual(0.7);
  });

  test('subdir_prefix only fires for known asset subdirs (avoids false matches)', () => {
    const stranger = buildFactGraph({
      pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {},
      assets: ['vendor/data/logo.png'],   // NOT under known subdir
    });
    clearRules(); registerRules(MissingAssetRules);
    const r = runRules({ check: 'MissingAsset', message: "'logo.png' does not exist" }, { graph: stranger });
    // Should NOT match subdir_prefix — `vendor` is not in KNOWN_ASSET_SUBDIRS.
    // Falls through to suggest_nearest (or create_file if no Levenshtein match).
    expect(r.rule_id).not.toBe('MissingAsset.missing_subdir_prefix');
  });
});

describe('OrphanedPartial rule', () => {
  beforeEach(() => { clearRules(); registerRules(OrphanedPartialRules); });

  test('partial with zero callers → propose delete_file + guidance', () => {
    const graph = buildFactGraph({
      pages: {}, partials: {
        'foo/orphan': { path: 'app/views/partials/foo/orphan.liquid', params: [], renders: [], render_calls: [], function_calls: [], rendered_by: [] },
      }, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
    });
    const r = runRules({
      check: 'OrphanedPartial',
      file: 'app/views/partials/foo/orphan.liquid',
      message: 'This partial is not referenced by any other files',
    }, { graph });
    expect(r.rule_id).toBe('OrphanedPartial.default');
    expect(r.fixes.some(f => f.type === 'delete_file')).toBe(true);
    expect(r.fixes.some(f => f.type === 'guidance')).toBe(true);
    expect(r.hint_md).toContain('Work in progress');
    expect(r.hint_md).toContain('pending_files');
  });

  test('layout with no callers → softer guidance, no delete_file', () => {
    const graph = buildFactGraph({
      pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {},
      layouts: {
        'app/views/layouts/unused.liquid': { path: 'app/views/layouts/unused.liquid', renders: [], render_calls: [], function_calls: [] },
      },
      translations: {}, assets: [],
    });
    const r = runRules({
      check: 'OrphanedPartial',
      file: 'app/views/layouts/unused.liquid',
      message: 'This partial is not referenced by any other files',
    }, { graph });
    expect(r.rule_id).toBe('OrphanedPartial.default');
    expect(r.fixes.some(f => f.type === 'delete_file')).toBe(false);
    expect(r.hint_md).toContain('layout');
  });

  test('falls back gracefully without diag.file', () => {
    const r = runRules({
      check: 'OrphanedPartial',
      message: 'This partial is not referenced by any other files',
    }, { graph: buildFactGraph({ pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [] }) });
    expect(r.rule_id).toBe('OrphanedPartial.default');
    // Without a path, no delete_file proposal — too dangerous.
    expect(r.fixes.some(f => f.type === 'delete_file')).toBe(false);
  });
});

describe('MissingPage rule', () => {
  const graph = buildFactGraph({
    pages: {
      'idx': { path: 'app/views/pages/index.liquid', slug: '', method: 'get', renders: [] },
      'notes:get': { path: 'app/views/pages/notes/index.html.liquid', slug: 'notes', method: 'get', renders: [] },
      'dashboard:get': { path: 'app/views/pages/dashboard.liquid', slug: 'dashboard', method: 'get', renders: [] },
    },
    partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
  });

  beforeEach(() => { clearRules(); registerRules(MissingPageRules); });

  test('typo: close to existing slug → suggest rename', () => {
    const r = runRules({
      check: 'MissingPage',
      message: "No page found for route '/noets' (GET)",
    }, { graph });
    expect(r.rule_id).toBe('MissingPage.typo');
    expect(r.hint_md).toContain('/notes');
  });

  test('default: no near match → three-option decision tree + create_file', () => {
    const r = runRules({
      check: 'MissingPage',
      message: "No page found for route '/profile' (GET)",
    }, { graph });
    expect(r.rule_id).toBe('MissingPage.default');
    expect(r.hint_md).toContain('Typo in the reference');
    expect(r.hint_md).toContain('New page');
    expect(r.hint_md).toContain('Method mismatch');
    expect(r.fixes[0].type).toBe('create_file');
    expect(r.fixes[0].path).toBe('app/views/pages/profile.liquid');
  });

  test('root route → suggests omitting slug, points at index.liquid', () => {
    const r = runRules({
      check: 'MissingPage',
      message: "No page found for route '/' (GET)",
    }, { graph: buildFactGraph({ pages:{}, partials:{}, commands:{}, queries:{}, graphql:{}, schema:{}, layouts:{}, translations:{}, assets:[] }) });
    expect(r.rule_id).toBe('MissingPage.default');
    expect(r.fixes[0].path).toBe('app/views/pages/index.liquid');
    expect(r.hint_md).toContain('omit `slug:`');
  });

  test('extracts method from message', () => {
    const r = runRules({
      check: 'MissingPage',
      message: "No page found for route '/api/sync' (POST)",
    }, { graph });
    expect(r.hint_md).toContain('(POST)');
  });
});

describe('LiquidHTMLSyntaxError rule', () => {
  beforeEach(() => { clearRules(); registerRules(LiquidHTMLSyntaxErrorRules); });

  test('unknown_tag fires on "Unknown tag" message + suggests via tagsIndex', () => {
    const tagsIndex = {
      platformOSTags: () => [
        { name: 'assign' }, { name: 'render' }, { name: 'function' }, { name: 'graphql' }, { name: 'if' }, { name: 'for' },
      ],
    };
    const r = runRules({
      check: 'LiquidHTMLSyntaxError',
      message: "Unknown tag 'assigns'",
    }, { tagsIndex });
    expect(r.rule_id).toBe('LiquidHTMLSyntaxError.unknown_tag');
    expect(r.hint_md).toContain('assign');
  });

  test('unknown_tag works without tagsIndex (no suggestion, still attributes)', () => {
    const r = runRules({
      check: 'LiquidHTMLSyntaxError',
      message: "Unknown tag 'foo'",
    }, {});
    expect(r.rule_id).toBe('LiquidHTMLSyntaxError.unknown_tag');
    expect(r.hint_md).toContain('foo');
  });

  test('for_loop_args fires when filter pipeline appears in for loop header', () => {
    const r = runRules({
      check: 'LiquidHTMLSyntaxError',
      message: "Arguments must be provided in the format `for in <array> <positional arguments> <named arguments>`. Invalid/Unknown arguments: |, t",
    }, {});
    expect(r.rule_id).toBe('LiquidHTMLSyntaxError.for_loop_args');
    expect(r.hint_md).toContain('assign items');
    // The fix description cross-references the translation-array sibling rule
    // (the most common origin of `| t` inside a for header).
    expect(r.fixes[0].description).toContain('TranslationKeyExists.array_index_misuse');
  });

  test('default fallback for unknown shapes', () => {
    const r = runRules({
      check: 'LiquidHTMLSyntaxError',
      message: 'something obscure happened',
    }, {});
    expect(r.rule_id).toBe('LiquidHTMLSyntaxError.default');
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
});
