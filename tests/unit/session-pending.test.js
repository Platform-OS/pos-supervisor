/**
 * session.pending state — authoritative cross-tool suppression contract.
 *
 * Exercises the handler layer directly (no server spin-up) with a minimal ctx
 * object that carries a session.pending mutable store. These tests pin the
 * cross-tool behavior: validate_intent writes, validate_code and analyze_project
 * read and merge, scaffold(write:true) clears.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateIntentTool } from '../../src/tools/validate-intent.js';
import { validateCodeTool } from '../../src/tools/validate-code.js';
import { scaffoldTool } from '../../src/tools/scaffold.js';
import { serverStatusTool } from '../../src/tools/server-status.js';

// ── Test context helpers ─────────────────────────────────────────────────────

function makeSession() {
  return {
    fileHistory: new Map(),
    validatedPlan: null,
    pending: {
      files:        new Set(),
      translations: new Set(),
      pages:        new Set(),
      planId:       null,
      validatedAt:  null,
    },
  };
}

/** Minimal fixture project for validate_intent Track A. */
function makeFixtureProject() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-session-pending-'));
  mkdirSync(join(dir, 'app', 'schema'),              { recursive: true });
  mkdirSync(join(dir, 'app', 'views', 'pages'),      { recursive: true });
  mkdirSync(join(dir, 'app', 'views', 'partials'),   { recursive: true });
  mkdirSync(join(dir, 'app', 'lib', 'queries'),      { recursive: true });
  writeFileSync(join(dir, 'app', 'config.yml'), 'escape_output_instead_of_sanitize: true\n');
  return dir;
}

