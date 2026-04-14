import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDiagnosticPipeline,
  suppressByPending,
  buildPendingPartialNames,
  buildPendingPageKeys,
} from '../../src/core/diagnostic-pipeline.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeResult(errors = [], warnings = [], infos = []) {
  return { errors: [...errors], warnings: [...warnings], infos: [...infos] };
}

function metadataError(line, message = 'Required parameter autohide must be passed') {
  return { check: 'MetadataParamsCheck', severity: 'error', line, message };
}

function metadataWarn(line, message = 'Required parameter delay must be passed') {
  return { check: 'MetadataParamsCheck', severity: 'warning', line, message };
}

// ── suppressModuleTargetParams ────────────────────────────────────────────────

describe('diagnostic-pipeline: suppressModuleTargetParams', () => {
  it('suppresses MetadataParamsCheck errors on lines calling modules/ partials', () => {
    const content = [
      '{% doc %}{% enddoc %}',
      '',
      '{% theme_render_rc \'modules/common-styling/toasts\' %}',
    ].join('\n');

    const result = makeResult([metadataError(3)]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content });

    expect(result.errors).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:ModuleParamsSuppressed')).toBe(true);
  });

  it('suppresses MetadataParamsCheck warnings on module/ lines', () => {
    const content = [
      '{% liquid %}',
      '  function _ = \'modules/user/helpers/can_do_or_unauthorized\', requester: context.current_user',
      '{% endliquid %}',
    ].join('\n');

    const result = makeResult([], [metadataWarn(2)]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/items/new.html.liquid', content });

    expect(result.warnings).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:ModuleParamsSuppressed')).toBe(true);
  });

  it('does NOT suppress MetadataParamsCheck errors on non-module lines', () => {
    const content = [
      '{% liquid %}',
      '  function items = \'queries/items/search\', page: context.params.page',
      '{% endliquid %}',
    ].join('\n');

    const result = makeResult([metadataError(2, 'Required parameter limit must be passed to function call')]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/items/index.html.liquid', content });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('MetadataParamsCheck');
  });

  it('does NOT suppress non-MetadataParamsCheck errors on module lines', () => {
    const content = [
      '{% render \'modules/common-styling/init\', reset: true %}',
    ].join('\n');

    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', line: 1, message: "partial does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('MissingPartial');
  });

  it('reports suppression count in info message', () => {
    const content = [
      '{% theme_render_rc \'modules/common-styling/toasts\' %}',
      '{% render \'modules/common-styling/init\' %}',
    ].join('\n');

    const result = makeResult([metadataError(1), metadataError(2)]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content });

    expect(result.errors).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:ModuleParamsSuppressed');
    expect(info.message).toContain('2');
  });
});

// ── suppressByPending + key builders ─────────────────────────────────────────

describe('diagnostic-pipeline: suppressByPending', () => {
  it('removes diagnostics whose extracted key is in the pending set', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "Partial 'blog_posts/form' does not exist" },
      { check: 'MissingPartial', severity: 'error', message: "Partial 'other/thing' does not exist" },
    ]);
    const removed = suppressByPending(result, {
      check: 'MissingPartial',
      pendingSet: new Set(['blog_posts/form']),
      extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
    });
    expect(removed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('other/thing');
  });

  it('returns 0 when pending set is empty', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "Partial 'x' does not exist" },
    ]);
    const removed = suppressByPending(result, {
      check: 'MissingPartial',
      pendingSet: new Set(),
      extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
    });
    expect(removed).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('ignores diagnostics whose check name does not match', () => {
    const result = makeResult([
      { check: 'TranslationKeyExists', severity: 'error', message: "Key 'a.b.c'" },
    ]);
    const removed = suppressByPending(result, {
      check: 'MissingPartial',
      pendingSet: new Set(['a.b.c']),
      extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
    });
    expect(removed).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
});

describe('diagnostic-pipeline: buildPendingPartialNames', () => {
  it('emits short-name variants for partial paths', () => {
    const names = buildPendingPartialNames(['app/views/partials/blog_posts/form.liquid']);
    expect(names.has('blog_posts/form')).toBe(true);
    expect(names.has('app/views/partials/blog_posts/form.liquid')).toBe(true);
  });

  it('handles .html.liquid pages gracefully (no crash, just no short name)', () => {
    const names = buildPendingPartialNames(['app/views/pages/blog_posts/index.html.liquid']);
    expect(names.size).toBeGreaterThan(0);
  });

  it('emits graphql variant when file is .graphql', () => {
    const names = buildPendingPartialNames(['app/graphql/blog_posts/search.graphql']);
    expect(names.has('blog_posts/search')).toBe(true);
  });
});

