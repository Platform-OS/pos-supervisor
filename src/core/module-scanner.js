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
  const [metadata, apiSurface, schemas, graphql, translations, pages, cssClasses] = await Promise.all([
    scanMetadata(moduleDir),
    scanPublicApi(publicDir, moduleName),
    scanSchemas(publicDir),
    scanGraphQL(publicDir),
    scanTranslations(publicDir),
    scanPages(publicDir),
    scanCssClasses(publicDir),
  ]);

  return {
    name: moduleName,
    display_name: metadata.name || moduleName,
    version: metadata.version || 'unknown',
    dependencies: metadata.dependencies || {},
    manifest_source: metadata.manifest_source ?? null,
    ...(metadata.manifest_warnings ? { manifest_warnings: metadata.manifest_warnings } : {}),
    installed: true,
    ...apiSurface,
    schemas,
    graphql,
    translations,
    pages,
    css_classes: cssClasses,
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
        manifest_source: meta.manifest_source ?? null,
        ...(meta.manifest_warnings ? { manifest_warnings: meta.manifest_warnings } : {}),
      });
    }

    return modules;
  } catch {
    return [];
  }
}

// ── Metadata scanning ────────────────────────────────────────────────────────
//
// Precedence (most authoritative first):
//   1. `pos-module.json`        — upstream platformOS module manifest. Source
//                                 of truth for `version` and `dependencies`.
//   2. `template-values.json`   — generated artifact emitted by
//                                 `pos-cli modules version`. Mirrors
//                                 pos-module.json but can drift if deps are
//                                 added without re-running the version sync.
//   3. `package.json`           — npm metadata. Its `version` reflects the
//                                 npm-package layout, NOT the platformOS
//                                 module version. Last-resort fallback.
//
// When both `pos-module.json` and `template-values.json` exist we run a drift
// check; any divergence in `version` or in the `dependencies` key set surfaces
// in `manifest_warnings` so module_info can flag it for the operator.

