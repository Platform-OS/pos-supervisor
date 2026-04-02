/**
 * scaffold tool — generate production-quality platformOS file sets.
 * Auto-runs analyze_project on written .liquid files for immediate feedback.
 */

import { generateScaffold } from '../core/scaffold-generator.js';
import { analyzeProjectTool } from './analyze-project.js';
import { getProjectMap } from './project-map.js';

export const scaffoldTool = {
  name: 'scaffold',
  description: [
    'PURPOSE:',
    'Generate complete, production-quality platformOS file sets for new features. Templates',
    'are derived from real production patterns — correct directory structure, doc blocks,',
    'authorization, validation, translation keys.',
    '',
    'REQUIRED WORKFLOW:',
    '1. Call project_map first — understand what already exists and avoid conflicts.',
    '2. Call scaffold with write=false to review generated files.',
    '3. Call validate_intent with the scaffold_output to verify cross-references and policy.',
    '4. If validate_intent returns ok:true, call scaffold again with write=true.',
    '   When write=true: files are written, analyze_project runs automatically on .liquid files,',
    '   and a refreshed project_map is returned — no need to call project_map again.',
    '5. Use the returned pending_files in every validate_code call during manual drafting.',
    '',
    'TYPES:',
    '  crud    — full CRUD: schema + GraphQL + commands + queries + pages + partials + translations (~32 files)',
    '  api     — headless CRUD: schema + GraphQL + commands + queries, no views or translations',
    '  command — 3-file command: main + build + check + 1 GraphQL mutation',
    '  query   — query wrapper + 1 GraphQL query',
    '  partial — 1 partial with doc block',
    '  page    — 1 page with front matter',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['crud', 'command', 'query', 'partial', 'page', 'api'],
        description: 'Scaffold type',
      },
      name: {
        type: 'string',
        description: 'Resource name in singular snake_case (e.g., "blog_post")',
      },
      properties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Property name in snake_case' },
            type: {
              type: 'string',
              enum: ['string', 'text', 'integer', 'float', 'boolean', 'datetime', 'array'],
              description: 'Property type',
            },
            role: {
              type: 'string',
              enum: ['auth'],
              description: 'auth: field is set automatically from the authenticated user (context.current_user.id). Excluded from form inputs and validation. Auto-assigned in create build command. Skipped on update. Authorization is automatically enabled when any property has role:auth.',
            },
          },
          required: ['name', 'type'],
        },
        description: 'Property definitions for the resource',
      },
      include_authorization: {
        type: 'boolean',
        description: 'Include authorization checks in pages (requires user module). Default: false',
      },
      include_translations: {
        type: 'boolean',
        description: 'Generate translation keys and use {{ key | t }} in templates. Default: true',
      },
      write: {
        type: 'boolean',
        description: 'Write generated files directly to disk. Skips files that already exist (listed in conflicts/skipped). Auto-analyzes written files. Default: false',
      },
    },
    required: ['type', 'name'],
  },

  createHandler(ctx) {
    return async (params) => {
      try {
        const result = await generateScaffold(params, ctx.directory);

        // Auto-analyze written .liquid files and refresh project_map after write
        if (params.write && result.written && result.written.length > 0) {
          // analyze_project on written .liquid files for immediate diagnostic feedback
          const liquidFiles = result.written.filter(f => f.endsWith('.liquid'));
          if (liquidFiles.length > 0) {
            try {
              const analyzeHandler = analyzeProjectTool.createHandler(ctx);
              const analysis = await analyzeHandler({ files: liquidFiles });
              result.analysis = {
                total_errors: analysis.total_errors || 0,
                total_warnings: analysis.total_warnings || 0,
                files_with_issues: analysis.files || [],
              };
            } catch {
              // Analysis is best-effort — don't fail the scaffold
              result.analysis = { error: 'Analysis unavailable' };
            }
          }

          // Refresh project_map — new files are on disk, cache is stale
          try {
            result.project_map = await getProjectMap(ctx.directory, { forceRefresh: true });
          } catch {
            // Best-effort — agent can call project_map manually if needed
          }
        }

        // Add next_step guidance
        if (params.write && result.written?.length > 0) {
          result.next_step = 'Files written to disk. Project map refreshed. Proceed to validate_code on each file if making manual edits.';
        } else if (result.conflicts?.length > 0) {
          result.next_step = `${result.conflicts.length} conflict(s) detected — existing files will NOT be overwritten. Call validate_intent with { scaffold_output: <this result> } to review, then scaffold again with write: true.`;
        } else {
          result.next_step = 'MUST: Call validate_intent with { scaffold_output: <this result> } before writing any files. MUST NOT: Write files to disk without validation.';
        }

        return result;
      } catch (e) {
        return { error: e.message };
      }
    };
  },
};
