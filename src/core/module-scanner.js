/**
 * Module scanner — deep introspection of platformOS modules on disk.
 * Extracts metadata, public API surface, schemas, GraphQL, translations.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Scan a single module and return its full introspection.
 * @param {string} projectDir - project root
 * @param {string} moduleName - directory name under modules/
 * @returns {Promise<object>} module introspection
 */
export async function scanModule(projectDir, moduleName) {
  const moduleDir = join(projectDir, 'modules', moduleName);
  const publicDir = join(moduleDir, 'public');

  if (!existsSync(moduleDir)) {
    return { error: `Module '${moduleName}' not found at modules/${moduleName}/` };
  }

  // Parallel scan of all data sources
  const [metadata, apiSurface, schemas, graphql, translations, pages] = await Promise.all([
    scanMetadata(moduleDir),
    scanPublicApi(publicDir, moduleName),
    scanSchemas(publicDir),
    scanGraphQL(publicDir),
    scanTranslations(publicDir),
    scanPages(publicDir),
  ]);

  return {
    name: moduleName,
    display_name: metadata.name || moduleName,
    version: metadata.version || 'unknown',
    dependencies: metadata.dependencies || {},
    installed: true,
    ...apiSurface,
    schemas,
    graphql,
    translations,
    pages,
  };
}

/**
 * List all installed modules with basic metadata.
 * @param {string} projectDir
 * @returns {Promise<object[]>}
 */
export async function listModules(projectDir) {
  const modulesDir = join(projectDir, 'modules');
  if (!existsSync(modulesDir)) return [];

  try {
    const entries = await readdir(modulesDir, { withFileTypes: true });
    const modules = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await scanMetadata(join(modulesDir, entry.name));
      modules.push({
        name: entry.name,
        display_name: meta.name || entry.name,
        version: meta.version || 'unknown',
        dependencies: meta.dependencies || {},
      });
    }

    return modules;
  } catch {
    return [];
  }
}

// ── Metadata scanning ────────────────────────────────────────────────────────

async function scanMetadata(moduleDir) {
  // Try template-values.json first (platformOS module metadata)
  const tvPath = join(moduleDir, 'template-values.json');
  try {
    const content = await readFile(tvPath, 'utf8');
    return JSON.parse(content);
  } catch {}

  // Fallback to package.json
  const pkgPath = join(moduleDir, 'package.json');
  try {
    const content = await readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(content);
    return {
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.dependencies || {},
    };
  } catch {}

  return {};
}

// ── Public API surface ───────────────────────────────────────────────────────

