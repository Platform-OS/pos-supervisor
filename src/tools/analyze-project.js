import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCheckRunner } from '../core/check-runner.js';
import { validateSchema } from '../core/schema-validator.js';
import { toUri, sanitizePath } from '../core/utils.js';
import { getProjectMap } from './project-map.js';
import { ToolError } from '../core/tool-error.js';

export const analyzeProjectTool = {
  name: 'analyze_project',
  description: 'Cross-file project health overview. Returns per-file error/warning counts, dependency graph, broken references, dead code, and schema issues. Use validate_code on individual files for full diagnostics, fix proposals, and context-aware analysis.',
  inputSchema: {
    files: z.array(z.string()).optional().describe('List of file paths (relative to project root) to analyze. Omit to analyze all project files.'),
    min_severity: z.enum(['error', 'warning', 'info']).optional().describe('Minimum severity to include in file counts. "error" = only list files with errors, "warning" = errors + warnings (default), "info" = everything.'),
  },

  createHandler(ctx) {
    const runCheck = createCheckRunner({
      cmd: ctx.checkCmd,
      args: ctx.checkArgs,
      directory: ctx.directory,
      log: ctx.log,
    });

    return async (params) => {
      let { files, min_severity = 'warning' } = params;
      const SEV_RANK = { error: 3, warning: 2, info: 1 };
      const minRank = SEV_RANK[min_severity] ?? 2;

      // If no files specified, discover all .liquid and .graphql files in app/
      if (!files || !Array.isArray(files) || files.length === 0) {
        const appDir = join(ctx.directory, 'app');
        try {
          const entries = await readdir(appDir, { recursive: true });
          files = entries
            .filter(e => e.endsWith('.liquid') || e.endsWith('.graphql'))
            .map(e => join('app', e));
        } catch {
          throw new ToolError('No files specified and could not scan app/ directory', { status: 404 });
        }
        if (files.length === 0) {
          throw new ToolError('No .liquid or .graphql files found in app/', { status: 404 });
        }
      }

      // Validate all paths upfront
      const absPaths = {};
      for (const filePath of files) {
        try {
          absPaths[filePath] = sanitizePath(ctx.directory, filePath);
        } catch (e) {
          throw new ToolError(`Invalid file path "${filePath}": ${e.message}`);
        }
      }

      // Run pos-cli check ONCE for the whole project, then count per file
      const allResults = await runCheck(null);
      const filesScanned = files.length;

      const fileResults = [];
      for (const filePath of files) {
        const absPath = absPaths[filePath];

        const errorCount = allResults.errors.filter(d => matchesFile(d, absPath, filePath)).length;
        const warningCount = allResults.warnings.filter(d => matchesFile(d, absPath, filePath)).length;
        const infoCount = allResults.infos.filter(d => matchesFile(d, absPath, filePath)).length;

        // Only include files that have issues at or above min_severity
        const hasRelevant =
          errorCount > 0 ||
          (minRank <= 2 && warningCount > 0) ||
          (minRank <= 1 && infoCount > 0);

        if (hasRelevant) {
          const entry = { path: filePath, errors: errorCount, warnings: warningCount };
          if (minRank <= 1) entry.infos = infoCount;
          fileResults.push(entry);
        }
      }

      // Schema validation — validate all .yml files in app/schema/
      let schemasScanned = 0;
      try {
        const schemaDir = join(ctx.directory, 'app', 'schema');
        const schemaEntries = await readdir(schemaDir).catch(() => []);
        for (const entry of schemaEntries) {
          if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
          schemasScanned++;
          const relPath = join('app', 'schema', entry);
          try {
            const content = await readFile(join(schemaDir, entry), 'utf8');
            const schemaResult = validateSchema(content, relPath);
            const errorCount = schemaResult.errors.length;
            const warningCount = schemaResult.warnings.length;
            const hasRelevant = errorCount > 0 || (minRank <= 2 && warningCount > 0);
            if (hasRelevant) {
              fileResults.push({ path: relPath, errors: errorCount, warnings: warningCount });
            }
          } catch { /* individual schema file read/parse failure — skip */ }
        }
      } catch { /* schema directory not found — skip */ }

      // Build dependency graph via LSP
      await ctx.awaitLsp();

      const dependencyGraph = {};
      if (ctx.lsp?.initialized) {
        for (const filePath of files) {
          const absPath = absPaths[filePath];
          const uri = toUri(absPath);
          try {
            const [refs, deps] = await Promise.all([
              ctx.lsp.references(uri).catch(() => null),
              ctx.lsp.dependencies(uri).catch(() => null),
            ]);

            dependencyGraph[filePath] = {
              referenced_by: (refs?.items ?? []).map(r => (r.source?.uri ?? '').replace('file://', '')),
              depends_on: (deps?.items ?? []).map(d => (d.target?.uri ?? '').replace('file://', '')),
            };
          } catch {
            dependencyGraph[filePath] = { referenced_by: [], depends_on: [] };
          }
        }
      }

      // Cross-file integrity checks + dead code detection using project_map
      let integrity = [];
      let dead_code = [];
      try {
        const projectMap = await getProjectMap(ctx.directory);
        integrity = performIntegrityChecks(projectMap);

        // Dead code: files never referenced by anything
        const referencedPartials = new Set();
        const referencedGraphql = new Set();
        const referencedCommands = new Set();
        const referencedQueries = new Set();

        for (const partial of Object.values(projectMap.partials ?? {})) {
          if ((partial.rendered_by ?? []).length > 0) {
            referencedPartials.add(partial.path);
          }
        }

        for (const cmd of Object.values(projectMap.commands ?? {})) {
          for (const gql of cmd.graphql_calls ?? []) {
            referencedGraphql.add(gql.queryName ?? gql);
          }
        }
        for (const q of Object.values(projectMap.queries ?? {})) {
          for (const gql of q.graphql_calls ?? []) {
            referencedGraphql.add(gql.queryName ?? gql);
          }
        }

        for (const page of Object.values(projectMap.pages ?? {})) {
          for (const fc of page.function_calls ?? []) {
            referencedCommands.add(`app/lib/${fc.path}.liquid`);
            referencedQueries.add(`app/lib/${fc.path}.liquid`);
          }
        }
        for (const partial of Object.values(projectMap.partials ?? {})) {
          for (const fc of partial.function_calls ?? []) {
            referencedCommands.add(`app/lib/${fc.path}.liquid`);
            referencedQueries.add(`app/lib/${fc.path}.liquid`);
          }
        }

        for (const [name, partial] of Object.entries(projectMap.partials ?? {})) {
          if (!referencedPartials.has(partial.path)) {
            dead_code.push(partial.path);
          }
        }

        for (const cmdPath of Object.keys(projectMap.commands ?? {})) {
          if (!referencedCommands.has(cmdPath)) {
            const isSubPhase = cmdPath.includes('/build.liquid') || cmdPath.includes('/check.liquid');
            if (!isSubPhase) {
              dead_code.push(cmdPath);
            }
          }
        }

        for (const qPath of Object.keys(projectMap.queries ?? {})) {
          if (!referencedQueries.has(qPath)) {
            dead_code.push(qPath);
          }
        }
      } catch {
        // Integrity checks and dead code detection are best-effort
      }

      // Apply severity filter to integrity issues
      if (minRank > 1) {
        integrity = integrity.filter(i => (SEV_RANK[i.severity] ?? 1) >= minRank);
      }

      const lintErrors = fileResults.reduce((s, f) => s + f.errors, 0);
      const lintWarnings = fileResults.reduce((s, f) => s + f.warnings, 0);
      const integrityErrors = integrity.filter(i => i.severity === 'error').length;
      const integrityWarnings = integrity.filter(i => i.severity === 'warning').length;

      return {
        files_scanned: filesScanned + schemasScanned,
        files: fileResults,
        dependency_graph: dependencyGraph,
        dead_code,
        integrity,
        lint_errors: lintErrors,
        lint_warnings: lintWarnings,
        integrity_errors: integrityErrors,
        integrity_warnings: integrityWarnings,
        total_errors: lintErrors + integrityErrors,
        total_warnings: lintWarnings + integrityWarnings,
        next_step: 'Run validate_code on files with errors for full diagnostics, fix proposals, and context-aware analysis.',
      };
    };
  },
};

