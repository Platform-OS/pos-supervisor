/**
 * project_map tool — returns structured JSON project index.
 */

import { z } from 'zod';
import { scanProject, scanAround } from '../core/project-scanner.js';
import { sanitizePath } from '../core/utils.js';
import { ToolError } from '../core/tool-error.js';
import { PROJECT_MAP_CACHE_TTL_MS } from '../core/constants.js';
let _cache = null;
let _cacheTime = 0;

export const projectMapTool = {
  name: 'project_map',
  description: `PURPOSE:
Returns a structured JSON index of the platformOS project: schemas with property details,
GraphQL operations with args, commands, queries, pages, partials with reverse-index,
translations, and per-resource CRUD completeness.
You MUST run project_map with force_refresh: true after creating new commands, otherwise the LSP may has stale/cached state.

MANDATE (NON-NEGOTIABLE):
Call this tool ONCE at the very start of every session before using scaffold, validate_intent,
or writing any file. Without it the agent operates blind — no knowledge of what exists,
what is missing, or what would conflict.
SKIPPING THIS STEP = high risk of duplicate files, broken references, incomplete CRUD.

WHEN ELSE TO CALL:
  - scope "around" + a file path: when you need to understand dependencies of one specific file
    without a full rescan (faster, focused).
  - force_refresh: true after scaffold write=true, or after any batch of file writes,
    to get an up-to-date view (scaffold returns a refreshed project_map automatically).`,
  inputSchema: {
    scope: z.enum(['full', 'around']).optional().describe('Scan scope: "full" scans the entire project, "around" scans only files connected to the given path. Default: full'),
    path: z.string().optional().describe('File path for "around" scope (relative to project root)'),
    force_refresh: z.boolean().optional().describe('Force a fresh scan, ignoring the 30-second cache. Default: false'),
  },

  createHandler(ctx) {
    return async (params) => {
      const { scope = 'full', path, force_refresh = false } = params;

      if (scope === 'around') {
        if (!path) {
          throw new ToolError('path is required for "around" scope');
        }
        let absPath;
        try {
          absPath = sanitizePath(ctx.directory, path);
        } catch (e) {
          throw new ToolError(e.message);
        }
        return scanAround(ctx.directory, absPath);
      }

      // Full scope with caching
      const now = Date.now();
      if (!force_refresh && _cache && (now - _cacheTime) < PROJECT_MAP_CACHE_TTL_MS) {
        return _cache;
      }

      const result = await scanProject(ctx.directory);
      _cache = result;
      _cacheTime = Date.now();
      return result;
    };
  },
};

/**
 * Shared cache accessor for validate_intent and other tools that need
 * the project map without going through the MCP tool layer.
 *
 * @param {string} projectDir
 * @param {{ forceRefresh?: boolean }} [options]
 */
export async function getProjectMap(projectDir, { forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && _cache && (now - _cacheTime) < PROJECT_MAP_CACHE_TTL_MS) return _cache;
  const result = await scanProject(projectDir);
  _cache = result;
  _cacheTime = Date.now();
  return result;
}

/**
 * Reset the cached project map so the next `getProjectMap` call does a fresh
 * scan. Called by the fs-watcher whenever a dependency-graph-relevant file
 * changes on disk so cross-file tools (analyze_project, validate_code's
 * caller lookup) always see current state.
 */
export function invalidateProjectMap() {
  _cache = null;
  _cacheTime = 0;
}