async function scanPublicApi(publicDir, moduleName) {
  const libDir = join(publicDir, 'lib');
  const result = {
    commands: [],
    queries: [],
    helpers: [],
    validations: [],
    events: [],
    hooks: [],
    partials: [],
  };

  if (!existsSync(libDir)) {
    // Fallback: scan partials from views/partials
    const partialsDir = join(publicDir, 'views', 'partials');
    if (existsSync(partialsDir)) {
      const files = await walkDir(partialsDir);
      for (const f of files) {
        if (!f.endsWith('.liquid')) continue;
        const rel = relative(join(publicDir, 'views', 'partials'), f);
        const name = rel.replace(/\.liquid$/, '');
        result.partials.push({ name, call_path: `modules/${moduleName}/${name}` });
      }
    }
    return result;
  }

  const files = await walkDir(libDir);

  for (const absPath of files) {
    if (!absPath.endsWith('.liquid')) continue;

    const rel = relative(libDir, absPath);
    const name = rel.replace(/\.liquid$/, '');

    // Classify by directory
    const category = classifyLibFile(rel);
    const info = { name, call_path: `modules/${moduleName}/${name}` };

    // Parse doc block for parameters
    try {
      const content = await readFile(absPath, 'utf8');
      const params = parseDocBlock(content);
      const commentParams = parseCommentParams(content);
      if (params.length > 0) {
        info.params = params;
      } else if (commentParams.length > 0) {
        info.params = commentParams;
      }

      // For commands, detect the pattern (single-file vs multi-file)
      if (category === 'commands') {
        info.pattern = detectCommandPattern(content);
      }

      // Extract brief description from first comment or doc block
      const desc = extractDescription(content);
      if (desc) info.description = desc;
    } catch {}

    switch (category) {
      case 'commands': result.commands.push(info); break;
      case 'queries': result.queries.push(info); break;
      case 'helpers': result.helpers.push(info); break;
      case 'validations': result.validations.push(info); break;
      case 'events': result.events.push(info); break;
      case 'hooks': result.hooks.push(info); break;
      default: result.partials.push(info); break;
    }
  }

  // Sort each category
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

function classifyLibFile(relPath) {
  const parts = relPath.split('/');
  const first = parts[0];

  if (first === 'commands') return 'commands';
  if (first === 'queries') return 'queries';
  if (first === 'helpers') return 'helpers';
  if (first === 'validations') return 'validations';
  if (first === 'events') return 'events';
  if (first === 'hooks') return 'hooks';
  return 'partials';
}

// ── Schema scanning ──────────────────────────────────────────────────────────

async function scanSchemas(publicDir) {
  const schemaDir = join(publicDir, 'schema');
  if (!existsSync(schemaDir)) return [];

  const schemas = [];
  try {
    const files = await walkDir(schemaDir);
    for (const f of files) {
      if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
      try {
        const content = await readFile(f, 'utf8');
        const parsed = yaml.load(content);
        if (parsed?.name) {
          schemas.push({
            name: parsed.name,
            properties: (parsed.properties || []).map(p => ({
              name: p.name,
              type: p.type || 'string',
            })),
          });
        }
      } catch {}
    }
  } catch {}

  return schemas.sort((a, b) => a.name.localeCompare(b.name));
}

// ── GraphQL scanning ─────────────────────────────────────────────────────────

async function scanGraphQL(publicDir) {
  const gqlDir = join(publicDir, 'graphql');
  if (!existsSync(gqlDir)) return [];

  const operations = [];
  try {
    const files = await walkDir(gqlDir);
    for (const f of files) {
      if (!f.endsWith('.graphql')) continue;

      const rel = relative(gqlDir, f);
      const name = rel.replace(/\.graphql$/, '');

      try {
        const content = await readFile(f, 'utf8');
        const parsed = parseGraphQLOp(content);
        operations.push({
          name,
          ...parsed,
        });
      } catch {
        operations.push({ name, type: 'unknown', args: [] });
      }
    }
  } catch {}

  return operations.sort((a, b) => a.name.localeCompare(b.name));
}

function parseGraphQLOp(content) {
  const trimmed = content.trim();
  // Match operation type and arguments
  const opMatch = trimmed.match(/^(query|mutation|subscription)\s*(?:\w+)?\s*\(([^)]*)\)/);
  if (!opMatch) {
    // Try without parens (no-arg query/mutation)
    const simpleMatch = trimmed.match(/^(query|mutation|subscription)\b/);
    return { type: simpleMatch?.[1] || 'unknown', args: [] };
  }

  const type = opMatch[1];
  const argsStr = opMatch[2];
  const args = [];

  // Parse $name: Type pairs — type is always a single token like String!, [ID!]!, Int
  const argRegex = /\$(\w+)\s*:\s*(\[?\w+!?\]?!?)/g;
  let m;
  while ((m = argRegex.exec(argsStr)) !== null) {
    args.push({ name: m[1], type: m[2] });
  }

  return { type, args };
}

// ── Translation scanning ─────────────────────────────────────────────────────

