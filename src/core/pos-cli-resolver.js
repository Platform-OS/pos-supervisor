/**
 * Cross-platform resolver for the @platformos/pos-cli npm package and the
 * Node.js executable used to run it.
 *
 * The previous resolver (inline in server.js) called `which pos-cli` then
 * `fs.realpath` — both fail on Windows. `which` (msys) returns POSIX-style
 * paths like `/c/Users/.../pos-cli` that Node's realpath interprets as
 * relative paths. `where.exe` returns the npm shim (`.cmd` / `.ps1`) which
 * is not directly executable as JS. This module replaces that chain with
 * three portable strategies, ordered by reliability.
 *
 *   1. `npm root -g` — ask npm for the global node_modules root and probe
 *      the standard `@platformos/pos-cli/bin/pos-cli.js` layout. Works on
 *      every OS because the npm CLI is itself portable.
 *   2. PATH walk — enumerate `process.env.PATH`, probe per-platform
 *      candidate filenames, resolve symlinks (Unix) or parse npm cmd-shim
 *      content (Windows) to extract the underlying JS entry.
 *   3. `createRequire` — fallback for monorepo / dev installs where
 *      pos-cli is reachable from this package's own node_modules.
 *
 * The resolver is non-throwing — every external interaction is wrapped so
 * a missing tool, broken PATH entry, or unreadable shim cannot crash
 * server startup. Callers receive `{ found: false }` and degrade to
 * static-mode tools.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve, basename } from 'node:path';

const isWindows = process.platform === 'win32';

const POS_CLI_PATH_CANDIDATES = isWindows
  ? ['pos-cli.cmd', 'pos-cli.ps1', 'pos-cli.bat', 'pos-cli']
  : ['pos-cli'];

const NODE_PATH_CANDIDATES = isWindows ? ['node.exe', 'node'] : ['node'];

// Sanity cap on shim file size. Real npm shims are < 4 KB; reject anything
// suspiciously large so we never read a corrupt binary as text.
const SHIM_MAX_BYTES = 64 * 1024;

/**
 * @typedef {Object} ResolvedPosCli
 * @property {boolean}        found
 * @property {string}        [jsPath]   Absolute path to pos-cli.js
 * @property {string}        [dataDir]  Absolute path to platformos-check-docs-updater/data, or null if missing
 * @property {'npm-root'|'path-walk'|'local-require'} [source]
 */

/**
 * Locate the pos-cli JavaScript entry point.
 *
 * @returns {Promise<ResolvedPosCli>}
 */
export async function resolvePosCli() {
  const npmRoot = await tryNpmRootGlobal();
  if (npmRoot) {
    const jsPath = join(npmRoot, '@platformos', 'pos-cli', 'bin', 'pos-cli.js');
    if (existsSync(jsPath)) return finalize(jsPath, 'npm-root');
  }

  for (const entry of splitPath(process.env.PATH)) {
    for (const cand of POS_CLI_PATH_CANDIDATES) {
      const full = join(entry, cand);
      if (!existsSync(full)) continue;
      const jsPath = resolveShimOrSymlink(full);
      if (jsPath && existsSync(jsPath)) return finalize(jsPath, 'path-walk');
    }
  }

  try {
    const req = createRequire(import.meta.url);
    const jsPath = req.resolve('@platformos/pos-cli/bin/pos-cli.js');
    if (existsSync(jsPath)) return finalize(jsPath, 'local-require');
  } catch {
    // Not installed locally — that's the common case.
  }

  return { found: false };
}

