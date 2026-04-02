/**
 * Project scanner — builds structured JSON index of a platformOS project.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import yaml from 'js-yaml';
import { parseLiquidFile, extractAllFromAST } from './liquid-parser.js';
import { getDomainFromPath } from './domain-detector.js';
import { sanitizePath } from './utils.js';

/**
 * Scan the entire project and return structured JSON map.
 */
export async function scanProject(projectDir) {
  const appDir = join(projectDir, 'app');

  const [schema, graphql, liquidFiles, translations, modules, environments, hasConfig, assets] =
    await Promise.all([
      scanSchema(appDir),
      scanGraphQL(appDir),
      scanLiquidFiles(appDir),
      scanTranslations(appDir),
      scanModules(projectDir),
      scanEnvironments(projectDir),
      scanConfig(appDir),
      scanAssets(appDir),
    ]);

  const pages = {};
  const partials = {};
  const commands = {};
  const queries = {};
  const layouts = {};

  for (const file of liquidFiles) {
    switch (file.domain) {
      case 'pages': {
        const key = file.structural.slug || file.relPath;
        pages[key] = {
          path: file.relPath,
          method: file.structural.method || 'get',
          layout: file.structural.layout,
          renders: file.structural.renders,
          function_calls: file.functionCalls,
        };
        break;
      }
      case 'partials': {
        const name = partialNameFromPath(file.relPath);
        partials[name] = {
          path: file.relPath,
          params: [...file.structural.docParams],
          renders: file.structural.renders,
          function_calls: file.functionCalls,
          rendered_by: [],
        };
        break;
      }
      case 'commands': {
        commands[file.relPath] = {
          params: [...file.structural.docParams],
          phases: detectPhases(projectDir, file.relPath),
          graphql_calls: file.structural.graphql,
        };
        break;
      }
      case 'queries': {
        queries[file.relPath] = {
          params: [...file.structural.docParams],
          graphql_calls: file.structural.graphql,
        };
        break;
      }
      case 'layouts': {
        layouts[file.relPath] = { path: file.relPath };
        break;
      }
    }
  }

  buildReverseIndex(partials, liquidFiles);

  const resources = detectResources(schema, graphql, commands, queries, pages);

  return {
    project: {
      directory: projectDir,
      environments,
      modules,
      has_config: hasConfig,
    },
    schema,
    graphql,
    commands,
    queries,
    pages,
    partials,
    translations,
    assets,
    summary: {
      file_counts: {
        schema: Object.keys(schema).length,
        graphql: Object.keys(graphql).length,
        commands: Object.keys(commands).length,
        queries: Object.keys(queries).length,
        pages: Object.keys(pages).length,
        partials: Object.keys(partials).length,
        layouts: Object.keys(layouts).length,
        assets: assets.length,
      },
      resources,
    },
  };
}

/**
 * Scan files connected to a specific path (focused scan).
 */
export async function scanAround(projectDir, absPath) {
  sanitizePath(projectDir, relative(projectDir, absPath));

  const content = await readFile(absPath, 'utf8').catch(() => null);
  if (!content) return null;

  const relPath = relative(projectDir, absPath);
  const isLiquid = absPath.endsWith('.liquid');

  const connectedPaths = new Set([relPath]);

  if (isLiquid) {
    const ast = parseLiquidFile(content);
    if (ast) {
      const extracted = extractAllFromAST(ast);
      for (const r of extracted.renders) {
        connectedPaths.add(`app/views/partials/${r}.liquid`);
      }
      for (const g of extracted.graphql) {
        connectedPaths.add(`app/graphql/${g.queryName}.graphql`);
      }
      for (const fc of extractFunctionCalls(content)) {
        connectedPaths.add(`app/${fc.path}.liquid`);
      }
    }
  }

  const result = { files: {} };
  for (const cp of connectedPaths) {
    const cpAbs = join(projectDir, cp);
    const cpContent = await readFile(cpAbs, 'utf8').catch(() => null);
    if (!cpContent) continue;

    const cpDomain = getDomainFromPath(cpAbs);
    if (cp.endsWith('.liquid')) {
      const ast = parseLiquidFile(cpContent);
      if (ast) {
        const extracted = extractAllFromAST(ast);
        result.files[cp] = {
          domain: cpDomain,
          renders: extracted.renders,
          graphql: extracted.graphql,
          function_calls: extractFunctionCalls(cpContent),
          params: [...extracted.docParams],
        };
      }
    } else if (cp.endsWith('.graphql')) {
      result.files[cp] = {
        domain: 'graphql',
        ...parseGraphQLFile(cpContent),
      };
    }
  }

  return result;
}

