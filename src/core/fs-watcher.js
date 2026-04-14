/**
 * File system watcher — keeps the LSP's cross-reference index fresh when files
 * are written outside the LSP's textDocument/didChange flow (e.g. by scaffold,
 * by the agent's Write tool, or by the user editing files in another editor).
 *
 * ----- Why this exists -----
 * The pos-cli LSP builds its project index on startup. When a translation file
 * or page is written AFTER the LSP started, its `TranslationKeyExists` and
 * `MissingPage` checks cannot see the new content and report false-positive
 * errors for the rest of the session. The roadmap calls this "stale LSP index"
 * (findings F-014 / F-015).
 *
 * ----- What it does -----
 * 1. Walks each target directory (translations, views/pages, schema) and
 *    attaches a non-recursive `fs.watch` handle to every existing subdirectory.
 *    Non-recursive is required because bun's recursive fs.watch on Linux only
 *    fires events for the top-level directory — nested events are silently
 *    dropped. Node's recursive works fine but we need compatibility with both.
 * 2. Filters events to files we care about (.yml, .liquid).
 * 3. Debounces per file (200ms) so a burst of writes during scaffold does not
 *    cause an update storm.
 * 4. On change, reads the file and calls `lsp.syncDoc(uri, content)` so the
 *    LSP's open-document store picks up the new text.
 * 5. Also sends `workspace/didChangeWatchedFiles` notifications — LSPs that
 *    honor this spec method re-scan the affected files. pos-cli may or may not
 *    honor it; the notification is cheap to send either way.
 * 6. When a new directory appears under a watched target, it is walked and a
 *    new watcher is attached so the watcher set grows with the project.
 *
 * ----- What it does NOT do -----
 * - It does not attempt to rebuild the LSP's internal translation index by hand.
 *   That index is private to pos-cli. If the LSP does not react to didOpen/
 *   didChange for yml files, the `pending_translations` suppression mechanism
 *   (Phase 0.1+0.2) covers the gap for the duration of a plan.
 * - It does not crash on missing directories. Every error path logs and
 *   continues — a watcher that throws is worse than a watcher that no-ops.
 */

import { watch, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toUri } from './utils.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Debounce window in ms — a burst of writes during scaffold collapses to one update. */
const DEBOUNCE_MS = 200;

/**
 * Path prefixes (relative to app/) we re-sync on change.
 * Each prefix maps to the extensions we actually care about for that directory.
 *
 * Expanded from the original (translations + pages + schema) to also cover
 * every file type that can participate in the dependency graph. Change events
 * on these files invalidate the `project_map` cache via the `onFileChange`
 * callback, so cross-file analysis (analyze_project, validate_code's
 * AddedParam caller lookup) stays consistent with on-disk reality.
 */
const WATCH_TARGETS = [
  { prefix: 'translations',   extensions: ['.yml', '.yaml'] },
  { prefix: 'views/pages',    extensions: ['.liquid'] },
  { prefix: 'views/partials', extensions: ['.liquid'] },
  { prefix: 'views/layouts',  extensions: ['.liquid'] },
  { prefix: 'schema',         extensions: ['.yml', '.yaml'] },
  { prefix: 'lib',            extensions: ['.liquid'] },
  { prefix: 'graphql',        extensions: ['.graphql'] },
];

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Start the file system watcher.
 *
 * @param {object} opts
 * @param {string} opts.projectDir - Absolute project root.
 * @param {object} opts.lsp - PlatformOSLSPClient instance (must have syncDoc).
 * @param {(msg: string) => void} [opts.log] - Optional logger.
 * @param {(event: string, data?: object) => void} [opts.emit] - Optional event emitter for telemetry.
 * @param {(info: { absPath: string, relPath: string, event: 'change' | 'delete' }) => void} [opts.onFileChange]
 *        Optional callback fired after every successful resync/delete. Use it
 *        to invalidate caches (project_map, dependency graph) that depend on
 *        on-disk file contents.
 * @returns {{ close: () => void, stats: () => object }} handle
 */