/**
 * Locate a Node.js executable suitable for spawning pos-cli.
 *
 * pos-supervisor itself may run under Bun (post-0.8.0 shebang switch), so
 * `process.execPath` cannot be assumed to be Node. When running under Bun
 * (or any non-Node host), PATH-walk for `node` / `node.exe`. Returns the
 * absolute path, or null if no Node interpreter is reachable.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveNode() {
  if (!process.versions.bun && process.execPath) {
    const base = basename(process.execPath, isWindows ? '.exe' : '');
    if (base === 'node') return process.execPath;
  }

  for (const entry of splitPath(process.env.PATH)) {
    for (const cand of NODE_PATH_CANDIDATES) {
      const full = join(entry, cand);
      if (!existsSync(full)) continue;
      try {
        return realpathSync(full);
      } catch {
        return full;
      }
    }
  }

  return null;
}

// ─── internals ─────────────────────────────────────────────────────────────

function splitPath(envPath) {
  if (!envPath) return [];
  return envPath
    .split(delimiter)
    .map(s => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function tryNpmRootGlobal() {
  return new Promise(resolve => {
    const cmd = isWindows ? 'npm.cmd' : 'npm';
    // On Windows, post-CVE-2024-27980 Node refuses to spawn `.bat`/`.cmd`
    // with `shell: false` — the call throws ERR_INVALID_ARG_TYPE rather
    // than returning a normal callback error. `shell: true` lets cmd.exe
    // resolve the wrapper as it normally would. Safe here because the
    // arguments are fixed string literals, not user input.
    const opts = { timeout: 5000, shell: isWindows };
    try {
      execFile(cmd, ['root', '-g'], opts, (err, stdout) => {
        if (err) return resolve(null);
        const path = (stdout || '').trim();
        resolve(path && existsSync(path) ? path : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Given an executable / shim / symlink, return the absolute path to the
 * underlying pos-cli.js, or null if the target cannot be determined.
 */
export function resolveShimOrSymlink(candidate) {
  try {
    const real = realpathSync(candidate);
    if (real.endsWith('.js')) return real;
  } catch {
    // not a symlink and/or unreadable — fall through to shim parsing
  }

  return parseShim(candidate);
}

/**
 * Parse an npm-generated shim (Windows .cmd / .ps1, Unix /bin/sh wrapper)
 * for the path it forwards to. Returns absolute path or null.
 *
 * The shim formats this handles:
 *   Windows .cmd  — `"%dp0%\node_modules\@platformos\pos-cli\bin\pos-cli.js"`
 *   PowerShell .ps1 — `"$basedir/node_modules/@platformos/pos-cli/bin/pos-cli.js"`
 *   Unix /bin/sh  — `"$basedir/node_modules/.../pos-cli.js"` or `"../lib/node_modules/.../pos-cli.js"`
 *
 * The strategy: strip the variable references (`%dp0%`, `$basedir`),
 * then walk every path-like token ending in `pos-cli.js`, resolve it
 * against the shim's directory, and return the first that exists.
 */
export function parseShim(shimPath) {
  let contents;
  try {
    const buf = readFileSync(shimPath);
    if (buf.length > SHIM_MAX_BYTES) return null;
    contents = buf.toString('utf8');
  } catch {
    return null;
  }

  const stripped = contents
    .replace(/%~?dp0%[\\/]?/gi, '')
    .replace(/\$basedir[\\/]?/g, '');

  const RE = /["'`]?((?:[A-Za-z]:)?(?:[^\s"'`<>|]+[\\/])*node_modules[\\/]@platformos[\\/]pos-cli[\\/]bin[\\/]pos-cli\.js)["'`]?/g;

  const tried = new Set();
  let m;
  while ((m = RE.exec(stripped)) !== null) {
    const raw = m[1];
    if (tried.has(raw)) continue;
    tried.add(raw);
    // Normalize backslashes to forward slashes before resolving. On Windows
    // `path.resolve` accepts both; on Linux (where a .cmd fixture may be
    // inspected during cross-platform testing, or where some shells write
    // backslash-bearing shims) the native separator is `/` so the raw
    // backslashed token would never resolve. Forward slashes are portable.
    const normalized = raw.replace(/\\/g, '/');
    const abs = resolve(dirname(shimPath), normalized);
    if (existsSync(abs)) return abs;
  }

  return null;
}

/**
 * Given an absolute path to pos-cli.js, derive the bundled docs-updater
 * data dir. Tries pos-cli's own node_modules first (npm classic, exact
 * version pin), then falls back to the parent node_modules (hoisted by
 * pnpm or npm dedupe).
 */
function finalize(jsPath, source) {
  const pkgRoot = dirname(dirname(jsPath));
  const dataCandidates = [
    join(pkgRoot, 'node_modules', '@platformos', 'platformos-check-docs-updater', 'data'),
    join(dirname(dirname(pkgRoot)), '@platformos', 'platformos-check-docs-updater', 'data'),
  ];
  const dataDir = dataCandidates.find(p => existsSync(p)) ?? null;
  return { found: true, jsPath, dataDir, source };
}