describe('diagnostic-pipeline: buildPendingPageKeys', () => {
  it('extracts slug forms from page paths', () => {
    const keys = buildPendingPageKeys(['app/views/pages/blog_posts/index.html.liquid']);
    expect(keys.has('blog_posts/index')).toBe(true);
    expect(keys.has('blog_posts')).toBe(true);
    expect(keys.has('app/views/pages/blog_posts/index.html.liquid')).toBe(true);
  });

  it('keeps non-index slugs unchanged', () => {
    const keys = buildPendingPageKeys(['app/views/pages/blog_posts/show.html.liquid']);
    expect(keys.has('blog_posts/show')).toBe(true);
  });
});

// ── runDiagnosticPipeline pending suppression ────────────────────────────────

describe('diagnostic-pipeline: pending suppression via runDiagnosticPipeline', () => {
  it('suppresses MissingPartial for files in pendingFiles', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', line: 1, column: 0, message: "Partial 'blog_posts/form' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/blog_posts/new.liquid',
      content: "{% render 'blog_posts/form' %}",
      pendingFiles: ['app/views/partials/blog_posts/form.liquid'],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.find(i => i.check === 'pos-supervisor:PendingSuppressed')).toBeTruthy();
  });

  it('suppresses MissingPage for pages in pendingPages', () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', line: 1, column: 0, message: "Page 'blog_posts/show' not found" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/blog_posts/index.html.liquid',
      content: '<a href="/blog_posts/{{ post.id }}">show</a>',
      pendingPages: ['app/views/pages/blog_posts/show.html.liquid'],
    });
    expect(result.errors).toHaveLength(0);
  });

  it('suppresses TranslationKeyExists for keys in pendingTranslations', () => {
    const result = makeResult([
      { check: 'TranslationKeyExists', severity: 'error', line: 1, column: 0, message: "Translation key 'app.blog_posts.list.title' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/blog_posts/index.html.liquid',
      content: "{{ 'app.blog_posts.list.title' | t }}",
      pendingTranslations: ['app.blog_posts.list.title'],
    });
    expect(result.errors).toHaveLength(0);
  });

  it('emits a single PendingSuppressed summary covering all three pending types', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', line: 1, column: 0, message: "Partial 'a/b' does not exist" },
      { check: 'MissingPage', severity: 'error', line: 2, column: 0, message: "Page 'c/d' not found" },
      { check: 'TranslationKeyExists', severity: 'error', line: 3, column: 0, message: "Key 'e.f.g' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: 'noop',
      pendingFiles: ['app/views/partials/a/b.liquid'],
      pendingPages: ['app/views/pages/c/d.html.liquid'],
      pendingTranslations: ['e.f.g'],
    });
    const summaries = result.infos.filter(i => i.check === 'pos-supervisor:PendingSuppressed');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].message).toContain('MissingPartial');
    expect(summaries[0].message).toContain('MissingPage');
    expect(summaries[0].message).toContain('TranslationKeyExists');
  });

  it('leaves unrelated diagnostics alone', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', line: 1, column: 0, message: "Partial 'genuinely_missing' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: 'noop',
      pendingFiles: ['app/views/partials/different.liquid'],
    });
    expect(result.errors).toHaveLength(1);
  });
});

// ── verifyMissingAssets ──────────────────────────────────────────────────────

