/**
 * I4 — force-disable works on check names, not just rule_ids.
 *
 * An operator looking at a HARMFUL row in Rule Performance wants a
 * one-click "stop emitting this diagnostic". Today's force-disable only
 * gates rule_ids inside `runRules()`; structural checks (pos-supervisor:*)
 * and LSP checks without a rule module never hit that path. The fix adds
 * a filter in validate-code.js that drops diagnostics whose check name or
 * rule_id appears in the force-disable set.
 *
 * This test exercises the end-to-end path: write the override file → boot
 * the server → run validate_code → assert the suppressed diagnostic is
 * absent and clearing the override restores it.
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { readFileSync } from 'node:fs';
import { startServer, FIXTURE_DIR, createTempProject } from '../helpers/server.js';
import { loadOverrides } from '../../../src/core/rule-overrides.js';

setDefaultTimeout(60_000);

let server;
let proj;

// A page with inline HTML and no partial renders → triggers
// pos-supervisor:HtmlInPage (our B-tier guard only suppresses when
// renders_used is non-empty, which this content isn't).
const FILE = 'app/views/pages/force-disable-test.liquid';
const CONTENT = '---\nslug: force-disable-test\n---\n<h1>hi</h1>\n';

beforeAll(async () => {
  proj = createTempProject(FIXTURE_DIR);
  server = await startServer(proj.dir);
});

afterAll(() => {
  server?.stop();
  proj?.cleanup();
});

async function runValidate() {
  return server.callTool('validate_code', {
    file_path: FILE,
    content: CONTENT,
    mode: 'quick',
  });
}

describe('force-disable on a check name', () => {
  it('baseline: pos-supervisor:HtmlInPage fires on pure-HTML page', async () => {
    const res = await runValidate();
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])];
    expect(all.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(true);
  });

  it('override suppresses the check; clearing it restores', async () => {
    // Mirror the dashboard button path: POST to the endpoint, which writes
    // the override file AND calls onOverridesChanged so the in-memory
    // engine sees the new set without a restart.
    const addResp = await fetch(server.baseUrl + '/api/engine/rule-overrides', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_disable', rule_id: 'pos-supervisor:HtmlInPage', reason: 'noisy on landing' }),
    });
    const addBody = await addResp.json();
    expect(addResp.status).toBe(200);
    expect(addBody.force_disable?.['pos-supervisor:HtmlInPage']).toBeDefined();
    // Sanity check that the file was written.
    expect(loadOverrides(proj.dir).force_disable['pos-supervisor:HtmlInPage']).toBeDefined();

    const suppressed = await runValidate();
    const suppressedAll = [...(suppressed.errors ?? []), ...(suppressed.warnings ?? [])];
    expect(suppressedAll.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(false);

    // Clear and re-run — the diagnostic returns.
    const clearResp = await fetch(server.baseUrl + '/api/engine/rule-overrides', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', rule_id: 'pos-supervisor:HtmlInPage' }),
    });
    expect(clearResp.ok).toBe(true);
    await clearResp.json();

    const restored = await runValidate();
    const restoredAll = [...(restored.errors ?? []), ...(restored.warnings ?? [])];
    expect(restoredAll.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(true);
  });
});
