/**
 * Content-addressed blob store under `.pos-supervisor/blobs/`.
 *
 * Why this exists (roadmap §A4):
 *   Phase A5's `validator_emit` event references "the content the validator
 *   actually saw" by `content_hash`. The hash is meaningless without a way
 *   to resolve it back to the bytes — that's this store. Analytics in
 *   Phase B reads (file_hash, fp) tuples and needs to recover the source
 *   to render "here's what was shown" panels in the dashboard.
 *
 *   It is intentionally NOT a general cache. Two callers writing the same
 *   bytes get the same blob path (sha256). Eviction is LRU-by-atime so a
 *   long session can't blow disk past the configured cap.
 *
 * Layout: `<root>/<aa>/<bb>/<rest_of_hash>` — two-level sharding so a single
 * directory never accumulates millions of entries (matters on ext4 / NTFS,
 * not so much on bcachefs / APFS, but cheap insurance).
 *
 * Concurrency: writes are atomic via `<path>.tmp.<rand>` → rename. Reads
 * never lock. The whole store assumes one supervisor process per project
 * (the lock model the rest of the supervisor uses).
 *
 * Failure model: every operation can throw — the caller decides whether
 * a blob miss is fatal. Callers in the tool path should catch and degrade
 * to "content not stored" rather than failing the validate_code response.
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, writeFileSync, utimesSync,
} from 'node:fs';
import { join } from 'node:path';

export const BLOB_HASH_ALGO = 'sha256';
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;   // 100 MiB
export const DEFAULT_MAX_FILES = 10_000;

/**
 * Compute the content hash for a string or Buffer. Exposed so callers can
 * derive a blob's address without writing it (e.g. fingerprint logging).
 */
export function blobHash(content) {
  const h = createHash(BLOB_HASH_ALGO);
  h.update(content);
  return h.digest('hex');
}

/**
 * Open a blob store rooted at `dir`. The directory is created on demand.
 *
 * @param {string} dir   Root path (e.g. `<projectDir>/.pos-supervisor/blobs`).
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=DEFAULT_MAX_BYTES] Hard cap on total stored bytes.
 * @param {number} [opts.maxFiles=DEFAULT_MAX_FILES] Hard cap on stored file count.
 * @returns {object} store API (see methods below)
 */
export function openBlobStore(dir, { maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_MAX_FILES } = {}) {
  if (!dir) throw new Error('openBlobStore: dir required');
  mkdirSync(dir, { recursive: true });

  function pathFor(hash) {
    if (typeof hash !== 'string' || hash.length < 4) {
      throw new Error('blob-store: hash must be a hex string of length >= 4');
    }
    return join(dir, hash.slice(0, 2), hash.slice(2, 4), hash.slice(4));
  }

  function exists(hash) {
    return existsSync(pathFor(hash));
  }

  /**
   * Persist `content` and return its sha256 hash. Idempotent: re-writing
   * the same content is a noop (and bumps atime so the LRU notices).
   */
  function put(content) {
    const hash = blobHash(content);
    const target = pathFor(hash);
    if (existsSync(target)) {
      // Touch atime so this blob looks "fresh" to the LRU sweeper.
      try { utimesSync(target, new Date(), statSync(target).mtime); } catch {}
      return hash;
    }
    mkdirSync(join(dir, hash.slice(0, 2), hash.slice(2, 4)), { recursive: true });
    // Atomic write: stage to a sibling temp file, then rename. fs rename
    // within the same dir is atomic on POSIX and Windows.
    const tmp = `${target}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, content);
    renameSync(tmp, target);
    enforceLimits();
    return hash;
  }

  /**
   * Read blob bytes. Returns Buffer or null if the hash isn't stored.
   * On hit, atime is bumped so the LRU keeps it fresh.
   */
  function get(hash) {
    const p = pathFor(hash);
    if (!existsSync(p)) return null;
    try {
      const data = readFileSync(p);
      try { utimesSync(p, new Date(), statSync(p).mtime); } catch {}
      return data;
    } catch {
      return null;
    }
  }

  /** Same as get(), but decoded as utf-8. Returns null on miss. */
  function getText(hash) {
    const buf = get(hash);
    return buf == null ? null : buf.toString('utf-8');
  }

  /**
   * Remove a single blob. Returns true if the file existed and was removed.
   * Empty shard directories are NOT cleaned up (they're tiny and become
   * cache-friendly when the next blob lands in the same shard).
   */
  function remove(hash) {
    const p = pathFor(hash);
    if (!existsSync(p)) return false;
    try { rmSync(p, { force: true }); return true; }
    catch { return false; }
  }

  /**
   * Walk the store and return every blob with its size + atime, ordered
   * oldest-atime-first. Used by enforceLimits and stats. O(n) in stored
   * blobs — fine for the cap sizes we target.
   */
  function listEntries() {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const a of safeReaddir(dir)) {
      const subA = join(dir, a);
      if (!safeIsDir(subA)) continue;
      for (const b of safeReaddir(subA)) {
        const subB = join(subA, b);
        if (!safeIsDir(subB)) continue;
        for (const name of safeReaddir(subB)) {
          // Skip in-flight temp writes from concurrent put()s.
          if (name.includes('.tmp.')) continue;
          const full = join(subB, name);
          let st;
          try { st = statSync(full); } catch { continue; }
          if (!st.isFile()) continue;
          out.push({ hash: a + b + name, path: full, size: st.size, atimeMs: st.atimeMs });
        }
      }
    }
    out.sort((x, y) => x.atimeMs - y.atimeMs);
    return out;
  }

  /** Rollup stats — { count, bytes, maxBytes, maxFiles } — for the dashboard. */
  function stats() {
    const entries = listEntries();
    let bytes = 0;
    for (const e of entries) bytes += e.size;
    return { count: entries.length, bytes, maxBytes, maxFiles };
  }

  /**
   * Drop oldest blobs until we're under both caps. Called automatically
   * after every put(); exposed for explicit sweeps (e.g. a shutdown hook).
   * Returns the number of evicted blobs.
   */
  function enforceLimits() {
    const entries = listEntries();
    let bytes = entries.reduce((acc, e) => acc + e.size, 0);
    let count = entries.length;
    let evicted = 0;
    let i = 0;
    while ((bytes > maxBytes || count > maxFiles) && i < entries.length) {
      const e = entries[i++];
      try { rmSync(e.path, { force: true }); }
      catch { continue; }
      bytes -= e.size;
      count -= 1;
      evicted += 1;
    }
    return evicted;
  }

  return {
    put, get, getText, exists, remove,
    enforceLimits, stats, listEntries,
    pathFor,
    get root() { return dir; },
    get maxBytes() { return maxBytes; },
    get maxFiles() { return maxFiles; },
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function safeReaddir(p) {
  try { return readdirSync(p); } catch { return []; }
}

function safeIsDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
