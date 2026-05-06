/**
 * blob-store unit tests — pin the content-addressed write/read contract,
 * idempotency, atomicity (no partial files visible mid-write), and LRU
 * eviction under both byte and file-count caps.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOB_HASH_ALGO,
  blobHash,
  openBlobStore,
} from '../../src/core/blob-store.js';

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-blobs-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('blob-store: hashing', () => {
  it('uses sha256', () => {
    expect(BLOB_HASH_ALGO).toBe('sha256');
  });

  it('blobHash matches a known sha256', () => {
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(blobHash('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('hashes Buffer and string the same when bytes match', () => {
    expect(blobHash(Buffer.from('hello', 'utf-8'))).toBe(blobHash('hello'));
  });
});

describe('blob-store: put / get / exists', () => {
  it('writes content under a sharded path and reads it back', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      const hash = store.put('the rain in spain');
      expect(hash).toBe(blobHash('the rain in spain'));
      expect(store.exists(hash)).toBe(true);

      const got = store.getText(hash);
      expect(got).toBe('the rain in spain');

      // Path layout: <root>/<aa>/<bb>/<rest>
      const expected = join(dir, hash.slice(0, 2), hash.slice(2, 4), hash.slice(4));
      expect(existsSync(expected)).toBe(true);
    } finally { cleanup(); }
  });

  it('put is idempotent for the same content', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      const a = store.put('same');
      const b = store.put('same');
      expect(a).toBe(b);
      expect(store.stats().count).toBe(1);
    } finally { cleanup(); }
  });

  it('different content produces different hashes', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      expect(store.put('a')).not.toBe(store.put('b'));
      expect(store.stats().count).toBe(2);
    } finally { cleanup(); }
  });

  it('get / getText return null on miss', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      // Use a real-shaped sha256 hex so pathFor doesn't reject on shape.
      const fakeHash = '0'.repeat(64);
      expect(store.get(fakeHash)).toBeNull();
      expect(store.getText(fakeHash)).toBeNull();
    } finally { cleanup(); }
  });

  it('rejects malformed hashes in pathFor', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      expect(() => store.exists('xx')).toThrow(/hash/i);
      expect(() => store.exists(null)).toThrow(/hash/i);
    } finally { cleanup(); }
  });

  it('does not leak .tmp files into listEntries', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      const hash = store.put('staged');
      // Drop a synthetic temp file in the same shard dir.
      const shard = join(dir, hash.slice(0, 2), hash.slice(2, 4));
      writeFileSync(join(shard, 'whatever.tmp.999.x'), 'partial');
      const hashes = store.listEntries().map((e) => e.hash);
      expect(hashes).toEqual([hash]);
    } finally { cleanup(); }
  });
});

describe('blob-store: remove', () => {
  it('returns true on hit, false on miss', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir);
      const hash = store.put('to-remove');
      expect(store.remove(hash)).toBe(true);
      expect(store.exists(hash)).toBe(false);
      expect(store.remove(hash)).toBe(false);
    } finally { cleanup(); }
  });
});

describe('blob-store: enforceLimits (LRU)', () => {
  it('evicts oldest by atime when maxFiles is exceeded', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir, { maxFiles: 2, maxBytes: 1024 });
      const hashA = store.put('a'); ageBlob(store.pathFor(hashA), 1000);
      const hashB = store.put('b'); ageBlob(store.pathFor(hashB), 500);
      const hashC = store.put('c'); // Should evict hashA (oldest atime).

      expect(store.exists(hashA)).toBe(false);
      expect(store.exists(hashB)).toBe(true);
      expect(store.exists(hashC)).toBe(true);
      expect(store.stats().count).toBe(2);
    } finally { cleanup(); }
  });

  it('evicts oldest by atime when maxBytes is exceeded', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir, { maxFiles: 100, maxBytes: 6 });
      const hashA = store.put('aaaa'); ageBlob(store.pathFor(hashA), 1000); // 4 bytes
      const hashB = store.put('bbbb'); // 4 bytes — total 8, over cap → evict A
      expect(store.exists(hashA)).toBe(false);
      expect(store.exists(hashB)).toBe(true);
    } finally { cleanup(); }
  });

  it('idempotent put bumps atime so repeated reads keep a blob warm', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir, { maxFiles: 2 });
      const hashA = store.put('a'); ageBlob(store.pathFor(hashA), 5000);
      const hashB = store.put('b'); ageBlob(store.pathFor(hashB), 4000);

      // Re-put A — it should be the freshest; the next eviction should
      // drop B instead of A.
      store.put('a');
      const hashC = store.put('c');

      expect(store.exists(hashA)).toBe(true);
      expect(store.exists(hashB)).toBe(false);
      expect(store.exists(hashC)).toBe(true);
    } finally { cleanup(); }
  });

  it('explicit enforceLimits() returns eviction count', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir, { maxFiles: 100, maxBytes: 1024 });
      const a = store.put('a'); ageBlob(store.pathFor(a), 3000);
      const b = store.put('b'); ageBlob(store.pathFor(b), 2000);
      const c = store.put('c'); ageBlob(store.pathFor(c), 1000);

      // Tighten the cap by reopening the store at a smaller limit.
      const tight = openBlobStore(dir, { maxFiles: 1 });
      const evicted = tight.enforceLimits();
      expect(evicted).toBe(2);
      expect(tight.stats().count).toBe(1);
      expect(tight.exists(c)).toBe(true);
    } finally { cleanup(); }
  });
});

describe('blob-store: stats', () => {
  it('reports count + bytes + caps', () => {
    const { dir, cleanup } = workDir();
    try {
      const store = openBlobStore(dir, { maxFiles: 50, maxBytes: 999 });
      store.put('xxxx');
      store.put('yyyyy');
      const s = store.stats();
      expect(s.count).toBe(2);
      expect(s.bytes).toBe(9);
      expect(s.maxFiles).toBe(50);
      expect(s.maxBytes).toBe(999);
    } finally { cleanup(); }
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function ageBlob(path, msAgo) {
  const t = new Date(Date.now() - msAgo);
  utimesSync(path, t, statSync(path).mtime);
}