/**
 * Cross-file integrity checks using the project map.
 * Detects broken render references, missing graphql operations,
 * broken function calls, and orphan partials.
 */
function performIntegrityChecks(projectMap) {
  const issues = [];
  const allPartials = new Set(Object.keys(projectMap.partials ?? {}));
  const allGraphql = new Set(Object.keys(projectMap.graphql ?? {}));
  const allCommands = new Set(Object.keys(projectMap.commands ?? {}));
  const allQueries = new Set(Object.keys(projectMap.queries ?? {}));

  /** Skip module references — module files exist at runtime, not in local app/ */
  const isModuleRef = (name) => name.startsWith('modules/');

  // 1. Broken render references (pages and partials)
  for (const [slug, page] of Object.entries(projectMap.pages ?? {})) {
    for (const renderName of page.renders ?? []) {
      if (!isModuleRef(renderName) && !allPartials.has(renderName)) {
        issues.push({
          type: 'broken_render', severity: 'error', source: page.path, target: renderName,
          message: `Page '${page.path}' renders partial '${renderName}' which does not exist`,
        });
      }
    }
  }
  for (const [name, partial] of Object.entries(projectMap.partials ?? {})) {
    for (const renderName of partial.renders ?? []) {
      if (!isModuleRef(renderName) && !allPartials.has(renderName)) {
        issues.push({
          type: 'broken_render', severity: 'error', source: partial.path, target: renderName,
          message: `Partial '${name}' renders '${renderName}' which does not exist`,
        });
      }
    }
  }

  // 2. Missing GraphQL operations (commands and queries)
  for (const [path, cmd] of Object.entries(projectMap.commands ?? {})) {
    for (const gql of cmd.graphql_calls ?? []) {
      const queryName = gql.queryName ?? gql;
      if (!isModuleRef(queryName) && !allGraphql.has(queryName)) {
        issues.push({
          type: 'missing_graphql', severity: 'error', source: path, target: queryName,
          message: `Command '${path}' references GraphQL '${queryName}' which does not exist`,
        });
      }
    }
  }
  for (const [path, query] of Object.entries(projectMap.queries ?? {})) {
    for (const gql of query.graphql_calls ?? []) {
      const queryName = gql.queryName ?? gql;
      if (!isModuleRef(queryName) && !allGraphql.has(queryName)) {
        issues.push({
          type: 'missing_graphql', severity: 'error', source: path, target: queryName,
          message: `Query '${path}' references GraphQL '${queryName}' which does not exist`,
        });
      }
    }
  }

  // 3. Broken function calls (from pages, partials, commands, queries)
  // In platformOS, {% function result = 'queries/X' %} resolves to app/lib/queries/X.liquid
  // The lib/ prefix is implicit in function calls.
  const checkFunctionCalls = (sourcePath, functionCalls) => {
    for (const fc of functionCalls ?? []) {
      if (isModuleRef(fc.path)) continue;
      // function call path → disk path: app/lib/{path}.liquid
      const fullPath = `app/lib/${fc.path}.liquid`;
      if (fc.path.includes('commands/') && !allCommands.has(fullPath)) {
        issues.push({
          type: 'missing_command', severity: 'error', source: sourcePath, target: fullPath,
          message: `'${sourcePath}' calls command '${fc.path}' (resolves to ${fullPath}) which does not exist`,
        });
      } else if (fc.path.includes('queries/') && !allQueries.has(fullPath)) {
        issues.push({
          type: 'missing_query', severity: 'error', source: sourcePath, target: fullPath,
          message: `'${sourcePath}' calls query '${fc.path}' (resolves to ${fullPath}) which does not exist`,
        });
      }
    }
  };

  for (const [slug, page] of Object.entries(projectMap.pages ?? {})) {
    checkFunctionCalls(page.path, page.function_calls);
  }
  // Also check function calls from partials, commands, and queries
  for (const [name, partial] of Object.entries(projectMap.partials ?? {})) {
    checkFunctionCalls(partial.path, partial.function_calls);
  }

  // 4. Orphan partials (never rendered by anything)
  for (const [name, partial] of Object.entries(projectMap.partials ?? {})) {
    if ((partial.rendered_by ?? []).length === 0) {
      issues.push({
        type: 'orphan_partial', severity: 'warning', source: partial.path, target: null,
        message: `Partial '${name}' is never rendered by any file in the project`,
      });
    }
  }

  return issues;
}

/**
 * Check if a diagnostic belongs to a specific file.
 * pos-cli check returns file paths in various formats — match flexibly.
 */
function matchesFile(diagnostic, absPath, relPath) {
  if (diagnostic._filePath) {
    return diagnostic._filePath === absPath || diagnostic._filePath.endsWith(relPath);
  }
  return true;
}