async function scanTranslations(publicDir) {
  const transDir = join(publicDir, 'translations');
  if (!existsSync(transDir)) return {};

  const translations = {};
  try {
    const files = await walkDir(transDir);
    for (const f of files) {
      if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
      const rel = relative(transDir, f);
      const locale = rel.replace(/\.(yml|yaml)$/, '').replace(/\//g, '.');

      try {
        const content = await readFile(f, 'utf8');
        const parsed = yaml.load(content);
        const keyCount = countKeys(parsed);
        translations[locale] = { key_count: keyCount };
      } catch {}
    }
  } catch {}

  return translations;
}

function countKeys(obj, count = 0) {
  if (!obj || typeof obj !== 'object') return count + 1;
  for (const val of Object.values(obj)) {
    count = countKeys(val, count);
  }
  return count;
}

// ── Page scanning ────────────────────────────────────────────────────────────

async function scanPages(publicDir) {
  const pagesDir = join(publicDir, 'views', 'pages');
  if (!existsSync(pagesDir)) return [];

  const pages = [];
  try {
    const files = await walkDir(pagesDir);
    for (const f of files) {
      if (!f.endsWith('.liquid')) continue;

      const rel = relative(pagesDir, f);
      const info = { file: rel };

      try {
        const content = await readFile(f, 'utf8');
        const slugMatch = content.match(/^slug:\s*(.+)$/m);
        const methodMatch = content.match(/^method:\s*(.+)$/m);
        if (slugMatch) info.slug = slugMatch[1].trim();
        if (methodMatch) info.method = methodMatch[1].trim();
      } catch {}

      pages.push(info);
    }
  } catch {}

  return pages.sort((a, b) => (a.slug || a.file).localeCompare(b.slug || b.file));
}

// ── Liquid parsing helpers ───────────────────────────────────────────────────

/**
 * Parse {% doc %} block parameters.
 */
function parseDocBlock(content) {
  const docMatch = content.match(/\{%\s*doc\s*%\}([\s\S]*?)\{%\s*enddoc\s*%\}/);
  if (!docMatch) return [];

  const params = [];
  const paramRegex = /@param\s+(\w+)\s+\{([^}]+)\}\s*-?\s*(.*)/g;
  let m;
  while ((m = paramRegex.exec(docMatch[1])) !== null) {
    params.push({ name: m[1], type: m[2].trim(), description: m[3].trim() });
  }
  return params;
}

/**
 * Parse {% comment %} block parameters (older module style).
 */
function parseCommentParams(content) {
  // Match first comment block
  const commentMatch = content.match(/\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/);
  if (!commentMatch) return [];

  const params = [];
  const lines = commentMatch[1].split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match "param_name: type" or "- param_name: type" or "@param_name"
    const paramMatch = trimmed.match(/^[-@]?\s*(\w+)\s*[:]\s*(\w+)?/);
    if (paramMatch && paramMatch[1] !== 'params' && paramMatch[1] !== 'Params') {
      params.push({
        name: paramMatch[1],
        type: paramMatch[2] || 'string',
        description: '',
      });
    }
  }
  return params;
}

/**
 * Detect command pattern from file content.
 */
function detectCommandPattern(content) {
  const hasBuild = /function\s+\w+\s*=\s*['"][^'"]*\/build/.test(content);
  const hasCheck = /function\s+\w+\s*=\s*['"][^'"]*\/check/.test(content);
  const hasExecute = /function\s+\w+\s*=\s*['"][^'"]*commands\/execute/.test(content) ||
    /graphql\s+\w+\s*=/.test(content);

  if (hasBuild && hasCheck) return 'multi-file (build/check/execute)';
  if (hasExecute) return 'single-file (build→check→execute)';
  return 'custom';
}

/**
 * Extract first meaningful description from a file.
 */
function extractDescription(content) {
  // From {% doc %} block first line
  const docMatch = content.match(/\{%\s*doc\s*%\}\s*\n\s*([^@\n{][^\n]*)/);
  if (docMatch) return docMatch[1].trim();

  // From {% comment %} first line
  const commentMatch = content.match(/\{%\s*comment\s*%\}\s*\n\s*([^\n]*)/);
  if (commentMatch) {
    const line = commentMatch[1].trim();
    // Skip if it looks like params
    if (line && !line.startsWith('-') && !line.startsWith('@') && !line.includes(':')) {
      return line;
    }
  }

  return null;
}

// ── File system helpers ──────────────────────────────────────────────────────

async function walkDir(dir) {
  const results = [];
  await walkRecursive(dir, results);
  return results;
}

async function walkRecursive(dir, results) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkRecursive(fullPath, results);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
}