describe('diagnostic-pipeline: verifyMissingAssets via runDiagnosticPipeline', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-assets-'));
    const assets = join(tmpDir, 'app/assets');
    mkdirSync(join(assets, 'styles'), { recursive: true });
    mkdirSync(join(assets, 'images'), { recursive: true });
    mkdirSync(join(assets, 'vendor'), { recursive: true });
    writeFileSync(join(assets, 'styles/app.css'), '/**/', 'utf8');
    writeFileSync(join(assets, 'styles/design-tokens.css'), ':root{}', 'utf8');
    writeFileSync(join(assets, 'images/logo.png'), 'PNG', 'utf8');
    writeFileSync(join(assets, 'vendor/logo.png'), 'PNG', 'utf8');
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it("suppresses MissingAsset for a path that exists on disk (LSP cache lag)", () => {
    const result = makeResult(
      [{ check: 'MissingAsset', severity: 'error', message: "'styles/app.css' does not exist" }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingAssetSuppressed')).toBe(true);
  });

  it('normalises agent-submitted leading-slash and assets/ prefix variants before checking', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'/styles/app.css' does not exist" },
      { check: 'MissingAsset', severity: 'error', message: "'assets/styles/app.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
  });

  it("emits MissingAssetPathHint when the file exists at a different nested path (basename unique)", () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'design-tokens.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    const hint = result.infos.find(i => i.check === 'pos-supervisor:MissingAssetPathHint');
    expect(hint).toBeDefined();
    expect(hint.suggestion).toBe('styles/design-tokens.css');
    expect(hint.message).toContain("'styles/design-tokens.css'");
  });

  it("does NOT suppress when the basename is ambiguous (multiple matches) — agent picks", () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'logo.png' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/header.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].hint).toContain('Basename matches multiple assets');
    expect(result.errors[0].hint).toContain('images/logo.png');
    expect(result.errors[0].hint).toContain('vendor/logo.png');
  });

  it('leaves MissingAsset unchanged when the file truly does not exist anywhere under app/assets/', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'styles/does-not-exist.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingAssetSuppressed')).toBe(false);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingAssetPathHint')).toBe(false);
  });

  it('skips filesystem checks entirely when projectDir is not provided', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'styles/app.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/layouts/application.liquid', content: '' });
    expect(result.errors).toHaveLength(1);
  });
});

// ── verifyTranslationKeysOnDisk ──────────────────────────────────────────────

describe('diagnostic-pipeline: verifyTranslationKeysOnDisk via runDiagnosticPipeline', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-translations-'));
    mkdirSync(join(tmpDir, 'app/translations'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/translations/en.yml'),
      "en:\n  app:\n    dashboard:\n      recent_notes: Recent Notes\n      title: Dashboard\n",
      'utf8',
    );
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it('suppresses TranslationKeyExists for a key already on disk (no pending_translations needed)', () => {
    const result = makeResult([
      { check: 'TranslationKeyExists', severity: 'error', message: "Translation key 'app.dashboard.recent_notes' not found." },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/dashboard.html.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:TranslationKeyExistsSuppressed')).toBe(true);
  });

  it('leaves TranslationKeyExists in place when the key is genuinely missing from every locale file', () => {
    const result = makeResult([
      { check: 'TranslationKeyExists', severity: 'error', message: "Translation key 'app.unknown.key' not found." },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/dashboard.html.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some(i => i.check === 'pos-supervisor:TranslationKeyExistsSuppressed')).toBe(false);
  });

  it('coexists with pending_translations — pending suppression handles in-plan, disk check handles already-written', () => {
    const result = makeResult([
      // already on disk — disk check suppresses
      { check: 'TranslationKeyExists', severity: 'error', message: "Translation key 'app.dashboard.title' not found." },
      // not on disk yet but planned — pending suppression handles
      { check: 'TranslationKeyExists', severity: 'error', message: "Translation key 'app.dashboard.future' not found." },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/dashboard.html.liquid',
      content: '',
      projectDir: tmpDir,
      pendingTranslations: ['app.dashboard.future'],
    });
    expect(result.errors).toHaveLength(0);
  });

  it('skips the disk check when projectDir is not provided', () => {
    const result = makeResult([
      { check: 'TranslationKeyExists', severity: 'error', message: "Translation key 'app.dashboard.recent_notes' not found." },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/dashboard.html.liquid', content: '' });
    expect(result.errors).toHaveLength(1);
  });
});

// ── verifyPageRoutesOnDisk ───────────────────────────────────────────────────
//
// Pins the third ghost-error fix. The agent reported MissingPage firing on a
// header partial that links to `/`, `/notes`, `/dashboard` even though those
// routes are clearly served — by other page files validate_code never sees in
// a single-file analysis. The fix mirrors MissingAsset and TranslationKeyExists:
// build a snapshot of the real pages on disk and reconcile.

describe('diagnostic-pipeline: verifyPageRoutesOnDisk via runDiagnosticPipeline', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-pages-'));
    const pages = join(tmpDir, 'app/views/pages');
    mkdirSync(join(pages, 'notes'), { recursive: true });
    mkdirSync(join(pages, 'blog_posts'), { recursive: true });
    writeFileSync(join(pages, 'index.liquid'), '<p>Home</p>\n', 'utf8');
    writeFileSync(join(pages, 'dashboard.liquid'), '<p>Dash</p>\n', 'utf8');
    writeFileSync(join(pages, 'notes/index.html.liquid'), '<p>Notes</p>\n', 'utf8');
    // POST-only page — used to test the wrong-method outcome.
    writeFileSync(
      join(pages, 'blog_posts/create.liquid'),
      '---\nslug: blog_posts/create\nmethod: post\n---\n<p>Create</p>\n',
      'utf8',
    );
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it("suppresses MissingPage for the agent's reported case (links to /, /notes, /dashboard)", () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/' (GET)" },
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/notes' (GET)" },
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/dashboard' (GET)" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/header.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:MissingPageSuppressed');
    expect(info).toBeDefined();
    expect(info.message).toContain('/ (GET)');
    expect(info.message).toContain('notes (GET)');
    expect(info.message).toContain('dashboard (GET)');
  });

  it('handles the bare "Page \'X\' not found" message shape (defaults to GET)', () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "Page 'notes' not found" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/sidebar.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(true);
  });

  it('keeps the diagnostic but enriches .hint with served methods on a wrong-method hit', () => {
    const diag = { check: 'MissingPage', severity: 'error', message: "No page found for route '/blog_posts/create' (GET)" };
    const result = makeResult([diag]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/links.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(diag.hint).toBeDefined();
    expect(diag.hint).toContain('POST');
    expect(diag.hint).toContain('GET');
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(false);
  });

  it('leaves MissingPage in place when the route is genuinely not served by any page file', () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/never-served' (GET)" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/header.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(false);
  });

  it('skips the disk check when projectDir is not provided', () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/notes' (GET)" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/header.liquid', content: '' });
    expect(result.errors).toHaveLength(1);
  });

  it('does not collide with pendingPages — pending suppression runs first, on-disk runs second', () => {
    // /notes exists on disk AND is also in pendingPages — both paths drop the diagnostic;
    // the test pins that the pipeline does not re-report or double-count it.
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "Page 'notes' not found" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/header.liquid',
      content: '',
      projectDir: tmpDir,
      pendingPages: ['notes'],
    });
    expect(result.errors).toHaveLength(0);
  });
});

