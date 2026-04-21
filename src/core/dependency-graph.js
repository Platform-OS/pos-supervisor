/**
 * Dependency graph builder.
 *
 * Takes a scanned project map and returns a graph of file-level edges:
 *
 *   {
 *     'app/views/pages/blog_posts/index.html.liquid': {
 *       depends_on:   [ 'app/views/partials/blog_posts/index.liquid', ... ],
 *       referenced_by: [],
 *     },
 *     'app/views/partials/blog_posts/form.liquid': {
 *       depends_on:   [],
 *       referenced_by: [ 'app/views/partials/blog_posts/new.liquid', ... ],
 *     },
 *     ...
 *   }
 *
 * Edges come from four sources in a Liquid project:
 *   1. {% render 'partial' %}               — page/partial → partial
 *   2. {% function _ = 'commands/x/y' %}    — page/partial/command → command/query
 *   3. {% graphql res = 'x/y' %}            — command/query → graphql file
 *   4. render in frontmatter / layout refs  — page → partial
 *
 * The LSP also exposes appGraph/references and appGraph/dependencies — we
 * prefer LSP results when available because they include edges the project
 * scanner cannot see (dynamic render names, etc.). When LSP results are empty
 * (LSP not warmed for the file, method unsupported, etc.) we fall back to the
 * project_map-derived graph. Merging is per-edge, not per-file, so a file
 * can have LSP-sourced depends_on and project-map-sourced referenced_by.
 *
 * NOTE on paths: every edge target is a canonical repo-relative path
 * (app/views/partials/x.liquid, app/lib/commands/x/y.liquid, app/graphql/x/y.graphql).
 * Module references (`modules/<name>/...`) are resolved to the module file
 * path under modules/ so consumers can still walk them — they just won't
 * appear in the internal project's file list.
 */

import { isSubphaseFile } from './orphan-detector.js';

// ── Path resolvers ──────────────────────────────────────────────────────────

/**
 * Resolve a {% render %} name to the canonical partial path.
 *
 * Honors relative names by resolving against the caller's directory under
 * app/views/partials/. A partial at app/views/partials/blog_posts/new.liquid
 * that does {% render 'form' %} resolves to 'blog_posts/form', matching the
 * key the scanner stores (Phase 2.3).
 *
 * @param {string} name        - render target as written in Liquid
 * @param {object} projectMap
 * @param {string} [callerPath] - optional caller file path for relative resolution
 * @returns {string} absolute repo-relative path
 */
export function resolveRenderTarget(name, projectMap, callerPath) {
  if (!name) return null;
  if (name.startsWith('modules/')) return `modules/${name.replace(/^modules\//, '')}.liquid`;

  // Resolve relative names against the caller's partial directory.
  const resolved = resolveRelativeRenderName(callerPath, name);

  // If projectMap knows this partial under the resolved key, use its canonical path.
  const partial = projectMap?.partials?.[resolved];
  if (partial?.path) return partial.path;

  // Fallback: assume the standard location. May produce a non-existent path
  // when the render name is wrong — orphan detection treats that as an
  // edge into a missing file, which surfaces as broken_render from the
  // existing integrity checks.
  return `app/views/partials/${resolved}.liquid`;
}

/**
 * Minimal in-module copy of project-scanner's resolveRenderName, duplicated
 * here to avoid a circular import (dependency-graph.js is imported BY
 * project-scanner consumers). Keep the two implementations in sync.
 */
function resolveRelativeRenderName(callerRelPath, renderName) {
  if (!renderName) return renderName;
  if (renderName.includes('/')) return renderName;
  if (!callerRelPath) return renderName;

  const partialsPrefix = 'app/views/partials/';
  if (!callerRelPath.startsWith(partialsPrefix)) return renderName;

  const relUnderPartials = callerRelPath
    .slice(partialsPrefix.length)
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
  const slashIdx = relUnderPartials.lastIndexOf('/');
  if (slashIdx < 0) return renderName;
  const dir = relUnderPartials.slice(0, slashIdx);
  return `${dir}/${renderName}`;
}

/**
 * Resolve a {% function _ = 'path' %} call path to its on-disk file.
 * Commands and queries live under app/lib/ with a .liquid extension.
 */
export function resolveFunctionTarget(fcPath) {
  if (!fcPath) return null;
  if (fcPath.startsWith('modules/')) return `modules/${fcPath.replace(/^modules\//, '')}.liquid`;
  return `app/lib/${fcPath}.liquid`;
}

