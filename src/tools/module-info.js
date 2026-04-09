/**
 * module_info tool — comprehensive module reference combining live disk
 * scanning with curated documentation.
 *
 * Returns everything an agent needs to correctly USE a module:
 * - Metadata (version, dependencies)
 * - Complete public API surface with call paths and parameters
 * - Schemas with property types
 * - GraphQL operations with arguments
 * - Reference documentation (API, patterns, gotchas, configuration, advanced)
 * - Pages and routes
 * - Translation key counts
 */

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanModule, listModules } from '../core/module-scanner.js';
import { ToolError } from '../core/tool-error.js';

const SECTIONS = ['overview', 'api', 'patterns', 'gotchas', 'configuration', 'advanced', 'prerequisites', 'all'];

const REF_FILE_MAP = {
  overview: 'README.md',
  api: 'api.md',
  patterns: 'patterns.md',
  gotchas: 'gotchas.md',
  configuration: 'configuration.md',
  advanced: 'advanced.md',
  prerequisites: 'prerequisites.md',
};

export const moduleInfoTool = {
  name: 'module_info',
  description:
    'Get comprehensive reference for a platformOS module. Combines live disk scanning (version, API surface, schemas, GraphQL ops, parameters) with curated documentation (API reference, usage patterns, gotchas, configuration). Call with just a name for a complete overview, or specify a section for focused docs. Call without a name to list all installed modules.',
  inputSchema: {
    name: z.string().optional().describe('Module name (directory name under modules/, e.g. "core", "user", "payments"). Omit to list all installed modules.'),
    section: z.enum(SECTIONS).optional().describe('Documentation section: "overview" (default — API surface + README), "api" (function signatures), "patterns" (usage examples), "gotchas" (common mistakes), "configuration" (setup), "advanced" (edge cases), "all" (everything).'),
  },

  createHandler(ctx) {
    return async (params) => {
      const { name, section = 'overview' } = params;

      // List mode: no name provided
      if (!name) {
        return listInstalledModules(ctx.directory);
      }

      if (!SECTIONS.includes(section)) {
        throw new ToolError(`Invalid section "${section}". Valid: ${SECTIONS.join(', ')}`);
      }

      // Scan live module from disk
      const scan = await scanModule(ctx.directory, name);
      if (scan.error) {
        // Module not installed — try to provide reference docs only
        const refDocs = await loadReferenceDocs(name, section);
        if (refDocs) {
          return {
            name,
            installed: false,
            note: `Module '${name}' is not installed in this project, but reference documentation is available.`,
            reference: refDocs,
          };
        }
        throw new ToolError(scan.error, { status: 404 });
      }

      // Build result based on section
      if (section === 'all') {
        return buildFullReport(name, scan, ctx.directory);
      }

      if (section === 'overview') {
        return buildOverview(name, scan, ctx.directory);
      }

      // Specific section: return scan summary + focused reference doc
      const refDoc = await loadReferenceDoc(name, section);
      return {
        name,
        version: scan.version,
        dependencies: scan.dependencies,
        section,
        reference: refDoc || `No ${section} documentation available for module '${name}'.`,
        // Include API surface for quick context
        api_summary: {
          commands: scan.commands.length,
          queries: scan.queries.length,
          helpers: scan.helpers.length,
          validations: scan.validations.length,
          schemas: scan.schemas.length,
          graphql: scan.graphql.length,
        },
      };
    };
  },
};

// ── Report builders ──────────────────────────────────────────────────────────

async function listInstalledModules(projectDir) {
  const modules = await listModules(projectDir);

  if (modules.length === 0) {
    return {
      modules: [],
      note: 'No modules installed. Install modules with: pos-cli modules install <module_name>',
    };
  }

  // Also check which have reference docs
  const withDocs = modules.map(m => {
    const refsDir = join(__dirname, '..', 'data', 'references', 'modules', m.name);
    return {
      ...m,
      has_reference_docs: existsSync(refsDir),
    };
  });

  return {
    modules: withDocs,
    total: withDocs.length,
    hint: 'Call module_info with a specific name for full documentation, e.g. module_info({ name: "core" })',
  };
}

async function buildOverview(name, scan) {
  const [readme, prerequisites] = await Promise.all([
    loadReferenceDoc(name, 'overview'),
    loadReferenceDoc(name, 'prerequisites'),
  ]);

  return {
    name,
    display_name: scan.display_name,
    version: scan.version,
    dependencies: scan.dependencies,
    installed: true,

    // Required setup steps — always surfaced when docs exist so agents don't miss prerequisites
    ...(prerequisites ? { prerequisites } : {}),

    // API surface summary with call paths
    api: {
      commands: scan.commands.map(formatApiEntry),
      queries: scan.queries.map(formatApiEntry),
      helpers: scan.helpers.map(formatApiEntry),
      validations: scan.validations.map(c => ({ name: c.name, call_path: c.call_path })),
      events: scan.events.map(c => ({ name: c.name, call_path: c.call_path })),
      hooks: scan.hooks.map(c => ({ name: c.name, call_path: c.call_path })),
    },

    // Schema summary
    schemas: scan.schemas.map(s => ({
      name: s.name,
      properties: s.properties,
    })),

    // GraphQL operations
    graphql: scan.graphql.map(g => ({
      name: g.name,
      type: g.type,
      args: g.args,
    })),

    // Pages/routes
    pages: scan.pages,

    // Translations
    translations: scan.translations,

    // Curated overview documentation
    reference_overview: readme || null,

    // Available sections for deeper dives
    available_sections: Object.keys(REF_FILE_MAP).filter(s =>
      existsSync(join(__dirname, '..', 'data', 'references', 'modules', name, REF_FILE_MAP[s]))
    ),
  };
}

async function buildFullReport(name, scan) {
  const overview = await buildOverview(name, scan);

  // Load all reference docs
  const allDocs = {};
  for (const [section, file] of Object.entries(REF_FILE_MAP)) {
    if (section === 'overview') continue; // Already in reference_overview
    if (section === 'prerequisites') continue; // Already at top-level in overview
    const doc = await loadReferenceDoc(name, section);
    if (doc) allDocs[section] = doc;
  }

  return {
    ...overview,
    reference_docs: allDocs,
  };
}

function formatApiEntry(entry) {
  const result = {
    name: entry.name,
    call_path: entry.call_path,
  };
  if (entry.params?.length > 0) result.params = entry.params;
  if (entry.description) result.description = entry.description;
  if (entry.pattern) result.pattern = entry.pattern;
  return result;
}

// ── Reference doc loading ────────────────────────────────────────────────────

// Use import.meta for ESM __dirname equivalent
const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

async function loadReferenceDoc(moduleName, section) {
  const fileName = REF_FILE_MAP[section];
  if (!fileName) return null;

  const filePath = join(__dirname, '..', 'data', 'references', 'modules', moduleName, fileName);
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function loadReferenceDocs(moduleName, section) {
  if (section === 'all') {
    const docs = {};
    for (const [sec, file] of Object.entries(REF_FILE_MAP)) {
      const doc = await loadReferenceDoc(moduleName, sec);
      if (doc) docs[sec] = doc;
    }
    return Object.keys(docs).length > 0 ? docs : null;
  }

  return loadReferenceDoc(moduleName, section);
}
