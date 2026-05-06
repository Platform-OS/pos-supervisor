import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDiagnosticPipeline,
  suppressByPending,
  buildPendingPartialNames,
  buildPendingPageKeys,
  stampDefaultsOn,
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

// ── verifyMissingPartialsOnDisk: lib/-prefix correctness ────────────────────
//
// Regression: the resolver used to strip a leading `lib/` before the disk
// check, which routed `lib/commands/X` to `app/lib/commands/X.liquid` and
// silently suppressed the LSP's correct MissingPartial when that bare-form
// file existed. Net effect: the agent saw "no problem" while platformOS
// would 500 at runtime because `lib/commands/X` resolves to
// `app/lib/lib/commands/X.liquid` (the partial search paths are
// `app/views/partials/` and `app/lib/`, not project root). The resolver
// now mirrors upstream `DocumentsLocator` exactly — no prefix stripping —
// so the LSP error survives all the way to the agent.

describe('diagnostic-pipeline: verifyMissingPartialsOnDisk does not strip `lib/` prefix', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-libpref-'));
    mkdirSync(join(tmpDir, 'app/lib/commands/contacts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/lib/commands/contacts/create.liquid'),
      '{% doc %}{% enddoc %}',
      'utf8',
    );
    mkdirSync(join(tmpDir, 'app/views/partials/cards'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/views/partials/cards/product.liquid'),
      '<div></div>',
      'utf8',
    );
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it('suppresses MissingPartial for the bare `commands/X` form when X.liquid is on disk (LSP cache lag)', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "'commands/contacts/create' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/contacts/new.html.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(true);
  });

  it('does NOT suppress MissingPartial for the `lib/commands/X` form — the `lib/` prefix expands to `app/lib/lib/...`', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "'lib/commands/contacts/create' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/contacts/new.html.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('lib/commands/contacts/create');
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(false);
  });

  it('does NOT suppress MissingPartial for the `lib/queries/X` form even when the bare-form file exists on disk', () => {
    mkdirSync(join(tmpDir, 'app/lib/queries/products'), { recursive: true });
    writeFileSync(join(tmpDir, 'app/lib/queries/products/find.liquid'), '{% doc %}{% enddoc %}', 'utf8');
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "'lib/queries/products/find' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/products/show.html.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(false);
  });

  it('still suppresses real partial cache-lag misses (non-`lib/` paths)', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "'cards/product' does not exist" },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/index.html.liquid', content: '', projectDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(true);
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

// ── populateDefaultConfidence (A2) ──────────────────────────────────────────

