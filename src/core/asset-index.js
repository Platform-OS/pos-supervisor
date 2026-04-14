/**
 * Asset index — a snapshot of every file under `app/assets/`, keyed by both
 * full relative path and by basename.
 *
 * Purpose: the LSP's MissingAsset check has a chronic false-positive rate for
 * two reasons that both reduce to "the LSP's asset picture disagrees with the
 * real filesystem":
 *
 *   1. Persistence of absence. The LSP may report an asset missing right after
 *      the file is written — its internal asset cache doesn't pick up new
 *      files on disk until a re-index. Agents see "MissingAsset" for a path
 *      they can literally read() and stop trusting linter output.
 *   2. Path-prefix ambiguity. `asset_url` takes a path relative to `app/assets/`
 *      and the directory layout (`styles/`, `scripts/`, `images/`) must be
 *      part of that path. Agents often write `{{ 'logo.png' | asset_url }}`
 *      expecting a flat root when the file actually lives at
 *      `app/assets/images/logo.png`. The LSP reports MissingAsset but gives
 *      no hint about where the file actually is.
 *
 * This module lets the diagnostic pipeline (a) verify MissingAsset against the
 * real filesystem and suppress verified false positives, and (b) when a path
 * truly is wrong, look up the real nested path by basename and give the agent
 * a concrete "use this path instead" suggestion.
 *
 * The walker is deliberately scoped to `app/assets/` so we don't pay to scan
 * the whole project. On a large tree this is a few ms of sync I/O per
 * validate_code call; cheaper and more correct than trying to cache across
 * calls (files get added/removed during a session).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ASSETS_SUBDIR = 'app/assets';

/**
 * Walk `projectDir/app/assets` recursively.
 *
 * Returns:
 *   - paths: Set of every file's relative path from the assets root, with
 *     forward slashes (e.g. "styles/app.css", "images/icons/check.svg").
 *   - basenames: Map<basename, string[]> grouping every file by its basename
 *     so "logo.png" → ["images/logo.png", "vendor/logo.png"].
 *
 * Missing or unreadable directories yield an empty index — the caller must
 * treat an empty index as "no suppression possible, fall through to LSP".
 *
 * @param {string} projectDir
 * @returns {{ paths: Set<string>, basenames: Map<string, string[]> }}
 */
export function buildAssetIndex(projectDir) {
  const paths = new Set();
  const basenames = new Map();

  if (!projectDir) return { paths, basenames };
  const rootAbs = join(projectDir, ASSETS_SUBDIR);
  if (!existsSync(rootAbs)) return { paths, basenames };

  const stack = [rootAbs];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      // Symlinks and anything else skip — deploy syncs real files only.
      let stat;
      try { stat = entry.isFile() ? null : statSync(abs); }
      catch { continue; }
      if (stat && !stat.isFile()) continue;

      const rel = relative(rootAbs, abs).split(sep).join('/');
      paths.add(rel);

      const bn = entry.name;
      if (!basenames.has(bn)) basenames.set(bn, []);
      basenames.get(bn).push(rel);
    }
  }

  return { paths, basenames };
}

/**
 * Normalize whatever the LSP reported into a path relative to `app/assets/`.
 * The LSP quotes the literal string the template used, so agents commonly
 * submit absolute-looking forms too:
 *   - "styles/app.css"         — already correct
 *   - "/styles/app.css"        — leading slash
 *   - "assets/styles/app.css"  — prefixed with the directory
 *   - "/assets/styles/app.css" — both
 *   - "app/assets/styles/..."  — full repo-relative (rare, but seen)
 * We strip each of these so downstream can compare against the index set.
 */
export function normalizeAssetPath(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.trim();
  if (p.length === 0) return null;
  while (p.startsWith('/')) p = p.slice(1);
  if (p.startsWith('app/assets/')) p = p.slice('app/assets/'.length);
  else if (p.startsWith('assets/')) p = p.slice('assets/'.length);
  return p;
}

/**
 * Look up a reported asset path against the index. Returns one of:
 *   - { status: 'exists' }                              — file is real, suppress
 *   - { status: 'renamed', suggestion: <relPath> }      — file exists under a
 *        different nested path (typical prefix-ambiguity case). Suggests the
 *        nested path so the agent can fix the template.
 *   - { status: 'ambiguous', suggestions: [<relPath>] } — basename matches
 *        multiple files; don't suppress, but surface the candidates.
 *   - { status: 'missing' }                             — no match; diagnostic
 *        stands.
 */
export function resolveAssetPath(rawPath, index) {
  const p = normalizeAssetPath(rawPath);
  if (!p) return { status: 'missing' };
  if (index.paths.has(p)) return { status: 'exists' };

  const bn = p.split('/').pop();
  const matches = index.basenames.get(bn) ?? [];
  if (matches.length === 1) {
    return { status: 'renamed', suggestion: matches[0] };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', suggestions: matches.slice(0, 5) };
  }
  return { status: 'missing' };
}
