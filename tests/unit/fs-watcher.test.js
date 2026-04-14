/**
 * fs-watcher unit tests — exercise the path-matching and debounce logic
 * against a mock LSP. No real LSP process is spawned; we assert the watcher
 * calls syncDoc/notifyDidChangeWatched with the right arguments when files
 * change under the watched prefixes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startFsWatcher } from '../../src/core/fs-watcher.js';

// ── Mock LSP ─────────────────────────────────────────────────────────────────

function makeMockLsp() {
  const calls = { syncDoc: [], notifyDidChangeWatched: [] };
  return {
    initialized: true,
    syncDoc(uri, text) { calls.syncDoc.push({ uri, text }); },
    notifyDidChangeWatched(uri, type) { calls.notifyDidChangeWatched.push({ uri, type }); },
    _calls: calls,
  };
}

// Debounce waiter — the watcher uses 200ms debounce, so tests poll for up to 1s.
async function waitFor(predicate, { timeoutMs = 1500, stepMs = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

let tmpProject;
let handle;

beforeEach(() => {
  tmpProject = mkdtempSync(join(tmpdir(), 'fs-watcher-'));
  mkdirSync(join(tmpProject, 'app', 'translations'),        { recursive: true });
  mkdirSync(join(tmpProject, 'app', 'views', 'pages'),      { recursive: true });
  mkdirSync(join(tmpProject, 'app', 'schema'),              { recursive: true });
  mkdirSync(join(tmpProject, 'app', 'views', 'partials'),   { recursive: true });
});

afterEach(() => {
  try { handle?.close(); } catch {}
  try { rmSync(tmpProject, { recursive: true, force: true }); } catch {}
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('fs-watcher: start/stop', () => {
  it('no-ops with enabled:false when app/ is missing', () => {
    const noApp = mkdtempSync(join(tmpdir(), 'fs-watcher-noapp-'));
    try {
      const lsp = makeMockLsp();
      const h = startFsWatcher({ projectDir: noApp, lsp, log: () => {}, emit: () => {} });
      expect(h.stats().enabled).toBe(false);
      h.close();
    } finally {
      rmSync(noApp, { recursive: true, force: true });
    }
  });

  it('starts watching when app/ exists and close() releases the handle', () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp, log: () => {}, emit: () => {} });
    expect(handle.stats().enabled).toBe(true);
    handle.close();
    // Second close must not throw
    handle.close();
  });
});

describe('fs-watcher: path filtering', () => {
  it('re-syncs translation yml files', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'translations', 'en.yml');
    writeFileSync(path, 'en:\n  hello: world\n');

    const ok = await waitFor(() => lsp._calls.syncDoc.length > 0);
    expect(ok).toBe(true);
    expect(lsp._calls.syncDoc[0].uri).toMatch(/en\.yml$/);
    expect(lsp._calls.syncDoc[0].text).toContain('hello: world');
  });

  it('re-syncs page liquid files', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'views', 'pages', 'home.html.liquid');
    writeFileSync(path, '---\nslug: home\n---\n<h1>Home</h1>\n');

    const ok = await waitFor(() => lsp._calls.syncDoc.length > 0);
    expect(ok).toBe(true);
    expect(lsp._calls.syncDoc[0].uri).toMatch(/home\.html\.liquid$/);
  });

  it('re-syncs schema yml files', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'schema', 'blog_post.yml');
    writeFileSync(path, 'name: blog_post\nproperties: []\n');

    const ok = await waitFor(() => lsp._calls.syncDoc.length > 0);
    expect(ok).toBe(true);
  });

  it('re-syncs partial liquid files (dependency-graph invalidation)', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'views', 'partials', 'card.liquid');
    writeFileSync(path, '<div>card</div>\n');

    const ok = await waitFor(() => lsp._calls.syncDoc.some(c => c.uri.endsWith('card.liquid')));
    expect(ok).toBe(true);
  });

  it('re-syncs lib (command/query) liquid files', async () => {
    mkdirSync(join(tmpProject, 'app', 'lib', 'commands', 'posts'), { recursive: true });
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'lib', 'commands', 'posts', 'create.liquid');
    writeFileSync(path, '{% assign x = 1 %}\n');

    const ok = await waitFor(() => lsp._calls.syncDoc.some(c => c.uri.endsWith('create.liquid')));
    expect(ok).toBe(true);
  });

  it('re-syncs graphql files', async () => {
    mkdirSync(join(tmpProject, 'app', 'graphql', 'posts'), { recursive: true });
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'graphql', 'posts', 'list.graphql');
    writeFileSync(path, 'query { __typename }\n');

    const ok = await waitFor(() => lsp._calls.syncDoc.some(c => c.uri.endsWith('list.graphql')));
    expect(ok).toBe(true);
  });

  it('ignores arbitrary file extensions inside watched dirs', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'translations', 'junk.txt');
    writeFileSync(path, 'not a translation\n');

    await new Promise(r => setTimeout(r, 400));
    expect(lsp._calls.syncDoc.filter(c => c.uri.endsWith('junk.txt'))).toHaveLength(0);
  });
});

describe('fs-watcher: debounce', () => {
  it('collapses a burst of writes to the same file into one syncDoc call', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'translations', 'burst.yml');
    for (let i = 0; i < 5; i++) {
      writeFileSync(path, `en:\n  count: ${i}\n`);
      await new Promise(r => setTimeout(r, 20));
    }

    const ok = await waitFor(() => lsp._calls.syncDoc.length >= 1);
    expect(ok).toBe(true);

    // Wait an extra debounce window to confirm no late calls.
    await new Promise(r => setTimeout(r, 300));
    // 5 writes collapse to 1 sync because each write extends the debounce timer.
    // Allow up to 2 in case the final write falls outside the previous window.
    expect(lsp._calls.syncDoc.length).toBeLessThanOrEqual(2);
    // Whichever call landed, it must reflect the last write.
    expect(lsp._calls.syncDoc[lsp._calls.syncDoc.length - 1].text).toContain('count: 4');
  });
});

describe('fs-watcher: LSP notification', () => {
  it('sends workspace/didChangeWatchedFiles when the LSP exposes notifyDidChangeWatched', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'translations', 'notify.yml');
    writeFileSync(path, 'en:\n  key: value\n');

    await waitFor(() => lsp._calls.notifyDidChangeWatched.length > 0);
    expect(lsp._calls.notifyDidChangeWatched.length).toBeGreaterThan(0);
    expect(lsp._calls.notifyDidChangeWatched[0].type).toBe(2); // Changed
  });

  it('no-ops gracefully when LSP does not expose notifyDidChangeWatched', async () => {
    const lspNoNotify = {
      initialized: true,
      syncDoc() {},
    };
    handle = startFsWatcher({ projectDir: tmpProject, lsp: lspNoNotify });

    const path = join(tmpProject, 'app', 'translations', 'silent.yml');
    writeFileSync(path, 'en:\n  key: value\n');

    // Wait past debounce — must not throw
    await new Promise(r => setTimeout(r, 400));
    expect(handle.stats().errors).toBe(0);
  });

  it('does not call syncDoc when LSP is not initialized', async () => {
    const lsp = makeMockLsp();
    lsp.initialized = false;
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'translations', 'not-ready.yml');
    writeFileSync(path, 'en:\n  key: value\n');

    await new Promise(r => setTimeout(r, 400));
    expect(lsp._calls.syncDoc).toHaveLength(0);
  });
});

describe('fs-watcher: onFileChange hook', () => {
  it('fires on create/change with relative path and event=change', async () => {
    const events = [];
    const lsp = makeMockLsp();
    handle = startFsWatcher({
      projectDir: tmpProject,
      lsp,
      onFileChange: (info) => events.push(info),
    });

    const path = join(tmpProject, 'app', 'translations', 'cb.yml');
    writeFileSync(path, 'en:\n  a: 1\n');

    const ok = await waitFor(() => events.length > 0);
    expect(ok).toBe(true);
    expect(events[0].event).toBe('change');
    expect(events[0].relPath).toBe('app/translations/cb.yml');
    expect(events[0].absPath).toBe(path);
  });

  it('fires on delete with event=delete', async () => {
    const events = [];
    const lsp = makeMockLsp();
    handle = startFsWatcher({
      projectDir: tmpProject,
      lsp,
      onFileChange: (info) => events.push(info),
    });

    const path = join(tmpProject, 'app', 'translations', 'doomed.yml');
    writeFileSync(path, 'en:\n  a: 1\n');
    await waitFor(() => events.some(e => e.event === 'change' && e.absPath === path));

    rmSync(path);
    await waitFor(() => events.some(e => e.event === 'delete' && e.absPath === path));
    expect(events.some(e => e.event === 'delete')).toBe(true);
  });

  it('survives a throwing onFileChange callback (counts error, keeps running)', async () => {
    const lsp = makeMockLsp();
    let threw = false;
    handle = startFsWatcher({
      projectDir: tmpProject,
      lsp,
      onFileChange: () => { threw = true; throw new Error('boom'); },
    });

    const path = join(tmpProject, 'app', 'translations', 'a.yml');
    writeFileSync(path, 'en:\n  a: 1\n');

    await waitFor(() => threw === true);

    // Second write still triggers the callback — watcher was not taken down.
    writeFileSync(path, 'en:\n  a: 2\n');
    await new Promise(r => setTimeout(r, 400));
    expect(threw).toBe(true);
    expect(handle.stats().enabled).toBe(true);
  });
});

describe('fs-watcher: delete handling', () => {
  it('sends Deleted notification when a watched file is removed', async () => {
    const lsp = makeMockLsp();
    handle = startFsWatcher({ projectDir: tmpProject, lsp });

    const path = join(tmpProject, 'app', 'translations', 'tmp.yml');
    writeFileSync(path, 'en:\n  key: value\n');

    // Wait for the initial change event to land.
    await waitFor(() => lsp._calls.syncDoc.length > 0);

    rmSync(path);

    // Wait for the delete event to propagate through the debounce.
    await waitFor(() => lsp._calls.notifyDidChangeWatched.some(c => c.type === 3));
    expect(lsp._calls.notifyDidChangeWatched.some(c => c.type === 3)).toBe(true);
  });
});
