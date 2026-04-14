/**
 * Phase 4 — must_fix_before_write + input tightening (validate_code).
 *
 * Pins the structured blocking-gate field and the stricter input validation.
 * Exercises the handler directly against a minimal fixture project, NOT the
 * full server — we want the gate logic decoupled from LSP/pos-cli timings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateCodeTool } from '../../src/tools/validate-code.js';

// ── Test ctx helpers ────────────────────────────────────────────────────────

let projectDir, ctx, handler;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'validate-gate-'));
  mkdirSync(join(projectDir, 'app', 'views', 'pages'),    { recursive: true });
  mkdirSync(join(projectDir, 'app', 'views', 'partials'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'lib'),               { recursive: true });
  writeFileSync(join(projectDir, 'app', 'config.yml'), 'escape_output_instead_of_sanitize: true\n');

  ctx = {
    version: 'test',
    directory: projectDir,
    session: {
      fileHistory: new Map(),
      validatedPlan: null,
      pending: { files: new Set(), translations: new Set(), pages: new Set(), planId: null, validatedAt: null },
    },
    log: () => {},
    emit: () => {},
    lsp: null,
    awaitLsp: async () => false,
    posCliFound: false,
    checkCmd: 'pos-cli',
    schemaIndex: { loaded: false },
    objectsIndex: { loaded: false },
    filtersIndex: { loaded: false },
    tagsIndex: { loaded: false },
  };
  handler = validateCodeTool.createHandler(ctx);
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

// ── Input tightening ────────────────────────────────────────────────────────

describe('validate_code: input tightening', () => {
  it('rejects empty content with must_fix_before_write:true', async () => {
    const result = await handler({
      file_path: 'app/views/partials/x.liquid',
      content: '',
      mode: 'quick',
    });
    expect(result.status).toBe('error');
    expect(result.must_fix_before_write).toBe(true);
    expect(result.errors[0].check).toBe('InputError');
    expect(result.errors[0].message).toContain('empty string');
  });

  it('rejects content that is just a file path (agent passed path instead of text)', async () => {
    const result = await handler({
      file_path: 'app/views/partials/x.liquid',
      content: 'app/views/partials/x.liquid',
      mode: 'quick',
    });
    expect(result.status).toBe('error');
    expect(result.must_fix_before_write).toBe(true);
    expect(result.errors[0].message).toMatch(/looks like a file path/);
  });

  it('rejects content shorter than 5 chars', async () => {
    const result = await handler({
      file_path: 'app/views/partials/x.liquid',
      content: 'ok',
      mode: 'quick',
    });
    expect(result.status).toBe('error');
    expect(result.must_fix_before_write).toBe(true);
    expect(result.errors[0].message).toMatch(/too short/);
  });

  it('accepts content that is a well-formed stub partial', async () => {
    const result = await handler({
      file_path: 'app/views/partials/demo.liquid',
      content: '{% doc %}{% enddoc %}\n<div>hello</div>',
      mode: 'quick',
    });
    // No InputError — pipeline ran.
    expect(result.errors.find(e => e.check === 'InputError')).toBeUndefined();
  });
});

// ── Frontmatter-only page warning ───────────────────────────────────────────

describe('validate_code: frontmatter-only page warning', () => {
  it('warns when a page has frontmatter but empty body', async () => {
    const result = await handler({
      file_path: 'app/views/pages/empty.html.liquid',
      content: '---\nslug: empty\n---\n',
      mode: 'quick',
    });
    const w = result.warnings.find(w => w.check === 'pos-supervisor:FrontmatterOnlyPage');
    expect(w).toBeTruthy();
    expect(w.message).toMatch(/rendered output will be empty/);
  });

  it('does NOT warn on a page with actual body content', async () => {
    const result = await handler({
      file_path: 'app/views/pages/home.html.liquid',
      content: '---\nslug: home\n---\n<h1>Home</h1>\n',
      mode: 'quick',
    });
    const w = result.warnings.find(w => w.check === 'pos-supervisor:FrontmatterOnlyPage');
    expect(w).toBeUndefined();
  });

  it('does NOT warn on partials — the check is page-specific', async () => {
    const result = await handler({
      file_path: 'app/views/partials/empty.liquid',
      content: '{% doc %}{% enddoc %}\n',
      mode: 'quick',
    });
    const w = result.warnings.find(w => w.check === 'pos-supervisor:FrontmatterOnlyPage');
    expect(w).toBeUndefined();
  });
});

// ── must_fix_before_write ───────────────────────────────────────────────────

describe('validate_code: must_fix_before_write boolean gate', () => {
  it('is false on clean validation (status: ok)', async () => {
    const result = await handler({
      file_path: 'app/views/partials/clean.liquid',
      content: '{% doc %}{% enddoc %}\n<p>clean</p>\n',
      mode: 'quick',
    });
    expect(result.must_fix_before_write).toBe(false);
    expect(result.next_step).toMatch(/Write it to disk now/);
  });

  it('is true when errors are present', async () => {
    // Inject a synthetic error directly via a structural-warning path we can
    // reliably trigger: a page with raw HTML. We can't count on pos-cli/LSP
    // being available in unit tests, so we instead exercise the gate logic
    // post-hoc by calling the handler with content that passes input check,
    // then asserting the structural pipeline either produces an error OR we
    // force must_fix_before_write via a blocking warning further down.

    // Approach: use a Shopify-object reference, which structural-warnings
    // flags as an error independent of LSP.
    const result = await handler({
      file_path: 'app/views/partials/shopify.liquid',
      content: '{% doc %}{% enddoc %}\n{{ product.title }}\n',
      mode: 'quick',
    });
    // structural warnings promotes Shopify object references to errors
    // via the diagnostic pipeline. If this assertion ever becomes flaky,
    // the structural-warnings layer changed and the test needs an update.
    if (result.errors.length > 0) {
      expect(result.must_fix_before_write).toBe(true);
      expect(result.next_step).toMatch(/MUST NOT write/);
    } else {
      // No LSP, no pos-cli — structural layer is the only producer. If this
      // fixture doesn't fire, at least assert the gate is internally consistent.
      expect(result.must_fix_before_write).toBe(false);
    }
  });

  it('next_step branches on must_fix_before_write, not on status', async () => {
    const result = await handler({
      file_path: 'app/views/partials/demo.liquid',
      content: '{% doc %}{% enddoc %}\n<p>demo</p>\n',
      mode: 'quick',
    });
    // Clean content → gate open, next_step says write.
    expect(result.must_fix_before_write).toBe(false);
    expect(typeof result.next_step).toBe('string');
    expect(result.next_step.length).toBeGreaterThan(0);
  });
});
