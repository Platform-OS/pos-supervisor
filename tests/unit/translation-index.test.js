/**
 * Pins for the translation-key index used by the diagnostic pipeline to
 * suppress stale TranslationKeyExists diagnostics.
 *
 * The agent reported needing `pending_translations` even for keys that were
 * already written to `app/translations/en.yml` — the LSP's translation cache
 * lags behind disk. The index lets the pipeline cross-check the real YAML
 * files and stop the agent from chasing keys that are obviously present.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTranslationIndex } from '../../src/core/translation-index.js';

describe('translation-index', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'translation-index-'));
    mkdirSync(join(tmpDir, 'app/translations'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/translations/en.yml'),
      "en:\n  app:\n    dashboard:\n      recent_notes: Recent Notes\n      title: Dashboard\n    blog_posts:\n      save: Save\n",
      'utf8',
    );
    writeFileSync(
      join(tmpDir, 'app/translations/pl.yml'),
      "pl:\n  app:\n    dashboard:\n      recent_notes: Notatki\n  pl_only_namespace:\n    hello: Cześć\n",
      'utf8',
    );
    // Non-YAML files in the directory must be ignored.
    writeFileSync(join(tmpDir, 'app/translations/README.md'), 'docs', 'utf8');
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it('flattens every locale into a single dot-notation key set with the locale stripped', () => {
    const { keys } = buildTranslationIndex(tmpDir);
    expect(keys.has('app.dashboard.recent_notes')).toBe(true);
    expect(keys.has('app.dashboard.title')).toBe(true);
    expect(keys.has('app.blog_posts.save')).toBe(true);
  });

  it('merges keys defined in different locales (e.g. pl-only namespace) into the same set', () => {
    const { keys } = buildTranslationIndex(tmpDir);
    expect(keys.has('pl_only_namespace.hello')).toBe(true);
  });

  it('does not include the locale prefix in keys', () => {
    const { keys } = buildTranslationIndex(tmpDir);
    expect(keys.has('en.app.dashboard.recent_notes')).toBe(false);
    expect(keys.has('pl.app.dashboard.recent_notes')).toBe(false);
  });

  it('returns an empty set when projectDir is missing or has no translations dir', () => {
    expect(buildTranslationIndex(null).keys.size).toBe(0);
    expect(buildTranslationIndex('/nonexistent-path-really').keys.size).toBe(0);
  });

  it('survives malformed YAML — affected file contributes nothing, others still index', () => {
    const broken = mkdtempSync(join(tmpdir(), 'translation-index-broken-'));
    try {
      mkdirSync(join(broken, 'app/translations'), { recursive: true });
      writeFileSync(join(broken, 'app/translations/en.yml'), 'en:\n  app:\n    title: OK\n', 'utf8');
      writeFileSync(join(broken, 'app/translations/de.yml'), 'de:\n  : : :\n', 'utf8');
      const { keys } = buildTranslationIndex(broken);
      expect(keys.has('app.title')).toBe(true);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it('does not pick up YAML files outside app/translations/', () => {
    // Hostile fixture: another YAML elsewhere in the project must not pollute
    // the translation key set.
    mkdirSync(join(tmpDir, 'app/schema'), { recursive: true });
    writeFileSync(join(tmpDir, 'app/schema/whatever.yml'), 'foo: bar\n', 'utf8');
    const { keys } = buildTranslationIndex(tmpDir);
    expect(keys.has('foo')).toBe(false);
  });
});