describe('diagnostic-pipeline: populateDefaultConfidence', () => {
  it('stamps severity-based defaults when the rule engine left confidence unset', () => {
    const result = makeResult(
      [{ check: 'UndefinedObject', severity: 'error', message: 'foo' }],
      [{ check: 'UnusedAssign', severity: 'warning', message: 'bar' }],
      [{ check: 'InfoOnly', severity: 'info', message: 'baz' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0].confidence).toBe(0.9);
    expect(result.warnings[0].confidence).toBe(0.7);
    expect(result.infos[0].confidence).toBe(0.5);
  });

  it('does not overwrite a confidence value that the rule engine already set', () => {
    const result = makeResult(
      [{ check: 'UndefinedObject', severity: 'error', message: 'foo', confidence: 0.42 }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0].confidence).toBe(0.42);
  });

  it('stamps structural default for pos-supervisor: prefixed checks', () => {
    const result = makeResult(
      [],
      [{ check: 'pos-supervisor:RemovedRender', severity: 'warning', message: 'removed' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.warnings[0].confidence).toBe(0.75);
  });

  it('runs after suppression — items removed from result never gain a default', () => {
    const result = makeResult(
      [],
      [{ check: 'MissingPartial', severity: 'warning', message: "Missing partial 'notes/show'" }],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/x.liquid',
      content: '',
      pendingFiles: ['app/views/partials/notes/show.liquid'],
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('falls back to warning-level confidence when severity is unset or unknown', () => {
    const result = makeResult(
      [],
      [{ check: 'Weirdo', message: 'no severity' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.warnings[0].confidence).toBe(0.7);
  });

  // ── A4: rule_id fallback ───────────────────────────────────────────────
  it('stamps rule_id as `${check}.unmatched` when no rule fired', () => {
    const result = makeResult(
      [{ check: 'UndefinedObject', severity: 'error', message: 'foo' }],
      [{ check: 'UnusedAssign', severity: 'warning', message: 'bar' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0].rule_id).toBe('UndefinedObject.unmatched');
    expect(result.warnings[0].rule_id).toBe('UnusedAssign.unmatched');
  });

  it('preserves rule_id set by the rule engine', () => {
    const result = makeResult(
      [{ check: 'UndefinedObject', severity: 'error', message: 'foo', rule_id: 'UndefinedObject.context_user' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0].rule_id).toBe('UndefinedObject.context_user');
  });

  it('falls back to `unknown.unmatched` when the diagnostic has no check name', () => {
    const result = makeResult(
      [],
      [{ severity: 'warning', message: 'orphan' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.warnings[0].rule_id).toBe('unknown.unmatched');
  });
});

// ── stampDefaultsOn: post-pipeline stamping (confidence-bug fix) ─────────────

describe('stampDefaultsOn: late-push diagnostics get default confidence', () => {
  it('stamps diagnostics added AFTER runDiagnosticPipeline has already run', () => {
    const result = makeResult([{ check: 'UnknownFilter', severity: 'error', message: 'x' }]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0].confidence).toBe(0.9);

    // Simulate a late push — e.g. structural-warnings / schema validator.
    result.warnings.push({
      check: 'pos-supervisor:HtmlInPage',
      severity: 'warning',
      message: 'HTML in page',
    });
    // Without the fix the late row would stay at confidence: null.
    stampDefaultsOn(result);
    expect(result.warnings[0].confidence).toBe(0.75);           // structural default
    expect(result.warnings[0].rule_id).toBe('pos-supervisor:HtmlInPage.unmatched');
  });

  it('is idempotent — re-stamping does not overwrite existing values', () => {
    const result = makeResult([
      { check: 'UnknownFilter', severity: 'error', message: 'x', confidence: 0.42, rule_id: 'UnknownFilter.typo' },
    ]);
    stampDefaultsOn(result);
    expect(result.errors[0].confidence).toBe(0.42);
    expect(result.errors[0].rule_id).toBe('UnknownFilter.typo');
  });
});

// ── suppressLspKnownFalsePositives ──────────────────────────────────────────
//
// Pins the LSP "Syntax is not supported" suppression on `assign x = a <op> b`
// boolean comparisons. Upstream pos-cli LSP rejects this construct even
// though `pos-cli check run` and the platformOS Liquid parser both accept
// it. Without the suppression, agents are forced to rewrite valid code as a
// multi-line if/else just to clear the must_fix_before_write gate.

describe('diagnostic-pipeline: suppressLspKnownFalsePositives', () => {
  function syntaxErr(line, message = 'Syntax is not supported') {
    return { check: 'LiquidHTMLSyntaxError', severity: 'error', line, message };
  }

  it('suppresses the LSP false positive on `assign x = a == b` when the file parses cleanly', () => {
    const content = [
      '{% doc %}',
      '  @param {object} object',
      '{% enddoc %}',
      '{% liquid',
      '  assign c = object.errors | default: empty',
      '  assign object.valid = c == empty',
      '  return object',
      '%}',
    ].join('\n');

    const result = makeResult([syntaxErr(6)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/lib/commands/contacts/create/check.liquid',
      content,
    });

    expect(result.errors).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed');
    expect(info).toBeDefined();
    expect(info.message).toContain('line(s) 6');
    expect(info.message).toContain('@platformos/liquid-html-parser');
  });

  it('suppresses every "Syntax is not supported" diagnostic in the same file at once', () => {
    const content = [
      '{% liquid',
      '  assign a = 1 == 1',
      '  assign b = 2 != 3',
      '%}',
    ].join('\n');

    const result = makeResult([syntaxErr(2), syntaxErr(3)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/check.liquid',
      content,
    });

    expect(result.errors).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed');
    expect(info.message).toContain('line(s) 2, 3');
  });

  it('does NOT suppress when the file has a real syntax error elsewhere (parser fails)', () => {
    const content = [
      '{% liquid',
      '  assign x = 1 == 1',
      '%}',
      '{% if foo %}',
      '  hello',
      '{# missing endif — strict parse fails here #}',
    ].join('\n');

    const result = makeResult([syntaxErr(2)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/broken.liquid',
      content,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('LiquidHTMLSyntaxError');
    expect(result.infos.some(i => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed')).toBe(false);
  });

  it('does NOT suppress LiquidHTMLSyntaxError diagnostics with a different upstream message', () => {
    const content = [
      '{% liquid',
      '  assign x = 1',
      '%}',
    ].join('\n');

    const result = makeResult([
      { check: 'LiquidHTMLSyntaxError', severity: 'error', line: 1, message: "Invalid syntax for tag 'render'" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/x.liquid',
      content,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.infos.some(i => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed')).toBe(false);
  });

  it('does NOT suppress non-LiquidHTMLSyntaxError checks even when the message text matches', () => {
    const content = '{% liquid\n  assign x = 1\n%}\n';

    const result = makeResult([
      { check: 'UnknownFilter', severity: 'error', line: 1, message: 'Syntax is not supported' },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/x.liquid',
      content,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('UnknownFilter');
  });

  it('also handles diagnostics surfaced as warnings, not just errors', () => {
    const content = '{% liquid\n  assign x = 1 == 1\n%}\n';

    const result = makeResult([], [
      { check: 'LiquidHTMLSyntaxError', severity: 'warning', line: 2, message: 'Syntax is not supported' },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/x.liquid',
      content,
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed')).toBe(true);
  });
});

// ── verifyPageRoutesOnDisk: in-memory file overlay ──────────────────────────
//
// Pins the self-page suppression: when an agent runs validate_code on a
// page whose in-memory frontmatter declares the very (slug, method) pair
// the LSP is complaining about, the route index must reflect the
// in-memory version, not the older on-disk one. Without this overlay the
// agent sees a MissingPage warning for a route the file IS about to serve
// the moment it lands on disk — exactly the false positive observed in
// the DEMO project (POST `/` warning while `app/views/pages/index.liquid`
// declared `method: post` in-memory).

describe('diagnostic-pipeline: verifyPageRoutesOnDisk respects in-memory overlay', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-route-overlay-'));
    mkdirSync(join(tmpDir, 'app/views/pages'), { recursive: true });
    // Disk version: GET / only — no method declared.
    writeFileSync(
      join(tmpDir, 'app/views/pages/index.liquid'),
      '<p>old version (no frontmatter)</p>\n',
      'utf8',
    );
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it("suppresses MissingPage for route '/' (POST) when the file under validation declares method: post in-memory", () => {
    const inMemory = [
      '---',
      'method: post',
      'metadata:',
      '  title: "Home"',
      '---',
      '<p>POST handler in-memory</p>',
    ].join('\n');

    const result = makeResult([], [
      { check: 'MissingPage', severity: 'warning', line: 6, column: 0, message: "No page found for route '/' (POST)" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/index.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.infos.some(i => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(true);
  });

  it('still flags MissingPage when the in-memory frontmatter does not cover the reported method', () => {
    const inMemory = [
      '---',
      'method: get',
      '---',
      '<p>GET only</p>',
    ].join('\n');

    const result = makeResult([], [
      { check: 'MissingPage', severity: 'warning', line: 4, column: 0, message: "No page found for route '/' (POST)" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/index.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(1);
    // wrong-method enrichment — the route IS served, just for GET.
    expect(result.warnings[0].hint).toContain('GET');
  });

  it('treats a brand-new page (not yet on disk) as serving its declared route', () => {
    const inMemory = [
      '---',
      'slug: contact',
      'method: post',
      '---',
      '<p>new page</p>',
    ].join('\n');

    const result = makeResult([], [
      { check: 'MissingPage', severity: 'warning', line: 5, column: 0, message: "No page found for route '/contact' (POST)" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/contact.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(0);
  });

  it('ignores the overlay when the file under validation is not under app/views/pages/ (partial / layout)', () => {
    // A partial cannot serve a route. Even if it has frontmatter (it shouldn't),
    // the route index must remain disk-only for non-page files.
    const inMemory = [
      '---',
      'slug: pretend',
      'method: post',
      '---',
      '<p>partial pretending to be a page</p>',
    ].join('\n');

    const result = makeResult([], [
      { check: 'MissingPage', severity: 'warning', line: 5, column: 0, message: "No page found for route '/pretend' (POST)" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/pretend.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(1);
  });
});