export function startFsWatcher({ projectDir, lsp, log = () => {}, emit = () => {}, onFileChange = () => {} }) {
  const appDir = join(projectDir, 'app');

  // If app/ does not exist (fresh project fixture, malformed project) we cannot watch.
  // Return a no-op handle so callers do not have to branch.
  if (!existsSync(appDir)) {
    log(`fs-watcher: app/ not found at ${appDir}, watcher disabled`);
    return { close: () => {}, stats: () => ({ enabled: false, reason: 'app-missing' }) };
  }

  // Per-file debounce timers. Keyed by absolute path, not relative, so the
  // map has a single canonical identity per file.
  const debounceTimers = new Map();

  // Active watcher handles keyed by absolute directory path. Lets us:
  //   1. close everything on shutdown
  //   2. avoid double-watching the same directory
  //   3. dynamically attach watchers to new sub-dirs
  const watchers = new Map();

  // Simple accounting — surfaced via stats() for tests and dashboard.
  const counters = {
    enabled:   true,
    events:    0,
    synced:    0,
    ignored:   0,
    errors:    0,
    notifies:  0,
    watchedDirs: 0,
  };

  /**
   * Attach a non-recursive watcher to a single directory. Idempotent — calling
   * twice for the same path is a no-op. Newly-created sub-directories trigger
   * recursive attachment.
   */
  function attachWatcher(absDir) {
    if (watchers.has(absDir)) return;
    let handle;
    try {
      handle = watch(absDir, { recursive: false }, (eventType, filename) => {
        counters.events++;
        if (!filename) return;

        // filename is relative to absDir. It may be a file or a sub-directory.
        const entryPath = join(absDir, filename);

        // Directory events: when a new sub-directory appears, attach a watcher
        // to it. fs.watch reports directory creation as a 'rename' event.
        try {
          const st = statSync(entryPath);
          if (st.isDirectory()) {
            walkAndAttach(entryPath);
            return;
          }
        } catch {
          // entryPath no longer exists — it was deleted. Fall through to file
          // handling so we can send a Deleted notification to the LSP.
        }

        // File event — determine if it is a file we care about.
        const rel = relative(appDir, entryPath).replace(/\\/g, '/');
        const target = matchTarget(rel);
        if (!target) {
          counters.ignored++;
          return;
        }

        scheduleResync(entryPath, debounceTimers, lsp, log, emit, counters, { onFileChange, projectDir });
      });
    } catch (e) {
      counters.errors++;
      log(`fs-watcher: failed to watch ${absDir}: ${e.message}`);
      return;
    }

    // Avoid keeping the event loop alive for the watcher alone.
    if (typeof handle.unref === 'function') handle.unref();

    watchers.set(absDir, handle);
    counters.watchedDirs++;
  }

  /**
   * Recursively walk a directory and attach a watcher to every sub-directory
   * (including the root). Called at startup and on directory-create events.
   */
  function walkAndAttach(rootDir) {
    if (!existsSync(rootDir)) return;
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      attachWatcher(dir);
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        stack.push(join(dir, e.name));
      }
    }
  }

  // Walk and attach each watch target at startup. Missing targets are fine —
  // a fresh project may not yet have a schema/ dir, for example.
  for (const t of WATCH_TARGETS) {
    const absTarget = join(appDir, t.prefix);
    if (existsSync(absTarget)) {
      walkAndAttach(absTarget);
    }
  }

  emit('fs_watcher_started', { appDir, watchedDirs: counters.watchedDirs });
  log(`fs-watcher: watching ${counters.watchedDirs} director${counters.watchedDirs === 1 ? 'y' : 'ies'} under ${appDir}`);

  return {
    close() {
      for (const h of watchers.values()) {
        try { h.close(); } catch {}
      }
      watchers.clear();
      for (const t of debounceTimers.values()) clearTimeout(t);
      debounceTimers.clear();
      emit('fs_watcher_stopped');
    },
    stats() { return { ...counters }; },
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Check whether a relative path (under app/) matches one of our watch targets.
 * Returns the matching target descriptor, or null if the event should be ignored.
 */
function matchTarget(relPath) {
  for (const target of WATCH_TARGETS) {
    if (relPath !== target.prefix && !relPath.startsWith(`${target.prefix}/`)) continue;
    for (const ext of target.extensions) {
      if (relPath.endsWith(ext)) return target;
    }
  }
  return null;
}

/**
 * Schedule a debounced re-sync for a single file. A burst of events within the
 * debounce window collapses to a single action — only the last state is read.
 */
function scheduleResync(absPath, debounceTimers, lsp, log, emit, counters, hooks = {}) {
  const existing = debounceTimers.get(absPath);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    debounceTimers.delete(absPath);
    await resyncFile(absPath, lsp, log, emit, counters, hooks);
  }, DEBOUNCE_MS);

  // Don't let a pending re-sync hold the process open on shutdown.
  if (typeof timer.unref === 'function') timer.unref();

  debounceTimers.set(absPath, timer);
}

