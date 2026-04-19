import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCheckRunner } from '../core/check-runner.js';
import { validateSchema } from '../core/schema-validator.js';
import { toUri, sanitizePath } from '../core/utils.js';
import { getProjectMap } from './project-map.js';
import { ToolError } from '../core/tool-error.js';
import {
  suppressByPending,
  buildPendingPartialNames,
  buildPendingPageKeys,
} from '../core/diagnostic-pipeline.js';
import { buildDependencyGraph, detectOrphanedFiles } from '../core/dependency-graph.js';
import { findOrphanPartials } from '../core/orphan-detector.js';
import { resolveRenderName } from '../core/project-scanner.js';
import { buildFactGraph } from '../core/project-fact-graph.js';

export const analyzeProjectTool = {
  name: 'analyze_project',
  description: 'Cross-file project health overview. Returns per-file error/warning counts, dependency graph, broken references, orphaned files, and schema issues. Use validate_code on individual files for full diagnostics, fix proposals, and context-aware analysis.',
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

      // Fetch the project map once up front — used for file listing, dep graph,
      // and integrity checks. Cached by getProjectMap so this is near-free.
      const projectMap = await getProjectMap(ctx.directory);
      const factGraph = buildFactGraph(projectMap);

      // If no files specified, use the fact graph's indexed file list instead of
      // re-walking app/ (eliminates the parallel-walk class of bugs).
      if (!files || !Array.isArray(files) || files.length === 0) {
        files = factGraph.allCheckableFiles();
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

      // Apply session.pending suppression to the aggregated result before per-file counting.
      // This keeps analyze_project consistent with validate_code — both honor the same
      // authoritative pending state written by validate_intent, so a multi-file plan
      // does not produce false-positive MissingPartial/MissingPage/TranslationKeyExists
      // counts during the creation window.
      const sessionPending = ctx.session?.pending;
      if (sessionPending && (sessionPending.files.size > 0 || sessionPending.pages.size > 0 || sessionPending.translations.size > 0)) {
        if (sessionPending.files.size > 0) {
          suppressByPending(allResults, {
            check: 'MissingPartial',
            pendingSet: buildPendingPartialNames([...sessionPending.files]),
            extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
          });
        }
        if (sessionPending.pages.size > 0) {
          suppressByPending(allResults, {
            check: 'MissingPage',
            pendingSet: buildPendingPageKeys([...sessionPending.pages]),
            extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
          });
        }
        if (sessionPending.translations.size > 0) {
          suppressByPending(allResults, {
            check: 'TranslationKeyExists',
            pendingSet: new Set(sessionPending.translations),
            extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
          });
        }
      }

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

      // Build dependency graph.
      //
      // The LSP's appGraph/* methods return empty arrays for files it has not
      // indexed (warmup only opens placeholder files). Rather than rely on
      // LSP alone, we build the graph from the project_map scan — which has
      // EVERY file's renders, function_calls, and graphql_calls — and merge
      // LSP results on top. LSP wins per edge (it knows about dynamic render
      // names the scanner cannot see), projectMap backs it when LSP is silent.
      await ctx.awaitLsp();

      // Per-file LSP query, used as the overlay.
      const lspOverlay = {};
      if (ctx.lsp?.initialized) {
        for (const filePath of files) {
          const absPath = absPaths[filePath];
          const uri = toUri(absPath);
          try {
            const [refs, deps] = await Promise.all([
              ctx.lsp.references(uri).catch(() => null),
              ctx.lsp.dependencies(uri).catch(() => null),
            ]);

            lspOverlay[filePath] = {
              referenced_by: (refs?.items ?? []).map(r => (r.source?.uri ?? '').replace('file://', '')),
              depends_on: (deps?.items ?? []).map(d => (d.target?.uri ?? '').replace('file://', '')),
            };
          } catch {
            // LSP failure is not fatal — projectMap graph covers the file.
          }
        }
      }

      // projectMap-derived graph merged with LSP overlay. This is the
      // authoritative graph surfaced to the agent.
      const dependencyGraph = buildDependencyGraph(projectMap, lspOverlay);

      // Cross-file integrity checks + orphaned file detection.
      let integrity = [];
      let orphaned_files = [];
      try {
        integrity = performIntegrityChecks(projectMap);
        orphaned_files = detectOrphanedFiles(dependencyGraph, projectMap);
      } catch {
        // Integrity checks and orphaned file detection are best-effort.
      }

      // Apply severity filter to integrity issues
      if (minRank > 1) {
        integrity = integrity.filter(i => (SEV_RANK[i.severity] ?? 1) >= minRank);
      }

      const lintErrors = fileResults.reduce((s, f) => s + f.errors, 0);
      const lintWarnings = fileResults.reduce((s, f) => s + f.warnings, 0);
      const integrityErrors = integrity.filter(i => i.severity === 'error').length;
      const integrityWarnings = integrity.filter(i => i.severity === 'warning').length;

      const fix_order = buildFixOrder(fileResults, dependencyGraph, ctx.directory);

      const totalErrors = lintErrors + integrityErrors;
      const totalWarnings = lintWarnings + integrityWarnings;

      // ── blocking_files: files with errors that must be fixed ────────────
      const blockingFiles = computeBlockingFiles(fileResults, integrity, allResults);

      // ── diff_from_last_run: compare against previous analysis ──────────
      const prefix = ctx.directory.endsWith('/') ? ctx.directory : ctx.directory + '/';
      const toRel = (p) => p?.startsWith(prefix) ? p.slice(prefix.length) : (p ?? '');

      const currentSnapshot = buildDiagnosticSnapshot(allResults, integrity, toRel);
      const diff = computeDiffFromLastRun(ctx.session, currentSnapshot, totalErrors, totalWarnings);

      // Store snapshot for next run (after diff computed)
      if (ctx.session) {
        ctx.session.lastAnalysis = {
          timestamp: new Date().toISOString(),
          diagnostics: currentSnapshot,
          total_errors: totalErrors,
          total_warnings: totalWarnings,
        };
      }

      return {
        files_scanned: filesScanned + schemasScanned,
        files: fileResults,
        fix_order,
        blocking_files: blockingFiles,
        diff_from_last_run: diff,
        dependency_graph: dependencyGraph,
        orphaned_files,
        integrity,
        lint_errors: lintErrors,
        lint_warnings: lintWarnings,
        integrity_errors: integrityErrors,
        integrity_warnings: integrityWarnings,
        total_errors: totalErrors,
        total_warnings: totalWarnings,
        next_step: fix_order.length > 0
          ? `Fix in order: ${fix_order.map(f => f.path).join(' → ')}. Run validate_code on each file for full diagnostics and fix proposals.`
          : 'Run validate_code on individual files for full diagnostics, fix proposals, and context-aware analysis.',
      };
    };
  },
};