// ── Internal scanning functions ──────────────────────────────────────────────

async function scanSchema(appDir) {
  const schemaDir = join(appDir, 'schema');
  if (!existsSync(schemaDir)) return {};

  const files = await readdir(schemaDir).catch(() => []);
  const schema = {};

  await Promise.all(files.map(async (file) => {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return;
    try {
      const content = await readFile(join(schemaDir, file), 'utf8');
      const parsed = yaml.load(content);
      if (parsed?.name) {
        schema[parsed.name] = {
          path: `app/schema/${file}`,
          properties: (parsed.properties || []).map(p => ({
            name: p.name,
            type: p.type,
          })),
        };
      }
    } catch { /* skip unparseable files */ }
  }));

  return schema;
}

async function scanGraphQL(appDir) {
  const gqlDir = join(appDir, 'graphql');
  if (!existsSync(gqlDir)) return {};

  const files = await globFiles(gqlDir, '.graphql');
  const graphql = {};

  await Promise.all(files.map(async (relFile) => {
    try {
      const content = await readFile(join(gqlDir, relFile), 'utf8');
      const queryPath = relFile.replace(/\.graphql$/, '');
      graphql[queryPath] = parseGraphQLFile(content);
    } catch { /* skip unparseable files */ }
  }));

  return graphql;
}

export function parseGraphQLFile(content) {
  const result = { operation: null, name: null, args: [], table: null };

  const opMatch = content.match(/^\s*(query|mutation)\s+(\w+)\s*(?:\(([^)]*)\))?/m);
  if (opMatch) {
    result.operation = opMatch[1];
    result.name = opMatch[2];
    if (opMatch[3]) {
      for (const am of opMatch[3].matchAll(/\$(\w+):\s*([^,=)]+)/g)) {
        result.args.push({ name: am[1], type: am[2].trim() });
      }
    }
  }

  const tableMatch = content.match(/table:\s*(?:\{\s*value:\s*"(\w+)"|"(\w+)")/);
  if (tableMatch) {
    result.table = tableMatch[1] || tableMatch[2];
  }

  return result;
}

async function scanLiquidFiles(appDir) {
  const liquidFiles = [];
  const files = await globLiquidFiles(appDir);

  await Promise.all(files.map(async (relFile) => {
    const absPath = join(appDir, relFile);
    const relPath = `app/${relFile}`;
    const domain = getDomainFromPath(absPath);
    if (!domain) return;

    try {
      const content = await readFile(absPath, 'utf8');
      const ast = parseLiquidFile(content);
      if (!ast) return;

      const extracted = extractAllFromAST(ast);
      liquidFiles.push({
        relPath,
        absPath,
        domain,
        structural: {
          slug: extracted.slug,
          layout: extracted.layout,
          method: extracted.method,
          renders: extracted.renders,
          graphql: extracted.graphql,
          filters: extracted.filters,
          tags: extracted.tags,
          transKeys: extracted.transKeys,
          docParams: extracted.docParams,
        },
        functionCalls: extractFunctionCalls(content),
      });
    } catch { /* skip unparseable files */ }
  }));

  return liquidFiles;
}

async function scanTranslations(appDir) {
  const transDir = join(appDir, 'translations');
  if (!existsSync(transDir)) return {};

  const files = await readdir(transDir).catch(() => []);
  const translations = {};

  await Promise.all(files.map(async (file) => {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return;
    const locale = basename(file, extname(file));
    try {
      const content = await readFile(join(transDir, file), 'utf8');
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object') {
        translations[locale] = flattenYaml(parsed);
      }
    } catch { /* skip */ }
  }));

  return translations;
}

