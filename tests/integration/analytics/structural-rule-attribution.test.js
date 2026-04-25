/**
 * Structural-warning → rule-engine bridge (2026-04-24 fix).
 *
 * Before the bridge, structural checks with rule modules (like
 * `pos-supervisor:NonGetRenderingPage`) landed in analytics as
 * `<Check>.unmatched` because their rule modules never got invoked —
 * enrichAll runs before structural warnings are pushed. The bridge calls
 * runRules() a second time on any diagnostic still missing rule_id.
 *
 * This test drives a real validate_code call that emits a structural
 * warning and asserts the resulting validator_emit carries the rule's
 * canonical rule_id, not the `.unmatched` fallback.
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, FIXTURE_DIR, createTempProject } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
let proj;

beforeAll(async () => {
  proj = createTempProject(FIXTURE_DIR);
  server = await startServer(proj.dir);
});

afterAll(() => {
  server?.stop();
  proj?.cleanup();
});

function readValidatorEmits(projectDir) {
  const sessionsDir = join(projectDir, '.pos-supervisor', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const entries = readdirSync(sessionsDir, { withFileTypes: true }).filter(e => e.isDirectory());
  const out = [];
  for (const entry of entries) {
    const eventsPath = join(sessionsDir, entry.name, 'events.ndjson');
    if (!existsSync(eventsPath)) continue;
    for (const line of readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean)) {
      try {
        const ev = JSON.parse(line);
        if (ev.kind === 'validator_emit') out.push(ev);
      } catch { /* skip */ }
    }
  }
  return out;
}

describe('structural rule attribution via bridge', () => {
  // A page with method: post + HTML body — exactly the NonGetRenderingPage
  // trigger. No slug under /api/, renders inline HTML and interpolates a
  // variable so the UI-signal heuristics match.
  it('NonGetRenderingPage lands as "NonGetRenderingPage.default", not ".unmatched"', async () => {
    const FILE = 'app/views/pages/ngrp-bridge-test.liquid';
    const CONTENT = '---\nslug: ngrp-bridge-test\nmethod: post\nlayout: application\n---\n<h1>form</h1>\n<form>{{ x }}</form>\n';

    await server.callTool('validate_code', {
      file_path: FILE,
      content: CONTENT,
      mode: 'quick',
    });

    await new Promise(r => setTimeout(r, 100));

    const emits = readValidatorEmits(proj.dir);
    const ngrp = emits.find(e => e.file === FILE && e.check === 'pos-supervisor:NonGetRenderingPage');
    expect(ngrp).toBeDefined();
    expect(ngrp.hint_rule_id).toBe('NonGetRenderingPage.default');
    // Confidence also propagates through the bridge.
    expect(ngrp.confidence).toBe(0.9);
  });
});
