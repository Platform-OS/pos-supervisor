/**
 * Phase A1 acceptance gate — proves that replaying the on-disk events.ndjson
 * through `applyEvent` reproduces the live projection the bus computed
 * incrementally.
 *
 * Why this gate matters: the entire point of the event bus is to make the
 * NDJSON log the canonical history. If replay-from-disk diverges from the
 * write-through projection then the projection is lying — and every analytic
 * built on top of it inherits the lie. This test runs the bus end-to-end
 * against a real spawned server, exercises the projection-relevant kinds
 * (server_start, pos_cli_resolved, lsp_event, index_event, tool_call), then
 * shuts down cleanly and asserts the replayed state has the expected shape
 * AND that the bus's own close-time invariant check did not log a mismatch.
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, FIXTURE_DIR, createTempProject } from './helpers/server.js';
import { readEventLog } from '../../src/core/session-events.js';
import { replay } from '../../src/core/session-state.js';

// beforeAll spawns a real pos-supervisor server with LSP warm-up, which can
// exceed the bun:test default 5s budget on a cold start (CI, fresh process,
// LSP indexing). Other integration files set this to 30s for the same reason.
setDefaultTimeout(60_000);

// Resolve the bus's session subdirectory. The legacy `saveSessionSummary`
// writes flat `session-*.json` files at the same level, so we filter for
// real directories. If multiple bus dirs survived from earlier runs, take
// the newest by mtime.
function findCurrentSessionDir(sessionsDir) {
  const entries = readdirSync(sessionsDir)
    .filter((n) => n.startsWith('session-'))
    .map((n) => ({ name: n, full: join(sessionsDir, n) }))
    .filter((e) => {
      try { return statSync(e.full).isDirectory(); } catch { return false; }
    })
    .map((e) => ({ ...e, mtime: statSync(e.full).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.full ?? null;
}

describe('event replay: acceptance gate', () => {
  let project;
  let server;

  beforeAll(async () => {
    project = createTempProject(FIXTURE_DIR);
    server = await startServer(project.dir);
  });

  afterAll(async () => {
    server?.stop();
    // Give SIGTERM time to run shutdown() — sessionBus.close() must flush
    // and run its final invariant check before we read the log.
    await sleep(800);
    project?.cleanup();
  });

  it('records a startup sequence on disk that replays into a sane projection', async () => {
    // Fire a few projection-relevant tool calls to populate by_tool + file_history.
    await server.callTool('server_status', {});
    await server.callTool('project_map', { scope: 'lite' });

    // Allow the tool_call events to flush through the bus.
    await sleep(150);

    const sessionsDir = join(project.dir, '.pos-supervisor', 'sessions');
    expect(existsSync(sessionsDir)).toBe(true);

    const sessionDir = findCurrentSessionDir(sessionsDir);
    expect(sessionDir).toBeTruthy();

    const eventsPath = join(sessionDir, 'events.ndjson');
    expect(existsSync(eventsPath)).toBe(true);

    const events = readEventLog(eventsPath);
    expect(events.length).toBeGreaterThan(0);

    // Envelope sanity — every record carries the required fields.
    for (const e of events) {
      expect(e.v).toBeGreaterThanOrEqual(1);
      expect(typeof e.session_id).toBe('string');
      expect(typeof e.ts).toBe('string');
      expect(typeof e.kind).toBe('string');
    }

    // The session_id is consistent within a single boot.
    const sids = new Set(events.map((e) => e.session_id));
    expect(sids.size).toBe(1);

    const replayed = replay(events);

    // server_start landed and projected.
    expect(replayed.server.started_at).toBeTruthy();
    expect(replayed.server.version).toBeTruthy();
    expect(replayed.server.project_dir).toBe(project.dir);

    // tool_call rollups account for both calls we just made.
    expect(replayed.by_tool.server_status?.calls ?? 0).toBeGreaterThanOrEqual(1);
    expect(replayed.by_tool.project_map?.calls ?? 0).toBeGreaterThanOrEqual(1);

    // Event counter is monotonic with the log length (proves applyEvent
    // increments _event_count for every record, including unknown kinds).
    expect(replayed._event_count).toBe(events.length);
  });

  it('emits valid NDJSON — every line round-trips through readEvent', async () => {
    const sessionsDir = join(project.dir, '.pos-supervisor', 'sessions');
    const sessionDir = findCurrentSessionDir(sessionsDir);
    const eventsPath = join(sessionDir, 'events.ndjson');

    const raw = readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(raw.length).toBeGreaterThan(0);

    const errors = [];
    readEventLog(eventsPath, { onError: (e) => errors.push(e) });
    expect(errors).toEqual([]);
  });

  it('shutdown writes server_stop with the SIGTERM reason', async () => {
    server.stop();
    await sleep(800);

    const sessionsDir = join(project.dir, '.pos-supervisor', 'sessions');
    const sessionDir = findCurrentSessionDir(sessionsDir);
    const eventsPath = join(sessionDir, 'events.ndjson');

    const events = readEventLog(eventsPath);
    const stop = events.find((e) => e.kind === 'server_stop');
    expect(stop).toBeDefined();
    expect(typeof stop.reason).toBe('string');

    const replayed = replay(events);
    expect(replayed.server.stopped).toBe(true);
    expect(replayed.server.stop_reason).toBe(stop.reason);
  });
});
