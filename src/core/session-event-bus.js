import { join } from 'node:path';
import { makeEvent, createEventWriter, readEventLog } from './session-events.js';
import { initialState, applyEvent, replay } from './session-state.js';

/**
 * Session event bus.
 *
 * Owns three things in one place:
 *   1. The append-only NDJSON writer for `<sessionDir>/<sessionId>/events.ndjson`
 *   2. The in-memory projection (built incrementally via `applyEvent`)
 *   3. The periodic replay invariant — every interval (and on close), the bus
 *      replays the on-disk log from scratch and asserts it equals the live
 *      projection. On mismatch the disk wins (we replace the projection with
 *      the replay) and the drift is logged. This is what catches the failure
 *      mode where someone bypasses the bus and mutates state directly.
 *
 * Strict failure model: NOTHING the bus does is allowed to throw into the
 * caller's request path. Bad event payloads, full disks, fsync rejections —
 * all are caught, logged, and swallowed. The bus is observability, not
 * correctness; the live tool path must never break because telemetry broke.
 */

export const DEFAULT_INVARIANT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {object} opts
 * @param {string} opts.sessionId      — caller-supplied stable id (server.js owns this)
 * @param {string} opts.sessionsDir    — base sessions dir (e.g. ./.pos-supervisor/sessions)
 * @param {(msg:string)=>void} [opts.log]
 * @param {boolean} [opts.fsync=true]  — fsync after every append (durability)
 * @param {(now:Date)=>string} [opts.clock] — testable clock; defaults to ISO now
 */
export function startSessionEventBus({
  sessionId,
  sessionsDir,
  log,
  fsync = true,
  clock = () => new Date().toISOString(),
}) {
  if (!sessionId) throw new Error('startSessionEventBus: sessionId required');
  if (!sessionsDir) throw new Error('startSessionEventBus: sessionsDir required');

  const eventsPath = join(sessionsDir, sessionId, 'events.ndjson');

  let writer = null;
  let writerError = null;
  try {
    writer = createEventWriter(eventsPath, { fsync });
  } catch (e) {
    writerError = e.message;
    log?.(`session-event-bus: writer open failed (${e.message}); events will not be persisted`);
  }

  let state = initialState();
  let lastInvariant = { ok: true, ts: null, mismatchKeys: [] };
  let invariantTimer = null;
  let closed = false;

  function safeLog(msg) { try { log?.(msg); } catch {} }

  function emit(kind, payload = {}, ts = clock()) {
    if (closed) return false;
    let event;
    try {
      event = makeEvent({ session_id: sessionId, ts, kind, payload });
    } catch (e) {
      safeLog(`session-event-bus: invalid ${kind} payload — ${e.message}`);
      return false;
    }
    if (writer && !writer.isClosed) {
      try {
        writer.append(event);
      } catch (e) {
        safeLog(`session-event-bus: append failed (${e.message}) — projection still updated`);
      }
    }
    try {
      state = applyEvent(state, event);
    } catch (e) {
      // applyEvent is pure and total — but defend in depth.
      safeLog(`session-event-bus: apply failed for ${kind} — ${e.message}`);
    }
    return true;
  }

  function getProjection() {
    return state;
  }

  function runInvariantCheck() {
    if (closed) return lastInvariant;
    if (!writer || writerError) {
      lastInvariant = { ok: true, ts: clock(), mismatchKeys: [], skipped: 'no-writer' };
      return lastInvariant;
    }
    try {
      const events = readEventLog(eventsPath, {
        onError: (e) => safeLog(`session-event-bus: skipping malformed event line ${e.line}: ${e.message}`),
      });
      const replayed = replay(events);
      const mismatchKeys = diffStateKeys(replayed, state);
      const ok = mismatchKeys.length === 0;
      lastInvariant = { ok, ts: clock(), mismatchKeys };
      if (!ok) {
        safeLog(`session-event-bus: invariant FAIL — replay diverged from projection on keys: ${mismatchKeys.join(', ')}; resetting projection to replay`);
        state = replayed;
      }
      return lastInvariant;
    } catch (e) {
      lastInvariant = { ok: false, ts: clock(), mismatchKeys: [], error: e.message };
      safeLog(`session-event-bus: invariant check threw — ${e.message}`);
      return lastInvariant;
    }
  }

  function startInvariantInterval(ms = DEFAULT_INVARIANT_INTERVAL_MS) {
    if (invariantTimer) return;
    invariantTimer = setInterval(() => { try { runInvariantCheck(); } catch {} }, ms);
    // Don't keep the event loop alive just for this timer.
    if (typeof invariantTimer.unref === 'function') invariantTimer.unref();
  }

  function close() {
    if (closed) return;
    closed = true;
    if (invariantTimer) {
      try { clearInterval(invariantTimer); } catch {}
      invariantTimer = null;
    }
    try { runInvariantCheck(); } catch {}
    if (writer && !writer.isClosed) {
      try { writer.close(); } catch {}
    }
  }

  return {
    emit,
    getProjection,
    runInvariantCheck,
    startInvariantInterval,
    close,
    get eventsPath() { return eventsPath; },
    get isClosed() { return closed; },
    get sessionId() { return sessionId; },
    get lastInvariant() { return lastInvariant; },
    get writerError() { return writerError; },
  };
}

// ── State diff (for invariant check) ────────────────────────────────────────
//
// We compare top-level keys with structural equality and report which keys
// drifted. Faster + clearer than a generic deepEqual diff dump, and it
// surfaces the divergence at the granularity the reducer thinks in
// (per-projection-section).
function diffStateKeys(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const drifted = [];
  for (const k of keys) {
    if (!stableEqual(a[k], b[k])) drifted.push(k);
  }
  return drifted;
}

function stableEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!stableEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!stableEqual(a[ak[i]], b[ak[i]])) return false;
  }
  return true;
}