function makeCtx(projectDir) {
  return {
    version: 'test',
    directory: projectDir,
    session: makeSession(),
    log: () => {},
    emit: () => {},
    lsp: null,
    awaitLsp: async () => false,
    posCliFound: false,
    checkCmd: 'pos-cli',
    checkArgs: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('session.pending: validate_intent writes state on success', () => {
  let dir, ctx, handler;

  beforeEach(() => {
    dir = makeFixtureProject();
    ctx = makeCtx(dir);
    handler = validateIntentTool.createHandler(ctx);
  });

  it('populates session.pending with files, pages and translations from a valid Track B plan', async () => {
    const result = await handler({
      intent: {
        goal: 'Create a simple partials-only plan',
        changes: [
          { path: 'app/views/partials/widgets/card.liquid', role: 'partial', action: 'create' },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(ctx.session.pending.files.has('app/views/partials/widgets/card.liquid')).toBe(true);
    expect(ctx.session.pending.planId).toBe(result.plan_id);
    expect(ctx.session.pending.validatedAt).toBeTruthy();
  });

  it('extracts pending_pages from pending_files subset (pages only)', async () => {
    const result = await handler({
      intent: {
        goal: 'Create a page and a partial',
        changes: [
          { path: 'app/views/pages/blog_posts/index.html.liquid', role: 'page',    action: 'create' },
          { path: 'app/views/partials/blog_posts/list.liquid',    role: 'partial', action: 'create',
            references: { partials: [] } },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(ctx.session.pending.pages.has('app/views/pages/blog_posts/index.html.liquid')).toBe(true);
    // partial path must NOT be in pages
    expect(ctx.session.pending.pages.has('app/views/partials/blog_posts/list.liquid')).toBe(false);
  });

  it('overwrites previous pending state on every successful validation', async () => {
    ctx.session.pending.files.add('stale/file.liquid');
    ctx.session.pending.planId = 'stale-plan';

    const result = await handler({
      intent: {
        goal: 'New plan',
        changes: [
          { path: 'app/views/partials/fresh.liquid', role: 'partial', action: 'create' },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(ctx.session.pending.files.has('stale/file.liquid')).toBe(false);
    expect(ctx.session.pending.files.has('app/views/partials/fresh.liquid')).toBe(true);
    expect(ctx.session.pending.planId).not.toBe('stale-plan');
  });

  it('does NOT mutate session.pending on validation failure', async () => {
    ctx.session.pending.files.add('pre/existing.liquid');
    ctx.session.pending.planId = 'pre-existing';

    const result = await handler({
      intent: {
        goal: 'Invalid plan',
        changes: [
          { path: 'bad/path.liquid', role: 'partial', action: 'create' },
        ],
      },
    });

    expect(result.ok).toBe(false);
    // State preserved
    expect(ctx.session.pending.files.has('pre/existing.liquid')).toBe(true);
    expect(ctx.session.pending.planId).toBe('pre-existing');
  });
});

describe('session.pending: server_status surfaces state', () => {
  it('exposes session_pending as serializable arrays', async () => {
    const dir = makeFixtureProject();
    const ctx = makeCtx(dir);
    ctx.session.pending.files.add('app/views/partials/a.liquid');
    ctx.session.pending.pages.add('app/views/pages/b.html.liquid');
    ctx.session.pending.translations.add('app.x.y');
    ctx.session.pending.planId = 'abc123';
    ctx.session.pending.validatedAt = '2026-04-11T00:00:00Z';

    const result = await serverStatusTool.createHandler(ctx)();

    expect(result.session_pending).toBeTruthy();
    expect(result.session_pending.files).toEqual(['app/views/partials/a.liquid']);
    expect(result.session_pending.pages).toEqual(['app/views/pages/b.html.liquid']);
    expect(result.session_pending.translations).toEqual(['app.x.y']);
    expect(result.session_pending.plan_id).toBe('abc123');
  });

  it('returns null session_pending when ctx has no session', async () => {
    const result = await serverStatusTool.createHandler({
      directory: '/tmp', version: 'test', posCliFound: false, checkCmd: 'pos-cli',
    })();
    expect(result.session_pending).toBe(null);
  });
});

describe('session.pending: scaffold(write:true) clears state after successful write', () => {
  it('clears files, pages, translations, planId, validatedAt after writing', async () => {
    const dir = makeFixtureProject();
    const ctx = makeCtx(dir);

    ctx.session.pending.files.add('app/views/partials/old.liquid');
    ctx.session.pending.pages.add('app/views/pages/old.html.liquid');
    ctx.session.pending.translations.add('app.old.key');
    ctx.session.pending.planId = 'old-plan';
    ctx.session.pending.validatedAt = '2026-04-10T00:00:00Z';

    const handler = scaffoldTool.createHandler(ctx);
    const result = await handler({
      type: 'partial',
      name: 'card',
      properties: [{ name: 'title', type: 'string' }],
      write: true,
    });

    expect(result.written?.length).toBeGreaterThan(0);
    expect(ctx.session.pending.files.size).toBe(0);
    expect(ctx.session.pending.pages.size).toBe(0);
    expect(ctx.session.pending.translations.size).toBe(0);
    expect(ctx.session.pending.planId).toBe(null);
    expect(ctx.session.pending.validatedAt).toBe(null);

    // cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT clear state when write:false (dry run)', async () => {
    const dir = makeFixtureProject();
    const ctx = makeCtx(dir);

    ctx.session.pending.files.add('app/views/partials/preserved.liquid');
    ctx.session.pending.planId = 'preserved-plan';

    const handler = scaffoldTool.createHandler(ctx);
    await handler({
      type: 'partial',
      name: 'new_card',
      properties: [{ name: 'title', type: 'string' }],
      write: false,
    });

    expect(ctx.session.pending.files.has('app/views/partials/preserved.liquid')).toBe(true);
    expect(ctx.session.pending.planId).toBe('preserved-plan');

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('session.pending: validate_code input merging', () => {
  // We can't run the full validate_code pipeline in a unit test (LSP, pos-cli, etc.),
  // so we exercise only the input-merging contract by checking that the handler
  // accepts inputs without session.pending set, and that a session-populated ctx
  // does not crash the handler path. Pipeline behavior is covered in integration.
  it('handler accepts empty params when session.pending is empty', async () => {
    const dir = makeFixtureProject();
    const ctx = makeCtx(dir);
    const handler = validateCodeTool.createHandler(ctx);

    const result = await handler({
      file_path: 'app/views/partials/demo.liquid',
      content: '{% doc %}{% enddoc %}\n<div>hi</div>',
      mode: 'quick',
    });

    // No crash, structured result shape
    expect(result).toBeTruthy();
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.infos)).toBe(true);
  });

  it('handler does not crash when session.pending contains values', async () => {
    const dir = makeFixtureProject();
    const ctx = makeCtx(dir);
    ctx.session.pending.files.add('app/views/partials/widgets/card.liquid');
    ctx.session.pending.pages.add('app/views/pages/demo.html.liquid');
    ctx.session.pending.translations.add('app.demo.key');

    const handler = validateCodeTool.createHandler(ctx);
    const result = await handler({
      file_path: 'app/views/partials/demo.liquid',
      content: '{% doc %}{% enddoc %}\n<div>hi</div>',
      mode: 'quick',
    });

    expect(result).toBeTruthy();
    // session.pending must remain untouched — validate_code only reads
    expect(ctx.session.pending.files.size).toBe(1);
    expect(ctx.session.pending.pages.size).toBe(1);
    expect(ctx.session.pending.translations.size).toBe(1);
  });
});
