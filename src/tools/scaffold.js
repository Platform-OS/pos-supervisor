/**
 * scaffold tool — generate production-quality platformOS file sets.
 * Auto-runs analyze_project on written .liquid files for immediate feedback.
 */

import { z } from 'zod';
import { generateScaffold } from '../core/scaffold-generator.js';
import { analyzeProjectTool } from './analyze-project.js';
import { getProjectMap } from './project-map.js';
import { ToolError } from '../core/tool-error.js';
import { CANONICAL_WORKFLOW_BLOCK } from '../core/workflow-text.js';

export const scaffoldTool = {
  name: 'scaffold',
  description: `PURPOSE:
Generate complete, production-quality platformOS file sets for new features. Templates
are derived from real production patterns — correct directory structure, doc blocks,
authorization, validation, translation keys.

${CANONICAL_WORKFLOW_BLOCK}

TYPES:
  crud    — full CRUD: schema + GraphQL + commands + queries + pages + partials + translations (~32 files)
  api     — headless CRUD: schema + GraphQL + commands + queries, no views or translations
  command — 3-file command: main + build + check + 1 GraphQL mutation
  query   — query wrapper + 1 GraphQL query
  partial — 1 partial with doc block
  page    — 1 page with front matter

PROPERTIES (REQUIRED FOR crud / api / command):
  Types that build a schema or a create mutation REQUIRE at least one non-auth
  property. Calling scaffold without properties for these types is rejected
  with an explicit error — the generator refuses to emit an empty schema or
  \`mutation create()\` (which is a GraphQL parse error).
  Example:
    { type: "crud", name: "note",
      properties: [
        { name: "title", type: "string" },
        { name: "body",  type: "text"   }
      ] }
  query / partial / page accept zero properties.`,
  inputSchema: {
    type: z.enum(['crud', 'command', 'query', 'partial', 'page', 'api']).describe('Scaffold type'),
    name: z.string().describe('Resource name in singular snake_case (e.g., "blog_post")'),
    properties: z.array(z.object({
      name: z.string().describe('Property name in snake_case'),
      type: z.enum(['string', 'text', 'integer', 'float', 'boolean', 'datetime', 'array']).describe('Property type'),
      role: z.enum(['auth']).optional().describe('auth: field is set automatically from the authenticated user (context.current_user.id). Excluded from form inputs and validation. Auto-assigned in create build command. Skipped on update. Authorization is automatically enabled when any property has role:auth.'),
    })).optional().describe('Property definitions for the resource. REQUIRED for type crud/api/command — the generator throws if you omit them or supply only role:auth fields, because the schema would be empty and the create mutation would be invalid GraphQL. Optional for query/partial/page.'),
    include_authorization: z.boolean().optional().describe('Include authorization checks in pages (requires user module). Default: false'),
    include_translations: z.boolean().optional().describe('Generate translation keys and use {{ key | t }} in templates. Default: true'),
    write: z.boolean().optional().describe('Write generated files directly to disk. Skips files that already exist (listed in conflicts/skipped). Auto-analyzes written files. Default: false'),
  },

  createHandler(ctx) {
    return async (params) => {
      try {
        const result = await generateScaffold(params, ctx.directory);

        // Clear session.pending after a successful write — files are now on disk, so
        // they are no longer "pending" and downstream tools should see real diagnostics.
        // Must run BEFORE analyze_project so the auto-analysis works on fresh state.
        if (params.write && result.written && result.written.length > 0 && ctx.session?.pending) {
          ctx.session.pending.files.clear();
          ctx.session.pending.translations.clear();
          ctx.session.pending.pages.clear();
          ctx.session.pending.planId      = null;
          ctx.session.pending.validatedAt = null;
        }

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

        // Add next_step guidance.
        //
        // Scaffold output is pre-validated and trusted — the fastest working
        // path is a single call with write:true. The dry-run branch is a
        // preview, not a gate: validate_intent is OPTIONAL here and exists
        // for agents who want to review the plan before committing.
        const consultCount = result.consult_before_writing?.length ?? 0;
        const consultStep  = consultCount > 0
          ? `Step 1 (recommended): Call domain_guide for every domain in consult_before_writing (${consultCount} domain${consultCount > 1 ? 's' : ''} listed) before writing. `
          : '';

        if (params.write && result.written?.length > 0) {
          // Post-write: files are on disk, session.pending is cleared, LSP
          // picks them up via fs-watcher. validate_intent is NOT required.
          result.next_step = 'Files written to disk. Project map refreshed and session.pending cleared. validate_intent is NOT required for this scaffold — files are on disk and indexed by the LSP. Call validate_code only if you make manual edits afterwards.';
        } else if (result.conflicts?.length > 0) {
          result.next_step =
            `${consultStep}` +
            `${result.conflicts.length} conflict(s) detected — existing files will NOT be overwritten. ` +
            `Remove the conflicting paths and call scaffold again with write: true, or (optional) ` +
            `call validate_intent with { scaffold_output: <this result> } to review a plan that ` +
            `reconciles the conflicts before committing.`;
        } else {
          result.next_step =
            `${consultStep}` +
            `Preview only. Call scaffold again with the same arguments and write: true to commit; ` +
            `validate_intent is optional for review.`;
        }

        return result;
      } catch (e) {
        throw e instanceof ToolError ? e : new ToolError(e.message);
      }
    };
  },
};
