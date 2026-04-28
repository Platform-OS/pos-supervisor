/**
 * Synchronous module call-path enumeration for rule-engine use.
 *
 * Rules run in a sync context inside `runRules()`. The `module-scanner.js`
 * scanner is async and reads file contents; rules only need filenames, so
 * this helper does a fast sync filesystem walk and returns the same
 * `modules/<name>/<category>/<rest>` call_path shape that `module-scanner`
 * emits.
 *
 * The walk mirrors `scanPublicApi`:
 *   - Primary tree:  modules/<name>/public/lib/<category>/**\/*.liquid
 *   - Fallback tree: modules/<name>/public/views/partials/lib/<category>/**\/*.liquid
 *     (some legacy modules park lib code under views/partials/lib/)
 *
 * The classifier is identical to `module-scanner.classifyLibFile`. The
 * function never throws — missing dirs / unreadable files yield `[]`.
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KNOWN_CATEGORIES = Object.freeze([
  'commands', 'queries', 'helpers', 'validations', 'events', 'hooks', 'partials',
]);

/**
 * Return true if `modules/<moduleName>` exists under `projectDir`.
 */
export function moduleInstalled(projectDir, moduleName) {
  if (!projectDir || !moduleName) return false;
  return existsSync(join(projectDir, 'modules', moduleName));
}

/**
 * List installed module directory names. Returns [] if no modules dir.
 */
export function installedModules(projectDir) {
  if (!projectDir) return [];
  const modulesDir = join(projectDir, 'modules');
  if (!existsSync(modulesDir)) return [];
  try {
    return readdirSync(modulesDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Enumerate every callable path exported by `moduleName`, grouped by category.
 * Result shape: { commands: string[], queries: string[], helpers: string[], ... }
 * Each string is a `modules/<moduleName>/<category>/<rest>` call_path
 * (no leading slash, no .liquid extension).
 *
 * Empty categories are present in the returned object so callers can iterate
 * `KNOWN_CATEGORIES` without a hasOwnProperty dance.
 */
export function moduleCallPathsByCategory(projectDir, moduleName) {
  const empty = Object.fromEntries(KNOWN_CATEGORIES.map(c => [c, []]));
  if (!moduleInstalled(projectDir, moduleName)) return empty;

  const publicDir = join(projectDir, 'modules', moduleName, 'public');
  const libDir = join(publicDir, 'lib');
  const partialsLibDir = join(publicDir, 'views', 'partials', 'lib');

  const out = { ...empty };

  if (existsSync(libDir)) {
    walkLib(libDir, (rel, category) => {
      out[category].push(`modules/${moduleName}/${category}/${rel}`);
    });
  }

  if (existsSync(partialsLibDir)) {
    walkLib(partialsLibDir, (rel, category) => {
      const callPath = `modules/${moduleName}/${category}/${rel}`;
      if (!out[category].includes(callPath)) out[category].push(callPath);
    });
  }

  // Also pick up plain partials at modules/<name>/public/views/partials/<rest>
  // (without the lib/ subtree). These are legitimate render targets.
  const partialsDir = join(publicDir, 'views', 'partials');
  if (existsSync(partialsDir)) {
    walkLiquid(partialsDir, '', (rel) => {
      if (rel.startsWith('lib/')) return; // already classified above
      const callPath = `modules/${moduleName}/${rel}`;
      if (!out.partials.includes(callPath)) out.partials.push(callPath);
    });
  }

  for (const k of KNOWN_CATEGORIES) out[k].sort();
  return out;
}

/**
 * Convenience: flat list of every call_path exported by `moduleName`.
 */
export function moduleCallPaths(projectDir, moduleName) {
  const grouped = moduleCallPathsByCategory(projectDir, moduleName);
  return KNOWN_CATEGORIES.flatMap(c => grouped[c]);
}

/**
 * Classify the first path segment after `lib/` (or `views/partials/lib/`)
 * into a category. Mirrors `module-scanner.classifyLibFile`. Anything not
 * matching a known category is `partials` (the catch-all bucket).
 */
function classifyLibFirstSegment(first) {
  if (KNOWN_CATEGORIES.includes(first) && first !== 'partials') return first;
  return 'partials';
}

function walkLib(libRoot, emit) {
  // The library root is split by category at the first directory level.
  // E.g. modules/<m>/public/lib/commands/foo/bar.liquid → category=commands,
  //      rel='foo/bar' (callable as modules/<m>/commands/foo/bar).
  let entries;
  try { entries = readdirSync(libRoot, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const category = classifyLibFirstSegment(entry.name);
    walkLiquid(join(libRoot, entry.name), '', (rel) => {
      emit(rel, category);
    });
  }
}

/**
 * Recurse `dir` and call `emit(rel)` for every `.liquid` file, where `rel`
 * is the path relative to `dir` minus the `.liquid` extension.
 */
function walkLiquid(dir, prefix, emit) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkLiquid(join(dir, entry.name), next, emit);
    } else if (entry.isFile() && entry.name.endsWith('.liquid')) {
      emit(next.replace(/\.liquid$/, ''));
    }
  }
}

export const _internal = { KNOWN_CATEGORIES };
