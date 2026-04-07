import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

export const toUri = (p) => (p.startsWith('file://') ? p : `file://${p}`);

export const toAbs = (dir, p) => {
  const stripped = p.startsWith('./') ? p.slice(2) : p;
  return stripped.startsWith('/') ? stripped : `${dir}/${stripped}`;
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
