/**
 * A3 — `_source: 'dashboard_live'` must not pollute analytics.
 *
 * The dashboard Live Diagnostic Console calls `validate_code` against
 * experimental snippets. Those calls are interactive debugging, not agent
 * activity — they must not write tool_call events, validator_emit events, or
 * session-state mutations to the analytics pipeline.
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

function readSessionEvents(projectDir) {
  const sessionsDir = join(projectDir, '.pos-supervisor', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const entries = readdirSync(sessionsDir, { withFileTypes: true })
    .filter(e => e.isDirectory());
  const events = [];
  for (const entry of entries) {
    const eventsPath = join(sessionsDir, entry.name, 'events.ndjson');
    if (!existsSync(eventsPath)) continue;
    const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  }
  return events;
}

describe('_source: dashboard_live gates analytics writes (A3)', () => {
  const SNIPPET_PATH = 'app/views/partials/__pos_live_console__.liquid';
  const SNIPPET_CONTENT = "{% assign foo = 'bar' %}\n<p>{{ foo }}</p>\n";

  it('tracked validate_code writes a tool_call + validator_emit', async () => {
    const before = readSessionEvents(proj.dir);
    const beforeToolCalls = before.filter(e => e.kind === 'tool_call').length;
    const beforeValidatorEmits = before.filter(e => e.kind === 'validator_emit').length;

    await server.callTool('validate_code', {
      file_path: SNIPPET_PATH,
      content: SNIPPET_CONTENT,
      mode: 'quick',
    });

    // Give the writer a tick to flush.
    await new Promise(r => setTimeout(r, 50));

    const after = readSessionEvents(proj.dir);
    const afterToolCalls = after.filter(e => e.kind === 'tool_call').length;
    const afterValidatorEmits = after.filter(e => e.kind === 'validator_emit').length;

    expect(afterToolCalls).toBeGreaterThan(beforeToolCalls);
    // UnusedAssign fires on the live-console snippet → at least one emit.
    expect(afterValidatorEmits).toBeGreaterThan(beforeValidatorEmits);
  });

  it('untracked validate_code (dashboard_live) emits no tool_call or validator_emit', async () => {
    const before = readSessionEvents(proj.dir);
    const beforeToolCalls = before.filter(e => e.kind === 'tool_call').length;
    const beforeValidatorEmits = before.filter(e => e.kind === 'validator_emit').length;

    await server.callTool('validate_code', {
      file_path: SNIPPET_PATH,
      content: SNIPPET_CONTENT,
      mode: 'quick',
      _source: 'dashboard_live',
    });

    await new Promise(r => setTimeout(r, 50));

    const after = readSessionEvents(proj.dir);
    const afterToolCalls = after.filter(e => e.kind === 'tool_call').length;
    const afterValidatorEmits = after.filter(e => e.kind === 'validator_emit').length;

    expect(afterToolCalls).toBe(beforeToolCalls);
    expect(afterValidatorEmits).toBe(beforeValidatorEmits);
  });

  it('untracked validate_code still returns diagnostics to the caller', async () => {
    const result = await server.callTool('validate_code', {
      file_path: SNIPPET_PATH,
      content: SNIPPET_CONTENT,
      mode: 'quick',
      _source: 'dashboard_live',
    });
    // The live console depends on this return path — untracked must not drop
    // the response; only the analytics emission is gated.
    expect(result).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('ctx.untracked is cleared after the call so subsequent tracked calls emit again', async () => {
    // Run untracked first, then tracked — the second call must write events.
    await server.callTool('validate_code', {
      file_path: SNIPPET_PATH,
      content: SNIPPET_CONTENT,
      mode: 'quick',
      _source: 'dashboard_live',
    });

    const before = readSessionEvents(proj.dir);
    const beforeToolCalls = before.filter(e => e.kind === 'tool_call').length;

    await server.callTool('validate_code', {
      file_path: SNIPPET_PATH,
      content: SNIPPET_CONTENT,
      mode: 'quick',
    });

    await new Promise(r => setTimeout(r, 50));

    const after = readSessionEvents(proj.dir);
    const afterToolCalls = after.filter(e => e.kind === 'tool_call').length;

    expect(afterToolCalls).toBeGreaterThan(beforeToolCalls);
  });
});
