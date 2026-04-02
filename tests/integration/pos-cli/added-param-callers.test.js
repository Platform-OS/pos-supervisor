/**
 * Tests for cross-file AddedParam detection.
 *
 * Scenario: products/no_doc.liquid exists without {% doc %}. Agent adds @params.
 * Section 2d should warn about callers that need updating.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, createTempProject } from '../helpers/server.js';
import { join } from 'node:path';

const BROKEN_PROJECT = join(import.meta.dir, '..', '..', 'fixtures', 'broken-project');

setDefaultTimeout(60_000);

let server, tempProject;
beforeAll(async () => {
  // Use a temp copy so we don't mutate the fixture
  tempProject = createTempProject(BROKEN_PROJECT);
  server = await startServer(tempProject.dir);
});
afterAll(() => {
  server?.stop();
  tempProject?.cleanup();
});

// Content that adds @params to the existing no_doc.liquid (which has no {% doc %})
const CONTENT_WITH_PARAMS = `{% doc %}
  @param title {string}
  @param description {string}
{% enddoc %}
<div class="card">
  <h3>{{ title }}</h3>
  <p>{{ description }}</p>
</div>`;

describePosCli('AddedParam — cross-file caller detection', () => {
  it('full mode warns about callers when adding @params to existing partial', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/products/no_doc.liquid',
      content: CONTENT_WITH_PARAMS,
      mode: 'full',
    });

    console.log('--- AddedParam full mode ---');
    console.log(`  valid: ${result.valid}`);
    console.log(`  errors: ${result.errors.length}, warnings: ${result.warnings.length}`);
    console.log('  warning checks:', result.warnings.map(w => w.check));
    console.log('  warnings:', result.warnings.map(w => `[${w.check}] ${w.message}`));

    const addedParam = result.warnings.filter(w => w.check === 'pos-supervisor:AddedParam');
    expect(addedParam.length).toBeGreaterThan(0);

    // Should mention the specific params
    expect(addedParam[0].message).toContain('title');
    expect(addedParam[0].message).toContain('description');

    // Should mention callers
    expect(addedParam[0].message).toMatch(/caller/i);
  });

  it('quick mode does NOT produce AddedParam (diff-aware is full-only)', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/products/no_doc.liquid',
      content: CONTENT_WITH_PARAMS,
      mode: 'quick',
    });

    console.log('--- AddedParam quick mode ---');
    console.log(`  valid: ${result.valid}`);
    console.log(`  warnings:`, result.warnings.map(w => `[${w.check}] ${w.message}`));

    const addedParam = result.warnings.filter(w => w.check === 'pos-supervisor:AddedParam');
    // Currently full-mode only — document this behavior
    console.log(`  AddedParam warnings: ${addedParam.length} (expected 0 — quick mode skips diff-aware)`);
    expect(addedParam.length).toBe(0);
  });

  it('new partial with @params warns about existing callers (pre-write)', async () => {
    // products/index.html.liquid renders 'products/nonexistent_widget'
    // but that partial file does NOT exist on disk → isPreWrite = true.
    // Creating it with @params should warn that index.html.liquid needs updating.
    const newPartialContent = `{% doc %}
  @param widget_title {string}
  @param widget_data {object}
{% enddoc %}
<div>{{ widget_title }}: {{ widget_data }}</div>`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/products/nonexistent_widget.liquid',
      content: newPartialContent,
      mode: 'full',
    });

    console.log('--- New partial with callers (pre-write) ---');
    console.log(`  valid: ${result.valid}`);
    console.log('  warnings:', result.warnings.map(w => `[${w.check}] ${w.message}`));

    const callerWarning = result.warnings.filter(w => w.check === 'pos-supervisor:NewPartialParams');
    expect(callerWarning.length).toBe(1);
    expect(callerWarning[0].message).toContain('widget_title');
    expect(callerWarning[0].message).toContain('widget_data');
    expect(callerWarning[0].message).toContain('index.html.liquid');
  });

  it('new partial with @params but NO callers — no warning', async () => {
    const newPartialContent = `{% doc %}
  @param title {string}
{% enddoc %}
<h1>{{ title }}</h1>`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/products/brand_new_nobody_renders_this.liquid',
      content: newPartialContent,
      mode: 'full',
    });

    console.log('--- New partial (no callers) ---');
    console.log('  warnings:', result.warnings.map(w => `[${w.check}]`));

    const callerWarning = result.warnings.filter(w => w.check === 'pos-supervisor:NewPartialParams');
    expect(callerWarning.length).toBe(0);
  });
});