async function readJsonOr(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function scanMetadata(moduleDir) {
  const posModule      = await readJsonOr(join(moduleDir, 'pos-module.json'));
  const templateValues = await readJsonOr(join(moduleDir, 'template-values.json'));

  let primary = null;
  let source  = null;
  if (posModule) {
    primary = posModule;
    source  = 'pos-module.json';
  } else if (templateValues) {
    primary = templateValues;
    source  = 'template-values.json';
  } else {
    const pkg = await readJsonOr(join(moduleDir, 'package.json'));
    if (pkg) {
      return {
        name: pkg.name ?? null,
        version: pkg.version ?? null,
        dependencies: pkg.dependencies ?? {},
        manifest_source: 'package.json',
      };
    }
    return { manifest_source: null };
  }

  const out = {
    name: primary.name ?? null,
    version: primary.version ?? null,
    dependencies: primary.dependencies ?? {},
    manifest_source: source,
  };

  if (posModule && templateValues) {
    const warnings = detectManifestDrift(posModule, templateValues);
    if (warnings.length > 0) out.manifest_warnings = warnings;
  }

  return out;
}

/**
 * Compare `pos-module.json` and `template-values.json` and emit one warning per
 * detected divergence. Used by scanMetadata to surface stale module-version
 * sync state — the canonical fix is to re-run `pos-cli modules version <name>`.
 */
function detectManifestDrift(posModule, templateValues) {
  const warnings = [];

  if ((posModule.version ?? null) !== (templateValues.version ?? null)) {
    warnings.push({
      kind: 'version_drift',
      pos_module: posModule.version ?? null,
      template_values: templateValues.version ?? null,
      message: `pos-module.json (${posModule.version ?? 'null'}) and template-values.json (${templateValues.version ?? 'null'}) report different versions. pos-module.json wins. Re-run \`pos-cli modules version <name>\` to sync.`,
    });
  }

  const posDeps = posModule.dependencies ?? {};
  const tvDeps  = templateValues.dependencies ?? {};
  const posKeys = Object.keys(posDeps);
  const tvKeys  = Object.keys(tvDeps);
  const onlyPos = posKeys.filter(k => !(k in tvDeps));
  const onlyTv  = tvKeys.filter(k => !(k in posDeps));

  if (onlyPos.length > 0 || onlyTv.length > 0) {
    warnings.push({
      kind: 'dependency_drift',
      only_in_pos_module: onlyPos.sort(),
      only_in_template_values: onlyTv.sort(),
      message: [
        onlyPos.length > 0 ? `pos-module.json adds [${onlyPos.sort().join(', ')}]` : null,
        onlyTv.length  > 0 ? `template-values.json adds [${onlyTv.sort().join(', ')}]` : null,
      ].filter(Boolean).join('; ') + '. pos-module.json wins. Re-run `pos-cli modules version <name>` to sync.',
    });
  }

  return warnings;
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

  /**
   * Read a single liquid file and enrich the base info with everything we can
   * infer: params (doc + body-inferred optionality), call syntax (@example
   * verbatim, else generated), @return, description, and pattern.
   */
  async function enrichEntry(absPath, info, category) {
    try {
      const content = await readFile(absPath, 'utf8');

      const params = parseDocBlock(content);
      const commentParams = parseCommentParams(content);
      const paramList = params.length > 0 ? params : commentParams;
      if (paramList.length > 0) {
        info.params = paramList;
        info.required_params = paramList.filter(p => !p.optional).map(p => p.name);
        info.optional_params = paramList.filter(p =>  p.optional).map(p => p.name);
      }

      // Prefer author-maintained @example — that is the authoritative form.
      const example = parseDocExample(content);
      info.call_syntax = example || buildCallSyntax({
        category,
        call_path: info.call_path,
        params: paramList,
      });

      const returns = parseDocReturns(content);
      if (returns) info.returns = returns;

      if (category === 'commands') {
        info.pattern = detectCommandPattern(content);
      }

      const desc = extractDescription(content);
      if (desc) info.description = desc;
    } catch {}
    return info;
  }

  if (!existsSync(libDir)) {
    // Fallback: scan partials from views/partials. Some modules place lib code
    // under views/partials/lib/... — we walk that tree and classify by the first
    // path segment after views/partials so helpers/commands still route correctly.
    const partialsDir = join(publicDir, 'views', 'partials');
    if (existsSync(partialsDir)) {
      const files = await walkDir(partialsDir);
      for (const f of files) {
        if (!f.endsWith('.liquid')) continue;
        const rel = relative(partialsDir, f);
        const name = rel.replace(/\.liquid$/, '');

        // If the file sits under a lib/ subtree in views/partials/, classify by
        // the directory that follows lib/. Otherwise treat it as a plain partial.
        const libMatch = rel.match(/^lib\/([^/]+)\//);
        const category = libMatch ? classifyLibFile(`${libMatch[1]}/dummy`) : 'partials';

        const info = { name, call_path: `modules/${moduleName}/${name}` };
        await enrichEntry(f, info, category);

        switch (category) {
          case 'commands':    result.commands.push(info);    break;
          case 'queries':     result.queries.push(info);     break;
          case 'helpers':     result.helpers.push(info);     break;
          case 'validations': result.validations.push(info); break;
          case 'events':      result.events.push(info);      break;
          case 'hooks':       result.hooks.push(info);       break;
          default:            result.partials.push(info);    break;
        }
      }
    }
    for (const key of Object.keys(result)) {
      result[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return result;
  }

  const files = await walkDir(libDir);

  for (const absPath of files) {
    if (!absPath.endsWith('.liquid')) continue;

    const rel = relative(libDir, absPath);
    const name = rel.replace(/\.liquid$/, '');
    const category = classifyLibFile(rel);
    const info = { name, call_path: `modules/${moduleName}/${name}` };

    await enrichEntry(absPath, info, category);

    switch (category) {
      case 'commands':    result.commands.push(info);    break;
      case 'queries':     result.queries.push(info);     break;
      case 'helpers':     result.helpers.push(info);     break;
      case 'validations': result.validations.push(info); break;
      case 'events':      result.events.push(info);      break;
      case 'hooks':       result.hooks.push(info);       break;
      default:            result.partials.push(info);    break;
    }
  }

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

// ── CSS class scanning ───────────────────────────────────────────────────────

/**
 * Extract the set of CSS class names a module publishes. Used by scaffold to
 * verify hard-coded classes against the real set (modules/common-styling is the
 * primary consumer).
 *
 * Resolution order:
 *   1. public/css_classes.json (convention — upstream can publish a manifest)
 *   2. Regex-scan every .css file under public/assets/ for class selectors
 *
 * Returns a sorted array of unique class names, or an empty array when the
 * module has no CSS. Never throws — a malformed CSS file produces an empty set.
 */
async function scanCssClasses(publicDir) {
  // 1. Manifest file takes precedence.
  const manifestPath = join(publicDir, 'css_classes.json');
  if (existsSync(manifestPath)) {
    try {
      const raw = await readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return [...new Set(parsed)].sort();
      if (parsed && Array.isArray(parsed.classes)) return [...new Set(parsed.classes)].sort();
    } catch { /* fall through to regex scan */ }
  }

  // 2. Regex scan of CSS assets.
  const assetsDir = join(publicDir, 'assets');
  if (!existsSync(assetsDir)) return [];

  const classes = new Set();
  try {
    const files = await walkDir(assetsDir);
    for (const f of files) {
      if (!f.endsWith('.css') && !f.endsWith('.scss')) continue;
      try {
        const content = await readFile(f, 'utf8');
        // Match class selectors: .name, .name__element, .name--modifier.
        // Deliberately loose — we want a superset of everything that looks
        // class-ish, not a strict CSS parser.
        const matches = content.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g);
        for (const m of matches) {
          classes.add(m[1]);
        }
      } catch { /* individual file read error — skip */ }
    }
  } catch { /* assets dir unreadable — skip */ }

  return [...classes].sort();
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
 *
 * Understands two @param forms:
 *   @param name {Type} - description          (required)
 *   @param [name] {Type} - description        (optional — bracketed name)
 *
 * Optionality is ALSO inferred from the body: a param that is referenced with
 * `| default:` anywhere in the file is treated as optional. Both signals must
 * agree in most well-formed modules; when they disagree, explicit brackets win.
 */
function parseDocBlock(content) {
  const docMatch = content.match(/\{%\s*doc\s*%\}([\s\S]*?)\{%\s*enddoc\s*%\}/);
  if (!docMatch) return [];

  const body = docMatch[1];
  const params = [];

  // Match either `@param name {Type}` or `@param [name] {Type}` — the brackets
  // mark explicit optionality. We capture the bracket marker so optionality is
  // set from doc syntax, then refined below by scanning the file body.
  //
  // Important: use [^\S\r\n] (horizontal whitespace only) in places where we
  // do NOT want to cross a line boundary. Plain \s* eats newlines and would
  // pull the next `@param` line into the description capture, merging entries.
  const paramRegex = /@param[^\S\r\n]+(\[?)(\w+)\]?[^\S\r\n]+\{([^}]+)\}[^\S\r\n]*-?[^\S\r\n]*([^\r\n]*)/g;
  let m;
  while ((m = paramRegex.exec(body)) !== null) {
    const [ , bracket, name, type, description ] = m;
    params.push({
      name,
      type: type.trim(),
      description: description.trim(),
      optional: bracket === '[',
    });
  }

  // Body-based inference: a param referenced with `| default:` is optional even
  // if the doc block did not bracket it. This keeps doc blocks that predate the
  // `[name]` convention correct.
  for (const p of params) {
    if (p.optional) continue;
    const defaultPattern = new RegExp(
      `\\b${p.name}\\s*\\|\\s*default\\s*:`
    );
    if (defaultPattern.test(content)) p.optional = true;
  }

  return params;
}

/**
 * Parse an @example block out of a doc block, if present. This gives the
 * authoritative call syntax — the one upstream maintainers wrote and reviewed.
 */
function parseDocExample(content) {
  const docMatch = content.match(/\{%\s*doc\s*%\}([\s\S]*?)\{%\s*enddoc\s*%\}/);
  if (!docMatch) return null;

  // @example can span multiple lines; capture everything up to the next
  // @-prefixed tag or the end of the doc block.
  const exMatch = docMatch[1].match(/@example\s*\n?([\s\S]*?)(?=\n\s*@\w|\n?$)/);
  if (!exMatch) return null;
  return exMatch[1].trim();
}

/**
 * Parse @return from a doc block, if present. Same line-scoping rules as
 * parseDocBlock — we MUST NOT let \s* eat newlines or the capture pulls in the
 * next doc line and mangles the result.
 */
function parseDocReturns(content) {
  const docMatch = content.match(/\{%\s*doc\s*%\}([\s\S]*?)\{%\s*enddoc\s*%\}/);
  if (!docMatch) return null;

  // Accept either `@return {Type} - description` or `@return description`.
  // Uses [^\S\r\n] (horizontal whitespace) and [^\r\n]* to stay on one line.
  const retMatch = docMatch[1].match(/@returns?[^\S\r\n]+(?:\{([^}]+)\}[^\S\r\n]*-?[^\S\r\n]*)?([^\r\n]*)/);
  if (!retMatch) return null;

  const [ , type, description ] = retMatch;
  if (type && description) return `{${type.trim()}} ${description.trim()}`;
  if (type)                return `{${type.trim()}}`;
  return (description ?? '').trim() || null;
}

/**
 * Build canonical call syntax for a module entry from its category, call path,
 * and param list. Prefers {% function %} for helpers/commands/queries/validations
 * (the idiomatic platformOS pattern) and {% render %} for plain partials.
 *
 * If the source file contains an explicit @example, callers should prefer that
 * verbatim. This function is the fallback when no @example is provided.
 */
function buildCallSyntax({ category, call_path, params = [] }) {
  const required = params.filter(p => !p.optional);
  const paramPairs = required.length > 0
    ? ', ' + required.map(p => `${p.name}: ${sampleValue(p.type)}`).join(', ')
    : '';

  if (category === 'partials') {
    return `{% render '${call_path}'${paramPairs} %}`;
  }
  // Everything else in lib/ is called via {% function %}
  return `{% function result = '${call_path}'${paramPairs} %}`;
}

/** Produce a sensible placeholder value for a given doc type. */
function sampleValue(type) {
  const t = type.toLowerCase();
  if (t.includes('string'))  return "'value'";
  if (t.includes('integer')) return '1';
  if (t.includes('int'))     return '1';
  if (t.includes('float'))   return '1.0';
  if (t.includes('number'))  return '1';
  if (t.includes('bool'))    return 'true';
  if (t.includes('array'))   return '[]';
  if (t.includes('hash') || t.includes('object')) return '{}';
  return 'value';
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
