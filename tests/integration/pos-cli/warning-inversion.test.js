/**
 * Reproduction test for warning inversion bug:
 * Agent reports that full mode drops linter warnings while quick mode preserves them.
 *
 * Tests validate_code on content with known warnings (MissingPage, UnusedAssign)
 * in both full and quick modes and compares results.
 */
import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer } from '../helpers/server.js';
import { join } from 'node:path';

const BROKEN_PROJECT = join(import.meta.dir, '..', '..', 'fixtures', 'broken-project');

setDefaultTimeout(60_000);

let server;
beforeAll(async () => { server = await startServer(BROKEN_PROJECT); });
afterAll(() => server?.stop());

// Content from hardcoded_routes.liquid — produces 3 MissingPage warnings
const HARDCODED_ROUTES_CONTENT = `{% doc %}
  @param product {object} Product data
{% enddoc %}
<a href="/products/{{ product.id }}">View</a>
<a href="/admin/products/{{ product.id }}/edit">Edit</a>
<form action="/products/{{ product.id }}/delete" method="post">
  <button>Delete</button>
</form>`;

// Content from unused.html.liquid — produces 2 UnusedAssign warnings + 1 MissingPartial error
const UNUSED_CONTENT = `---
slug: products/unused
layout: application
---
{% liquid
  assign unused_variable = 'this is never used'
  assign another_unused = context.params.id
  render 'products/no_doc'
%}`;

describePosCli('warning inversion — full vs quick mode parity', () => {
  it('hardcoded_routes: both modes return MissingPage warnings', async () => {
    const full = await server.callTool('validate_code', {
      file_path: 'app/views/partials/errors/hardcoded_routes.liquid',
      content: HARDCODED_ROUTES_CONTENT,
      mode: 'full',
    });

    const quick = await server.callTool('validate_code', {
      file_path: 'app/views/partials/errors/hardcoded_routes.liquid',
      content: HARDCODED_ROUTES_CONTENT,
      mode: 'quick',
    });

    console.log('--- hardcoded_routes FULL mode ---');
    console.log(`  errors: ${full.errors.length}, warnings: ${full.warnings.length}, infos: ${full.infos.length}`);
    console.log('  warning checks:', full.warnings.map(w => w.check));

    console.log('--- hardcoded_routes QUICK mode ---');
    console.log(`  errors: ${quick.errors.length}, warnings: ${quick.warnings.length}, infos: ${quick.infos.length}`);
    console.log('  warning checks:', quick.warnings.map(w => w.check));

    // Both modes must return MissingPage warnings (not zero)
    const fullMissing = full.warnings.filter(w => w.check === 'MissingPage');
    const quickMissing = quick.warnings.filter(w => w.check === 'MissingPage');
    expect(fullMissing.length).toBeGreaterThan(0);
    expect(quickMissing.length).toBeGreaterThan(0);

    // Both modes should have similar warning count types
    // (minor LSP non-determinism on cold vs warm calls is acceptable)
    const fullChecks = new Set(full.warnings.map(w => w.check));
    const quickChecks = new Set(quick.warnings.map(w => w.check));
    expect(fullChecks.has('MissingPage')).toBe(true);
    expect(quickChecks.has('MissingPage')).toBe(true);
  });

  it('unused.html.liquid: full mode preserves UnusedAssign warnings', async () => {
    const full = await server.callTool('validate_code', {
      file_path: 'app/views/pages/products/unused.html.liquid',
      content: UNUSED_CONTENT,
      mode: 'full',
    });

    const quick = await server.callTool('validate_code', {
      file_path: 'app/views/pages/products/unused.html.liquid',
      content: UNUSED_CONTENT,
      mode: 'quick',
    });

    console.log('--- unused.html.liquid FULL mode ---');
    console.log(`  errors: ${full.errors.length}, warnings: ${full.warnings.length}, infos: ${full.infos.length}`);
    console.log('  error checks:', full.errors.map(e => e.check));
    console.log('  warning checks:', full.warnings.map(w => w.check));
    console.log('  info checks:', full.infos.map(i => `${i.check}: ${i.message}`));

    console.log('--- unused.html.liquid QUICK mode ---');
    console.log(`  errors: ${quick.errors.length}, warnings: ${quick.warnings.length}, infos: ${quick.infos.length}`);
    console.log('  error checks:', quick.errors.map(e => e.check));
    console.log('  warning checks:', quick.warnings.map(w => w.check));

    // Quick mode should have warnings (baseline)
    expect(quick.warnings.length).toBeGreaterThan(0);

    // Full mode MUST also have warnings
    expect(full.warnings.length).toBeGreaterThanOrEqual(quick.warnings.length);
  });

  it('simple content: both modes produce same warning count', async () => {
    // Simple content with a known UnusedAssign warning
    const content = `{% assign never_used = 'hello' %}\n<p>Hello</p>`;

    const full = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_warning_parity.liquid',
      content,
      mode: 'full',
    });

    const quick = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_warning_parity.liquid',
      content,
      mode: 'quick',
    });

    console.log('--- simple content FULL mode ---');
    console.log(`  errors: ${full.errors.length}, warnings: ${full.warnings.length}`);
    console.log('  warning checks:', full.warnings.map(w => w.check));

    console.log('--- simple content QUICK mode ---');
    console.log(`  errors: ${quick.errors.length}, warnings: ${quick.warnings.length}`);
    console.log('  warning checks:', quick.warnings.map(w => w.check));

    // Both modes should have same linter warnings
    expect(full.warnings.length).toBe(quick.warnings.length);
  });
});
