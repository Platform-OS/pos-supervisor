import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

/**
 * Structured JSONL logger for pos-supervisor server events.
 * Same pattern as the OpenCode plugin logger.
 */
export function createLogger({ directory, version }) {
  const logPath = join(directory, 'pos-supervisor.jsonl');
  let stream = null;

  try {
    stream = createWriteStream(logPath, { flags: 'a' });
  } catch {
    // Logging is best-effort
  }

  function emit(event, data = {}) {
    if (!stream) return;
    try {
      const entry = {
        ts: new Date().toISOString(),
        v: version,
        event,
        ...data,
      };
      stream.write(JSON.stringify(entry) + '\n');
    } catch {
      // Best effort
    }
  }

  function log(msg) {
    process.stderr.write(`[pos-supervisor] ${msg}\n`);
    emit('log', { message: msg });
  }

  function close() {
    if (stream) {
      try { stream.end(); } catch {}
    }
  }

  return { emit, log, close, logPath };
}
