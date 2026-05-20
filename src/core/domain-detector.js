import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosixPath } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default locations — used when no explicit dataDir is configured
const DEFAULT_DATA_LOCATIONS = [
  join(__dirname, '..', 'data'),        // src/data/
  join(__dirname, '..', '..', 'data'),   // pos-supervisor/data/
];

let _dataDir = null;

/**
 * Set the data directory explicitly. Call this at startup when
 * the data directory is resolved from pos-cli's installation path.
 */
export function setDataDir(dir) {
  _dataDir = dir;
}

function resolveDataDir() {
  if (_dataDir) return _dataDir;
  return DEFAULT_DATA_LOCATIONS.find(d => existsSync(d)) ?? null;
}

/**
 * Map a file path to a domain key, or null if no domain applies.
 *
 * Substring matches use POSIX-style separators internally so Windows paths
 * (`C:\…\app\views\pages\home.html.liquid`) resolve the same as Unix paths.
 * Without the normalization the matches silently return null on Windows,
 * scanLiquidFiles drops every file, and every project_map / scaffold /
 * intent-validator / fact-graph test downstream sees an empty index.
 */
export function getDomainFromPath(absPath) {
  const p = toPosixPath(absPath);
  // More specific paths first — lib/queries/ and lib/commands/ can live under views/partials/
  if (p.includes('/lib/commands/'))   return 'commands';
  if (p.includes('/lib/queries/'))    return 'queries';
  if (p.includes('/views/pages/'))    return 'pages';
  if (p.includes('/views/layouts/'))  return 'layouts';
  if (p.includes('/views/partials/')) return 'partials';
  if (p.includes('/app/graphql/') || p.includes('/graphql/')) return 'graphql';
  if (p.includes('/schema/'))         return 'schema';
  if (p.includes('/translations/'))   return 'translations';
  if (/\/app\/config\.yml$/.test(p))  return 'config';
  return null;
}

/**
 * Load domain header text from data/domains/{domain}.md.
 */
export async function getDomainHeader(domain) {
  const dataDir = resolveDataDir();
  if (!dataDir) return null;
  try {
    return await readFile(join(dataDir, 'domains', `${domain}.md`), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Load a reference section from data/references/{domain}/{section}.md.
 */
export async function getReference(domain, section) {
  const dataDir = resolveDataDir();
  if (!dataDir) return null;
  const fileName = section === 'overview' ? 'README.md' : `${section}.md`;
  try {
    return await readFile(join(dataDir, 'references', domain, fileName), 'utf8');
  } catch {
    return null;
  }
}

export const VALID_DOMAINS = [
  // Core (Tier A)
  'pages', 'partials', 'graphql', 'translations', 'layouts', 'commands', 'schema', 'config', 'queries',
  // Platform features (Tier B)
  'forms', 'routing', 'authentication', 'sessions', 'assets', 'background-jobs', 'caching',
  'configuration', 'constants', 'deployment', 'migrations', 'testing', 'cli',
  'api-calls', 'emails-sms', 'events-consumers', 'flash-messages',
  // Liquid sub-topics
  'liquid/tags', 'liquid/objects', 'liquid/filters', 'liquid/variables',
  'liquid/types', 'liquid/flow-control', 'liquid/loops',
  // Project-specific
  'design-system',
];
const VALID_SECTIONS = ['gotchas', 'patterns', 'api', 'configuration', 'advanced', 'overview'];

export function isValidDomain(domain) {
  return VALID_DOMAINS.includes(domain);
}

export function isValidSection(section) {
  return VALID_SECTIONS.includes(section);
}