/**
 * Actually perform the re-sync: read the file, push it into the LSP, and send a
 * workspace/didChangeWatchedFiles notification for good measure. Every failure
 * path increments counters.errors and logs — this runs in the background and
 * must not throw.
 */
async function resyncFile(absPath, lsp, log, emit, counters, hooks = {}) {
  const { onFileChange, projectDir } = hooks;
  const relPath = projectDir ? relative(projectDir, absPath).replace(/\\/g, '/') : absPath;

  let content;
  try {
    content = await readFile(absPath, 'utf8');
  } catch {
    // File may have been deleted between the event firing and our read. That's
    // also a meaningful change — notify the LSP via didChangeWatchedFiles with
    // type: 3 (Deleted) so it can drop the file from its index.
    const uri = toUri(absPath);
    notifyDidChangeWatched(lsp, uri, 3 /* Deleted */, log, counters);
    emit('fs_watcher_delete', { path: absPath });
    try { onFileChange?.({ absPath, relPath, event: 'delete' }); }
    catch (e) { log(`fs-watcher: onFileChange(delete) failed: ${e.message}`); }
    return;
  }

  try {
    if (lsp?.syncDoc && lsp.initialized) {
      const uri = toUri(absPath);
      lsp.syncDoc(uri, content);
      counters.synced++;
      // Also send workspace/didChangeWatchedFiles — LSPs that honor this spec
      // method take it as a hint to re-scan. Harmless on LSPs that do not.
      notifyDidChangeWatched(lsp, uri, 2 /* Changed */, log, counters);
      emit('fs_watcher_sync', { path: absPath });
    }
  } catch (e) {
    counters.errors++;
    log(`fs-watcher: resync failed for ${absPath}: ${e.message}`);
  }

  // Fire onFileChange unconditionally on successful read — caches need to be
  // invalidated whether or not the LSP is ready. The callback must not throw;
  // guard it so a consumer bug cannot take the watcher down.
  try { onFileChange?.({ absPath, relPath, event: 'change' }); }
  catch (e) { log(`fs-watcher: onFileChange(change) failed: ${e.message}`); }
}

/**
 * Send a workspace/didChangeWatchedFiles notification via the LSP client's
 * public wrapper. No-ops silently when the client does not expose the method.
 */
function notifyDidChangeWatched(lsp, uri, type, log, counters) {
  if (typeof lsp?.notifyDidChangeWatched === 'function') {
    try {
      lsp.notifyDidChangeWatched(uri, type);
      counters.notifies++;
    } catch (e) {
      counters.errors++;
      log(`fs-watcher: didChangeWatchedFiles notify failed: ${e.message}`);
    }
  }
}
