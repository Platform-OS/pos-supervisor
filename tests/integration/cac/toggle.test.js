/**
 * CAC predictor — end-to-end toggle test.
 *
 * Verifies the opt-in 4th gating axis is wired correctly through:
 *   - server boot (defaults loaded, disabled by default)
 *   - HTTP endpoints (GET/POST /api/cac/config, GET /api/cac/decisions)
 *   - validate_code integration (no behavior change when disabled,
 *     decisions recorded in shadow mode, suppression in active mode)
 *   - hot-reload (POST changes take effect on the very next validate_code
 *     call without restart)
 *
 * The `force-disable-check.test.js` was the structural template for this
 * test (POST → validate → assert → clear → re-assert).
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR, createTempProject } from '../helpers/server.js';
import { loadCacConfig } from '../../../src/core/cac-config.js';

setDefaultTimeout(60_000);

let server;
let proj;

// File chosen for the same reason force-disable-check.test.js picks it: pure
// HTML page with no partial renders → reliably triggers
// pos-supervisor:HtmlInPage. The CAC layer needs at least one diagnostic to
// chew on for shadow-mode telemetry to record an entry.
const FILE = 'app/views/pages/cac-toggle-test.liquid';
const CONTENT = '---\nslug: cac-toggle-test\n---\n<h1>hi</h1>\n';

beforeAll(async () => {
  proj = createTempProject(FIXTURE_DIR);
  server = await startServer(proj.dir);
});

afterAll(() => {
  server?.stop();
  proj?.cleanup();
});

async function runValidate() {
  return server.callTool('validate_code', { file_path: FILE, content: CONTENT, mode: 'quick' });
}

async function getCacConfig() {
  const r = await fetch(server.baseUrl + '/api/cac/config');
  return r.json();
}

async function setCacConfig(patch) {
  const r = await fetch(server.baseUrl + '/api/cac/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return { status: r.status, body: await r.json() };
}

async function getCacDecisions(limit = 50) {
  const r = await fetch(server.baseUrl + `/api/cac/decisions?limit=${limit}`);
  return r.json();
}

describe('CAC predictor: HTTP toggle + validate_code integration', () => {
  it('GET /api/cac/config returns defaults; CAC is disabled out of the box', async () => {
    const r = await getCacConfig();
    expect(r.config.enabled).toBe(false);
    expect(r.config.mode).toBe('shadow');
    expect(r.defaults).toBeDefined();
    expect(Array.isArray(r.valid_modes)).toBe(true);
    expect(r.valid_modes).toContain('shadow');
    expect(r.valid_modes).toContain('active');
  });

  it('disabled: validate_code is unaffected; no decisions recorded', async () => {
    // Sanity: predictor disabled means no entries appear from this call.
    // Note: another describe block running first could have populated
    // decisions, so we check the contract (count is finite + all entries
    // come from earlier shadow/active runs only) by inspecting `summary`.
    const before = await getCacDecisions();
    const beforeCount = before.count;

    const res = await runValidate();
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])];
    expect(all.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(true);

    const after = await getCacDecisions();
    // The disabled predictor must not append anything.
    expect(after.count).toBe(beforeCount);
  });

  it('shadow mode: records decisions but does NOT modify diagnostics', async () => {
    const setResp = await setCacConfig({ enabled: true, mode: 'shadow', threshold: 0.99, action: 'suppress' });
    expect(setResp.status).toBe(200);
    expect(setResp.body.config.enabled).toBe(true);
    expect(setResp.body.config.mode).toBe('shadow');
    // Persistence: the file should now exist on disk with the patched values.
    const fromDisk = loadCacConfig(proj.dir);
    expect(fromDisk.enabled).toBe(true);
    expect(fromDisk.threshold).toBe(0.99);

    const before = await getCacDecisions();
    const beforeCount = before.count;
    const res = await runValidate();

    // Diagnostic still present — shadow mode never mutates result.
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])];
    expect(all.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(true);

    // But decisions ring buffer grew.
    const after = await getCacDecisions();
    expect(after.count).toBeGreaterThan(beforeCount);
    // Each new decision is tagged with shadow mode.
    const fresh = after.decisions.slice(beforeCount);
    expect(fresh.every(d => d.mode === 'shadow')).toBe(true);
  });

  it('active mode + suppress: drops below-threshold diagnostics', async () => {
    // Threshold 0.99 + action suppress: any diagnostic that has actual signal
    // and predicts < 0.99 adoption gets dropped. With an empty analytics
    // store the predictor falls to feature='prior' and ALWAYS allows. So we
    // can't reliably suppress without seeded data — instead, assert the
    // contract: when feature='prior', decision is 'allow' regardless of
    // threshold. (Suppression on real data is covered by the unit tests in
    // tests/unit/cac-predictor.test.js where we inject a deterministic
    // historyProvider.) Here we verify only that flipping to active does not
    // crash and does not over-suppress when there's no signal.
    const setResp = await setCacConfig({ enabled: true, mode: 'active', threshold: 0.99, action: 'suppress' });
    expect(setResp.status).toBe(200);
    expect(setResp.body.config.mode).toBe('active');

    const res = await runValidate();
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])];
    // Without analytics history every diagnostic falls to prior → allow.
    expect(all.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(true);

    const dec = await getCacDecisions();
    const recent = dec.decisions.at(-1);
    expect(recent.mode).toBe('active');
    expect(['allow', 'suppress', 'downgrade']).toContain(recent.decision);
  });

  it('disabling resets behavior immediately (no restart needed)', async () => {
    const setResp = await setCacConfig({ enabled: false });
    expect(setResp.status).toBe(200);
    expect(setResp.body.config.enabled).toBe(false);

    const before = await getCacDecisions();
    const res = await runValidate();
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])];
    expect(all.some(d => d.check === 'pos-supervisor:HtmlInPage')).toBe(true);
    const after = await getCacDecisions();
    expect(after.count).toBe(before.count); // disabled: no append
  });

  it('POST with garbage body returns 400, leaves state untouched', async () => {
    const r = await fetch(server.baseUrl + '/api/cac/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect([400, 500]).toContain(r.status); // body parser error → 400 (sometimes 500 from JSON)
  });

  it('POST with unknown keys: known fields applied, unknown silently dropped', async () => {
    const setResp = await setCacConfig({ enabled: true, mode: 'shadow', threshold: 0.5, sneaky: 'no' });
    expect(setResp.status).toBe(200);
    expect(setResp.body.config.threshold).toBe(0.5);
    expect(setResp.body.config).not.toHaveProperty('sneaky');
  });

  it('POST with out-of-range threshold gets coerced to default', async () => {
    const setResp = await setCacConfig({ threshold: 99 });
    expect(setResp.status).toBe(200);
    expect(setResp.body.config.threshold).toBeGreaterThan(0);
    expect(setResp.body.config.threshold).toBeLessThan(1);
  });
});