async function scanModules(projectDir) {
  const modulesDir = join(projectDir, 'modules');
  if (!existsSync(modulesDir)) return [];

  try {
    const entries = await readdir(modulesDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

async function scanEnvironments(projectDir) {
  const posFile = join(projectDir, '.pos');
  if (!existsSync(posFile)) return [];

  try {
    const content = await readFile(posFile, 'utf8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.keys(parsed);
  } catch {
    return [];
  }
}

async function scanConfig(appDir) {
  return existsSync(join(appDir, 'config.yml'));
}

async function scanAssets(appDir) {
  const assetsDir = join(appDir, 'assets');
  if (!existsSync(assetsDir)) return [];
  try {
    const entries = await readdir(assetsDir, { withFileTypes: true, recursive: true });
    return entries
      .filter(e => e.isFile())
      .map(e => relative(assetsDir, join(e.parentPath ?? e.path, e.name)))
      .sort();
  } catch {
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function extractFunctionCalls(content) {
  const calls = [];
  const seen = new Set();
  const re = /function\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      calls.push({ variable: m[1], path: m[2] });
    }
  }
  return calls;
}

function partialNameFromPath(relPath) {
  return relPath
    .replace(/^app\/views\/partials\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
}

function detectPhases(projectDir, relPath) {
  const basePath = join(projectDir, relPath.replace(/\.liquid$/, ''));
  const phases = ['main'];
  if (existsSync(join(basePath, 'build.liquid'))) phases.push('build');
  if (existsSync(join(basePath, 'check.liquid'))) phases.push('check');
  return phases;
}

function buildReverseIndex(partials, liquidFiles) {
  for (const file of liquidFiles) {
    for (const renderName of file.structural.renders) {
      if (partials[renderName]) {
        partials[renderName].rendered_by.push(file.relPath);
      }
    }
    for (const fc of file.functionCalls) {
      const partialName = fc.path.replace(/^views\/partials\//, '');
      if (partials[partialName]) {
        partials[partialName].rendered_by.push(file.relPath);
      }
    }
  }
}

function detectResources(schema, graphql, commands, queries, pages) {
  const resources = {};

  for (const [tableName, tableInfo] of Object.entries(schema)) {
    const plural = pluralize(tableName);
    const r = {
      schema: tableInfo.path,
      graphql: [],
      commands: [],
      queries: [],
      pages: [],
      missing: [],
    };

    for (const [gqlPath, gqlInfo] of Object.entries(graphql)) {
      if (gqlPath.startsWith(`${plural}/`) || gqlInfo.table === tableName) {
        r.graphql.push(gqlPath);
      }
    }

    for (const cmdPath of Object.keys(commands)) {
      if (cmdPath.includes(`/commands/${plural}/`)) {
        r.commands.push(cmdPath);
      }
    }

    for (const qPath of Object.keys(queries)) {
      if (qPath.includes(`/queries/${plural}/`)) {
        r.queries.push(qPath);
      }
    }

    for (const [slug] of Object.entries(pages)) {
      if (slug === plural || slug.startsWith(`${plural}/`)) {
        r.pages.push(pages[slug].path);
      }
    }

    const ops = new Set(r.graphql.map(g => basename(g)));
    if (!ops.has('search') && !ops.has('list')) r.missing.push('search query');
    if (!ops.has('find') && !ops.has('get')) r.missing.push('find query');
    if (!ops.has('create')) r.missing.push('create mutation');
    if (!ops.has('update')) r.missing.push('update mutation');
    if (!ops.has('delete')) r.missing.push('delete mutation');

    resources[tableName] = r;
  }

  return resources;
}

function flattenYaml(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenYaml(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

export function pluralize(name) {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('z') ||
      name.endsWith('ch') || name.endsWith('sh')) {
    return name + 'es';
  }
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) {
    return name.slice(0, -1) + 'ies';
  }
  return name + 's';
}

async function globFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.filter(f => f.endsWith(ext));
  } catch {
    return [];
  }
}

async function globLiquidFiles(appDir) {
  if (!existsSync(appDir)) return [];
  try {
    const entries = await readdir(appDir, { recursive: true });
    return entries.filter(f => f.endsWith('.liquid'));
  } catch {
    return [];
  }
}