/**
 * Resolve a {% graphql %} operation name to its on-disk file.
 */
export function resolveGraphqlTarget(opName) {
  if (!opName) return null;
  if (opName.startsWith('modules/')) return `modules/${opName.replace(/^modules\//, '')}.graphql`;
  return `app/graphql/${opName}.graphql`;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Build a file-level dependency graph from a project_map scan and an optional
 * LSP-derived graph (as returned by analyze_project's LSP call).
 *
 * @param {object} projectMap - as returned by scanProject
 * @param {Record<string, { depends_on: string[], referenced_by: string[] }>} [lspResults]
 * @returns {Record<string, { depends_on: string[], referenced_by: string[] }>}
 */
export function buildDependencyGraph(projectMap, lspResults = {}) {
  const graph = {};

  // Seed every known file with empty arrays so the result is dense — agents
  // reading the graph don't have to guard against missing keys.
  const seed = (path) => {
    if (!path) return;
    if (!graph[path]) graph[path] = { depends_on: [], referenced_by: [] };
  };
  for (const page    of Object.values(projectMap.pages    ?? {})) seed(page.path);
  for (const partial of Object.values(projectMap.partials ?? {})) seed(partial.path);
  for (const layout  of Object.values(projectMap.layouts  ?? {})) seed(layout.path);
  for (const cmd     of Object.keys(projectMap.commands   ?? {})) seed(cmd);
  for (const q       of Object.keys(projectMap.queries    ?? {})) seed(q);
  for (const g       of Object.keys(projectMap.graphql    ?? {})) seed(`app/graphql/${g}.graphql`);

  const addEdge = (source, target) => {
    if (!source || !target) return;
    seed(source);
    seed(target);
    if (!graph[source].depends_on.includes(target)) graph[source].depends_on.push(target);
    if (!graph[target].referenced_by.includes(source)) graph[target].referenced_by.push(source);
  };

  // ── 1. Walk pages (render/function edges + layout reference) ──
  const layoutsByName = {};
  for (const layout of Object.values(projectMap.layouts ?? {})) {
    if (!layout?.path) continue;
    const name = layout.path
      .replace(/^app\/views\/layouts\//, '')
      .replace(/\.html\.liquid$/, '')
      .replace(/\.liquid$/, '');
    layoutsByName[name] = layout.path;
  }

  for (const page of Object.values(projectMap.pages ?? {})) {
    if (!page?.path) continue;
    for (const r of page.renders ?? []) {
      addEdge(page.path, resolveRenderTarget(r, projectMap, page.path));
    }
    for (const fc of page.function_calls ?? []) {
      addEdge(page.path, resolveFunctionTarget(fc.path));
    }
    if (page.layout) {
      const layoutPath = layoutsByName[page.layout];
      if (layoutPath) addEdge(page.path, layoutPath);
    }
  }

  // ── 2. Walk layouts (render/function edges) ──
  for (const layout of Object.values(projectMap.layouts ?? {})) {
    if (!layout?.path) continue;
    for (const r of layout.renders ?? []) {
      addEdge(layout.path, resolveRenderTarget(r, projectMap, layout.path));
    }
    for (const fc of layout.function_calls ?? []) {
      addEdge(layout.path, resolveFunctionTarget(fc.path));
    }
  }

  // ── 3. Walk partials ──
  for (const partial of Object.values(projectMap.partials ?? {})) {
    if (!partial?.path) continue;
    for (const r of partial.renders ?? []) {
      addEdge(partial.path, resolveRenderTarget(r, projectMap, partial.path));
    }
    for (const fc of partial.function_calls ?? []) {
      addEdge(partial.path, resolveFunctionTarget(fc.path));
    }
  }

  // ── 4. Walk commands ──
  // Commands can call sub-commands (build/check phases) via {% function %}
  // and call GraphQL ops via {% graphql %}.
  for (const [cmdPath, cmd] of Object.entries(projectMap.commands ?? {})) {
    for (const fc of cmd.function_calls ?? []) {
      addEdge(cmdPath, resolveFunctionTarget(fc.path));
    }
    for (const g of cmd.graphql_calls ?? []) {
      const opName = typeof g === 'string' ? g : g?.queryName;
      addEdge(cmdPath, resolveGraphqlTarget(opName));
    }
  }

  // ── 5. Walk queries ──
  for (const [qPath, q] of Object.entries(projectMap.queries ?? {})) {
    for (const fc of q.function_calls ?? []) {
      addEdge(qPath, resolveFunctionTarget(fc.path));
    }
    for (const g of q.graphql_calls ?? []) {
      const opName = typeof g === 'string' ? g : g?.queryName;
      addEdge(qPath, resolveGraphqlTarget(opName));
    }
  }

  // ── 6. Merge LSP-derived edges on top ──
  // LSP wins per edge — we union its arrays into ours. The LSP may know about
  // dynamic render names the scanner cannot see.
  for (const [path, lspEntry] of Object.entries(lspResults)) {
    if (!lspEntry) continue;
    seed(path);
    for (const dep of lspEntry.depends_on ?? []) {
      const rel = stripFilePrefix(dep);
      if (rel && !graph[path].depends_on.includes(rel)) {
        graph[path].depends_on.push(rel);
        // Mirror the reverse edge so the graph stays consistent.
        seed(rel);
        if (!graph[rel].referenced_by.includes(path)) graph[rel].referenced_by.push(path);
      }
    }
    for (const ref of lspEntry.referenced_by ?? []) {
      const rel = stripFilePrefix(ref);
      if (rel && !graph[path].referenced_by.includes(rel)) {
        graph[path].referenced_by.push(rel);
        seed(rel);
        if (!graph[rel].depends_on.includes(path)) graph[rel].depends_on.push(path);
      }
    }
  }

  return graph;
}

/**
 * LSP appGraph/* responses return absolute file:// URIs. The analyze_project
 * code already strips `file://`, but sometimes hands us absolute paths. We
 * cannot know the project root here, so we trust the caller has already
 * stripped it where possible and just remove a leading `file://` prefix.
 */
function stripFilePrefix(uri) {
  if (typeof uri !== 'string') return null;
  if (uri.startsWith('file://')) return uri.slice('file://'.length);
  return uri;
}

// ── Orphaned file detection ──────────────────────────────────────────────────

/**
 * Find files that nothing in the project references. A file is orphaned when
 * its `referenced_by` is empty AND the file is not an entry point.
 *
 * Entry points (never orphaned):
 *   - All pages (users reach them via HTTP routes).
 *   - Files whose path contains /build/, /check/, or /execute/ — these are
 *     phase files of multi-phase commands. Even when a parent command does
 *     not wire them explicitly, they are called by convention at runtime and
 *     MUST NOT be flagged.
 *   - Translation files and GraphQL files (covered elsewhere).
 *
 * Every other file gets scored.
 *
 * @param {Record<string, { depends_on: string[], referenced_by: string[] }>} graph
 * @param {object} projectMap - for entry-point classification (pages, etc.)
 * @returns {string[]} orphaned file paths
 */
export function detectOrphanedFiles(graph, projectMap) {
  const dead = [];
  const pagePaths = new Set(
    Object.values(projectMap.pages ?? {}).map(p => p.path).filter(Boolean)
  );
  const layoutPaths = new Set(
    Object.values(projectMap.layouts ?? {}).map(l => l.path).filter(Boolean)
  );

  for (const [path, edges] of Object.entries(graph)) {
    if ((edges.referenced_by ?? []).length > 0) continue;

    // Pages are always live — they are HTTP entry points.
    if (pagePaths.has(path)) continue;

    // Layouts are infrastructure — even unreferenced layouts may be used
    // by pages via the default layout convention. If a layout IS referenced
    // by pages (via page → layout edges) it won't reach here. If it's truly
    // unused, it still shouldn't be auto-flagged: layout selection happens
    // at runtime via frontmatter and the default layout fallback.
    if (layoutPaths.has(path)) continue;

    // Subphase command files are live by convention.
    if (isSubphaseFile(path)) continue;

    // GraphQL files: flagged elsewhere by the integrity check for orphaned ops.
    if (path.endsWith('.graphql')) continue;

    // Translation files: structural errors are surfaced by translation-validator;
    // they are never rendered by liquid files so they have no referenced_by edges.
    if (path.startsWith('app/translations/')) continue;

    // Anything outside app/ is assumed external (module fallback path) and skipped.
    if (!path.startsWith('app/')) continue;

    dead.push(path);
  }

  return dead.sort();
}
