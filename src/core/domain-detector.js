import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 */
export function getDomainFromPath(absPath) {
  // More specific paths first — lib/queries/ and lib/commands/ can live under views/partials/
  if (absPath.includes('/lib/commands/'))   return 'commands';
  if (absPath.includes('/lib/queries/'))    return 'queries';
  if (absPath.includes('/views/pages/'))    return 'pages';
  if (absPath.includes('/views/layouts/'))  return 'layouts';
  if (absPath.includes('/views/partials/')) return 'partials';
  if (absPath.includes('/app/graphql/') || absPath.includes('/graphql/')) return 'graphql';
  if (absPath.includes('/schema/'))         return 'schema';
  if (absPath.includes('/translations/'))   return 'translations';
  if (/\/app\/config\.yml$/.test(absPath))  return 'config';
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

const VALID_DOMAINS = [
  // Core (Tier A)
  'pages', 'partials', 'graphql', 'translations', 'layouts', 'commands', 'schema', 'config', 'queries',
  // Platform features (Tier B)
  'forms', 'routing', 'authentication', 'sessions', 'assets', 'background-jobs', 'caching',
  'configuration', 'constants', 'deployment', 'migrations', 'testing', 'cli',
  'api-calls', 'emails-sms', 'events-consumers', 'flash-messages',
  // Liquid sub-topics
  'liquid/tags', 'liquid/objects', 'liquid/filters', 'liquid/variables',
  'liquid/types', 'liquid/flow-control', 'liquid/loops',
];
const VALID_SECTIONS = ['gotchas', 'patterns', 'api', 'configuration', 'advanced', 'overview'];

export function isValidDomain(domain) {
  return VALID_DOMAINS.includes(domain);
}

export function isValidSection(section) {
  return VALID_SECTIONS.includes(section);
}