/**
 * Produce a topologically-sorted fix order for files that have errors.
 *
 * The dependency graph from the LSP stores absolute paths in `depends_on`.
 * We normalise these to relative paths (stripping `projectDir/`) so they
 * can be matched against the relative paths in `fileResults`.
 *
 * Sort rule: fix dependencies before the files that depend on them.
 * If A renders/calls B and both have errors, B should be fixed first —
 * fixing B may eliminate cascade errors in A.
 *
 * @param {{ path: string, errors: number, warnings: number }[]} fileResults
 * @param {Record<string, { depends_on: string[] }>} dependencyGraph
 * @param {string} projectDir - absolute project root
 * @returns {{ path: string, errors: number, warnings: number, reason: string, dependents_with_errors: number }[]}
 */
export function buildFixOrder(fileResults, dependencyGraph, projectDir) {
  if (fileResults.length === 0) return [];

  const errorPaths = new Set(fileResults.map(f => f.path));
  const prefix = projectDir.endsWith('/') ? projectDir : projectDir + '/';

  function toRel(absPath) {
    return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
  }

  // Build adjacency within the error subgraph only.
  // deps[path]      = Set of paths THIS file depends on that also have errors
  // dependents[path] = Set of paths that depend on THIS file and also have errors
  const deps = {};
  const dependents = {};
  for (const f of fileResults) {
    deps[f.path] = new Set();
    dependents[f.path] = new Set();
  }

  for (const f of fileResults) {
    const graph = dependencyGraph[f.path];
    if (!graph) continue;
    for (const raw of graph.depends_on ?? []) {
      const rel = toRel(raw);
      if (errorPaths.has(rel) && rel !== f.path) {
        deps[f.path].add(rel);
        dependents[rel].add(f.path);
      }
    }
  }

  // Kahn's algorithm — nodes with in-degree 0 (no unresolved deps) go first.
  const inDegree = {};
  for (const f of fileResults) inDegree[f.path] = deps[f.path].size;

  const queue = fileResults
    .filter(f => inDegree[f.path] === 0)
    .map(f => f.path);
  const result = [];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    const f = fileResults.find(x => x.path === current);
    const numDependents = dependents[current].size;
    result.push({
      path: current,
      errors: f.errors,
      warnings: f.warnings,
      dependents_with_errors: numDependents,
      reason: numDependents > 0
        ? `Fix first — ${numDependents} file(s) with errors depend on this`
        : deps[current].size > 0
          ? 'All dependencies fixed — fix this next'
          : 'No cross-error dependencies',
    });

    for (const dependent of dependents[current]) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }

  // Append any files caught in a cycle (shouldn't happen in a well-formed project)
  for (const f of fileResults) {
    if (!seen.has(f.path)) {
      result.push({
        path: f.path,
        errors: f.errors,
        warnings: f.warnings,
        dependents_with_errors: dependents[f.path].size,
        reason: 'Circular dependency — fix in any order',
      });
    }
  }

  return result;
}

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

  // 1. Broken render references (pages and partials).
  // Render names may be relative to the caller's directory — a partial at
  // app/views/partials/blog_posts/new.liquid that does {% render 'form' %}
  // resolves to 'blog_posts/form'. Use resolveRenderName so we match the same
  // keys the scanner stores (Phase 2.3).
  for (const [slug, page] of Object.entries(projectMap.pages ?? {})) {
    for (const renderName of page.renders ?? []) {
      if (isModuleRef(renderName)) continue;
      const resolved = resolveRenderName(page.path, renderName);
      if (!allPartials.has(resolved)) {
        issues.push({
          type: 'broken_render', severity: 'error', source: page.path, target: resolved,
          message: `Page '${page.path}' renders partial '${renderName}' (resolved to '${resolved}') which does not exist`,
        });
      }
    }
  }
  for (const [name, partial] of Object.entries(projectMap.partials ?? {})) {
    for (const renderName of partial.renders ?? []) {
      if (isModuleRef(renderName)) continue;
      const resolved = resolveRenderName(partial.path, renderName);
      if (!allPartials.has(resolved)) {
        issues.push({
          type: 'broken_render', severity: 'error', source: partial.path, target: resolved,
          message: `Partial '${name}' renders '${renderName}' (resolved to '${resolved}') which does not exist`,
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

  // 4. Orphan partials (never rendered by anything) — shared predicate so
  //    validate_intent P5 and dependency-graph orphaned-file detection use the
  //    same rule. See src/core/orphan-detector.js.
  for (const { name, path } of findOrphanPartials(projectMap)) {
    issues.push({
      type: 'orphan_partial', severity: 'warning', source: path, target: null,
      message: `Partial '${name}' is never rendered by any file in the project`,
    });
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

/**
 * Files with at least one error (lint or integrity) that block a clean project.
 * Sorted by total error count descending — worst offenders first.
 * @param {Array} fileResults - per-file { path, errors, warnings }
 * @param {Array} integrity - integrity issues with { severity, source, type }
 * @param {{ errors: Array }} [allResults] - full diagnostic results for check name extraction
 */
export function computeBlockingFiles(fileResults, integrity, allResults) {
  const blockMap = new Map();

  for (const f of fileResults) {
    if (f.errors > 0) {
      blockMap.set(f.path, { path: f.path, lint_errors: f.errors, integrity_errors: 0, checks: new Set() });
    }
  }

  if (allResults?.errors) {
    for (const d of allResults.errors) {
      const rel = d._filePath;
      for (const [key, entry] of blockMap) {
        if (rel && (rel === key || rel.endsWith('/' + key) || rel.endsWith(key))) {
          if (d.check) entry.checks.add(d.check);
        }
      }
    }
  }

  for (const issue of integrity) {
    if (issue.severity !== 'error' || !issue.source) continue;
    const existing = blockMap.get(issue.source);
    if (existing) {
      existing.integrity_errors++;
      if (issue.type) existing.checks.add(issue.type);
    } else {
      const checks = new Set();
      if (issue.type) checks.add(issue.type);
      blockMap.set(issue.source, { path: issue.source, lint_errors: 0, integrity_errors: 1, checks });
    }
  }

  return [...blockMap.values()]
    .map(b => ({ ...b, total: b.lint_errors + b.integrity_errors, checks: [...b.checks] }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Build a Map<fingerprint, detail> of all diagnostics for snapshot storage.
 * Fingerprint: "severity::relPath::check::message" — stable across runs as
 * long as the file content and check rules don't change.
 */
export function buildDiagnosticSnapshot(allResults, integrity, toRel) {
  const snapshot = new Map();

  for (const d of [...allResults.errors, ...allResults.warnings]) {
    const file = toRel(d._filePath);
    const key = `${d.severity}::${file}::${d.check}::${d.message}`;
    if (!snapshot.has(key)) {
      snapshot.set(key, { file, check: d.check, message: d.message, severity: d.severity });
    }
  }

  for (const issue of integrity) {
    const key = `${issue.severity}::${issue.source}::${issue.type}::${issue.message}`;
    if (!snapshot.has(key)) {
      snapshot.set(key, { file: issue.source, check: issue.type, message: issue.message, severity: issue.severity });
    }
  }

  return snapshot;
}

/**
 * Compare current diagnostic snapshot against session.lastAnalysis.
 * Returns null on first run (no previous data to compare).
 */
export function computeDiffFromLastRun(session, currentSnapshot, totalErrors, totalWarnings) {
  const prev = session?.lastAnalysis;
  if (!prev) return null;

  const prevKeys = prev.diagnostics;
  const newItems = [];
  const resolvedItems = [];

  for (const [key, detail] of currentSnapshot) {
    if (!prevKeys.has(key)) newItems.push(detail);
  }
  for (const [key, detail] of prevKeys) {
    if (!currentSnapshot.has(key)) resolvedItems.push(detail);
  }

  return {
    previous_run_at: prev.timestamp,
    new_errors: newItems.filter(d => d.severity === 'error'),
    resolved_errors: resolvedItems.filter(d => d.severity === 'error'),
    new_warnings: newItems.filter(d => d.severity === 'warning'),
    resolved_warnings: resolvedItems.filter(d => d.severity === 'warning'),
    error_delta: totalErrors - (prev.total_errors ?? 0),
    warning_delta: totalWarnings - (prev.total_warnings ?? 0),
  };
}
