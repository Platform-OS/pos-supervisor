import { z } from 'zod';
import { createWriteStream, openSync, writeSync, fsyncSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Session event schema + version registry.
 *
 * The on-disk NDJSON log at `./.pos-supervisor/sessions/<id>/events.ndjson`
 * is the canonical history of a session. Every state-changing observation
 * the server makes is appended as one event line. Live in-memory state
 * (see `session-state.js`) is a *projection* of this log built by replaying
 * events through a pure reducer.
 *
 * Versioning policy (see docs/validator-platform-roadmap.md §3.3):
 *   - Append-only: events on disk are NEVER rewritten.
 *   - Each event carries a `v` field; `upgraders[v]` lifts an old shape to
 *     the current shape at READ time. Adding optional fields does not
 *     require a bump (we use Zod `.passthrough()` on read). Removing a
 *     field, renaming, or changing semantics requires a bump and a new
 *     upgrader entry.
 */

export const EVENT_VERSION = 1;

// ── Common envelope ──────────────────────────────────────────────────────────
//
// All events share these top-level fields. The reducer is pure: it must NOT
// call `Date.now()` or read external state — every input it needs lives in
// the event payload (including `ts`).
const EnvelopeBase = {
  v: z.number().int().positive(),
  session_id: z.string().min(1),
  ts: z.string().min(1), // ISO timestamp, supplied by emitter
};

// ── Per-kind payload schemas ─────────────────────────────────────────────────
//
// Each `kind` has a payload schema. We compose at the registry level rather
// than inline so the reducer can introspect known kinds.

const ServerStartPayload = z.object({
  project_dir: z.string(),
  version: z.string(),
  http_port: z.number().int().nonnegative().optional(),
  started_at: z.string(),
});

const ServerStopPayload = z.object({
  reason: z.string(),
});

const PosCliResolvedPayload = z.object({
  found: z.boolean(),
  path: z.string().nullable().optional(),
  data_dir: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

const LspEventPayload = z.object({
  phase: z.enum([
    'init_failed',
    'warmed_up',
    'ready',
    'crash',
    'restart_requested',
    'restart_failed',
  ]),
  duration_ms: z.number().nonnegative().optional(),
  error: z.string().optional(),
  code: z.number().nullable().optional(),
  signal: z.string().nullable().optional(),
  restart_count: z.number().int().nonnegative().optional(),
  index_ready: z.number().int().nonnegative().optional(),
});

const IndexEventPayload = z.object({
  index: z.enum(['schema', 'objects', 'filters', 'tags', 'all']),
  status: z.enum(['ready', 'failed']),
  count: z.number().int().nonnegative().optional(),
  queries: z.number().int().nonnegative().optional(),
  mutations: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

// Field is `op` (not `kind`) because the envelope already owns `kind`; spreading
// a payload field of the same name would silently overwrite the event type.
const FsChangePayload = z.object({
  path: z.string(),
  op: z.enum(['create', 'update', 'delete']),
});

// ToolCall input/output are deliberately permissive — tools evolve and their
// argument/return shapes are validated at the tool boundary, not here. The
// reducer reads only well-known fields (tool, success, output.errors, etc.).
const ToolCallPayload = z.object({
  tool: z.string(),
  duration_ms: z.number().nonnegative(),
  success: z.boolean(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

// validator_emit (Phase A5) — schema reserved here so the upgrader registry
// stays in one place; A5 populates its writer wiring.
const ValidatorEmitPayload = z.object({
  fp: z.string(),
  template_fp: z.string().optional(),
  file: z.string(),
  content_hash: z.string().optional(),
  hint_md_hash: z.string().nullable().optional(),
  hint_rule_id: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  proposed_fixes: z.array(z.object({
    range: z.unknown(),
    new_text_hash: z.string(),
    kind: z.string(),
  })).default([]),
});

const LogPayload = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  message: z.string(),
});

// Registry: kind → payload schema. Used for validation + introspection.
export const KIND_SCHEMAS = Object.freeze({
  server_start: ServerStartPayload,
  server_stop: ServerStopPayload,
  pos_cli_resolved: PosCliResolvedPayload,
  lsp_event: LspEventPayload,
  index_event: IndexEventPayload,
  fs_change: FsChangePayload,
  tool_call: ToolCallPayload,
  validator_emit: ValidatorEmitPayload,
  log: LogPayload,
});

export const KNOWN_KINDS = Object.freeze(Object.keys(KIND_SCHEMAS));

// Strict envelope used on the WRITE path: every event must carry a known kind
// + a payload that validates against KIND_SCHEMAS[kind]. Unknown kinds throw.
const StrictEvent = z.object({
  ...EnvelopeBase,
  kind: z.enum(KNOWN_KINDS),
}).passthrough().superRefine((event, ctx) => {
  const schema = KIND_SCHEMAS[event.kind];
  if (!schema) return;
  // Pull payload as everything except envelope keys.
  const { v, session_id, ts, kind, ...payload } = event;
  const result = schema.safeParse(payload);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ ...issue, path: ['payload', ...(issue.path || [])] });
    }
  }
});

// ── Version upgraders ────────────────────────────────────────────────────────
//
// Each upgrader transforms an event written at version N into the version-N+1
// shape. Run in sequence: v1 -> v2 -> ... -> CURRENT. Today we have only v1,
// so the registry is a single identity entry — kept here so the contract is
// explicit and the next bump has an obvious home.
const UPGRADERS = Object.freeze({
  // 1: (event) => upgradeV1ToV2(event),
});

/**
 * Read one event line from NDJSON: parse JSON → upgrade through versions →
 * validate against current schema. Throws on malformed input or unknown
 * upgrade path so the caller can decide whether to skip or fail.
 */
export function readEvent(line) {
  if (typeof line !== 'string' || line.trim() === '') {
    throw new Error('readEvent: empty line');
  }
  let raw;
  try {
    raw = JSON.parse(line);
  } catch (e) {
    throw new Error(`readEvent: invalid JSON (${e.message})`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('readEvent: not an object');
  }
  if (typeof raw.v !== 'number') {
    throw new Error('readEvent: missing version field "v"');
  }
  if (raw.v > EVENT_VERSION) {
    throw new Error(`readEvent: event version ${raw.v} is newer than reader version ${EVENT_VERSION}`);
  }
  let upgraded = raw;
  for (let v = raw.v; v < EVENT_VERSION; v++) {
    const upgrader = UPGRADERS[v];
    if (!upgrader) {
      throw new Error(`readEvent: missing upgrader for v${v} -> v${v + 1}`);
    }
    upgraded = upgrader(upgraded);
  }
  upgraded.v = EVENT_VERSION;
  return StrictEvent.parse(upgraded);
}

/**
 * Validate an event being written. Returns a frozen, validated copy.
 * Throws ZodError on bad shape — call BEFORE durability so we never
 * persist garbage.
 */
export function validateEvent(event) {
  return Object.freeze(StrictEvent.parse(event));
}

// Reserved envelope keys — payloads must NOT use these as top-level field
// names. Enforced in `makeEvent` so collisions like "fs_change.kind would
// overwrite envelope.kind" can't slip past code review.
const ENVELOPE_KEYS = new Set(['v', 'session_id', 'ts', 'kind']);

/**
 * Build an event envelope. The caller owns the timestamp so the reducer
 * stays pure (no clock reads inside reducers).
 */
export function makeEvent({ session_id, ts, kind, payload = {} }) {
  if (!session_id) throw new Error('makeEvent: session_id required');
  if (!ts) throw new Error('makeEvent: ts required');
  if (!KIND_SCHEMAS[kind]) throw new Error(`makeEvent: unknown kind "${kind}"`);
  for (const k of Object.keys(payload)) {
    if (ENVELOPE_KEYS.has(k)) {
      throw new Error(`makeEvent: payload uses reserved envelope key "${k}"`);
    }
  }
  return validateEvent({ v: EVENT_VERSION, session_id, ts, kind, ...payload });
}

// ── Append-only NDJSON writer ────────────────────────────────────────────────
//
// Order of operations per event (see roadmap §3.3 runtime model):
//   1. Build envelope (caller)
//   2. Validate (validateEvent — throws on bad shape)
//   3. Append to NDJSON + fsync (durability — this writer)
//   4. Apply to in-memory cache (caller)
//
// We open the file with O_APPEND so concurrent writes from the same process
// are atomic up to the OS write boundary (typically PIPE_BUF). After every
// write we fsync the fd to flush kernel buffers — the modest latency cost
// is the price of "if the process dies after step 3, replay is correct."

export function createEventWriter(filePath, { fsync = true } = {}) {
  if (!filePath) throw new Error('createEventWriter: filePath required');
  mkdirSync(dirname(filePath), { recursive: true });
  let fd = openSync(filePath, 'a');
  let closed = false;

  function append(event) {
    if (closed) throw new Error('createEventWriter: writer is closed');
    const line = JSON.stringify(event) + '\n';
    writeSync(fd, line);
    if (fsync) {
      try { fsyncSync(fd); } catch { /* fsync best-effort across exotic fs */ }
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    try { closeSync(fd); } catch {}
  }

  return { append, close, get path() { return filePath; }, get isClosed() { return closed; } };
}

/**
 * Read every event from an NDJSON file. Skips and reports malformed lines
 * via the optional `onError` callback (default: silent skip). Returns the
 * full validated event array.
 */
export function readEventLog(filePath, { onError } = {}) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    try {
      events.push(readEvent(line));
    } catch (e) {
      if (onError) onError({ line: i + 1, message: e.message, raw: line });
    }
  }
  return events;
}

// Streaming writer that uses a Node WriteStream — useful when we want
// non-blocking writes and accept eventual durability (no fsync per line).
// Reserved for high-volume telemetry kinds; default writer above is what
// the reducer pipeline uses.
export function createStreamingEventWriter(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { flags: 'a' });
  let closed = false;
  return {
    append(event) {
      if (closed) throw new Error('createStreamingEventWriter: writer is closed');
      stream.write(JSON.stringify(event) + '\n');
    },
    close() {
      if (closed) return;
      closed = true;
      try { stream.end(); } catch {}
    },
    get path() { return filePath; },
    get isClosed() { return closed; },
  };
}
