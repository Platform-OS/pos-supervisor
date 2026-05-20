import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Convert an absolute filesystem path to an RFC 8089 `file:` URI.
 *
 * The previous implementation was `\`file://${p}\`` — correct on Unix but
 * broken on Windows where it produced `file://C:\Users\…`. The LSP rejects
 * malformed URIs silently (no diagnostics returned) which was the root
 * cause of every Windows LSP-driven test failure.
 *
 * Pass-through for already-URI inputs preserves the previous contract.
 */
export const toUri = (p) => {
  if (typeof p === 'string' && p.startsWith('file://')) return p;
  return pathToFileURL(p).href;
};

/**
 * Inverse of toUri. Convert a `file:` URI back to an absolute filesystem
 * path appropriate for the current OS. Pass-through for non-URI inputs so
 * callers can use this defensively on values that may already be paths.
 */
export const fromUri = (uri) => {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
};

export const toAbs = (dir, p) => {
  const stripped = p.startsWith('./') ? p.slice(2) : p;
  return stripped.startsWith('/') ? stripped : `${dir}/${stripped}`;
};

/**
 * Normalize a filesystem path to POSIX-style forward slashes.
 *
 * Used wherever a path becomes part of a stable identifier — object keys,
 * Set/Map keys, JSON output, regex anchors. On Linux this is a no-op; on
 * Windows it converts `subdir\file.liquid` to `subdir/file.liquid` so that
 * (a) downstream code can use one separator everywhere and (b) keys round-
 * trip identically across hosts. NEVER use this for an actual fs operation;
 * always pass native paths to `fs.readFile`, `fs.existsSync`, etc.
 */
export const toPosixPath = (p) => {
  if (typeof p !== 'string') return p;
  return p.replace(/\\/g, '/');
};

export const isWatched = (p) => p.endsWith('.liquid') || p.endsWith('.graphql');

/**
 * Validate and sanitize a file path to prevent path traversal.
 * Returns the absolute path if valid, or throws if the path escapes the project.
 */
export function sanitizePath(directory, filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_path is required and must be a non-empty string');
  }
  const abs = resolve(directory, filePath);
  const rel = relative(directory, abs);
  if (rel.startsWith('..') || resolve(abs) !== abs) {
    throw new Error(`file_path must be within the project directory (resolved to ${abs})`);
  }
  return abs;
}


/**
 * Walk up from a file path to find the project root (contains app/config.yml).
 */
export function findProjectRoot(absPath) {
  let dir = dirname(absPath);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'app', 'config.yml'))) return dir;
    dir = dirname(dir);
  }
  return null;
}