// ── verifyOrphanedPartialOnDisk ────────────────────────────────────────────

describe('verifyOrphanedPartialOnDisk via runDiagnosticPipeline', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orphan-verify-'));
    const pages = join(tmpDir, 'app/views/pages/notes');
    const partials = join(tmpDir, 'app/views/partials/notes');
    mkdirSync(pages, { recursive: true });
    mkdirSync(partials, { recursive: true });

    writeFileSync(
      join(pages, 'show.html.liquid'),
      "---\nslug: notes/show\n---\n{% render 'notes/show', object: note %}\n",
      'utf8',
    );

    writeFileSync(
      join(partials, 'show.liquid'),
      '{% doc %}\n  @param object {object}\n{% enddoc %}\n<p>{{ object.title }}</p>\n',
      'utf8',
    );

    writeFileSync(
      join(partials, 'orphan.liquid'),
      '<p>truly orphaned</p>\n',
      'utf8',
    );
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it('suppresses OrphanedPartial when a page on disk renders the partial', () => {
    const result = makeResult(
      [],
      [{ check: 'OrphanedPartial', severity: 'warning', message: "Partial 'notes/show' is never rendered" }],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/notes/show.liquid',
      content: '<p>{{ object.title }}</p>',
      projectDir: tmpDir,
    });
    expect(result.warnings).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:OrphanedPartialVerified');
    expect(info).toBeDefined();
    expect(info.message).toContain('notes/show');
  });

  it('does NOT suppress OrphanedPartial when no file references the partial', () => {
    const result = makeResult(
      [],
      [{ check: 'OrphanedPartial', severity: 'warning', message: "Partial 'notes/orphan' is never rendered" }],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/notes/orphan.liquid',
      content: '<p>truly orphaned</p>',
      projectDir: tmpDir,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].check).toBe('OrphanedPartial');
  });

  it('works for OrphanedPartial reported as an error (not just warning)', () => {
    const result = makeResult(
      [{ check: 'OrphanedPartial', severity: 'error', message: "Partial 'notes/show' is never rendered" }],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/notes/show.liquid',
      content: '<p>{{ object.title }}</p>',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
  });

  it('does not suppress for non-partial files', () => {
    const result = makeResult(
      [],
      [{ check: 'OrphanedPartial', severity: 'warning', message: 'orphan' }],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/notes/show.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.warnings).toHaveLength(1);
  });
});
