/**
 * validate_intent tool — structural plan validation before any file is drafted.
 *
 * Track A: { scaffold_output: <scaffold result> } — runs layers 3+4
 * Track B: { intent: <intent object> }            — runs all 4 layers
 * Track B also accepts a bare intent object (backwards-compatible).
 */

import { z } from 'zod';
import { validateIntent } from '../core/intent-validator.js';
import { CANONICAL_WORKFLOW_BLOCK } from '../core/workflow-text.js';

export const validateIntentTool = {
  name: 'validate_intent',
  description: `PURPOSE:
Validate a plan before any file is drafted. Catches architectural errors (wrong directory,
missing prerequisites, broken cross-references, policy violations) before any code exists.
Returns pending_files/pending_translations that suppress false positives in validate_code.

TWO MODES — the response's write_directly flag tells you which workflow to follow:

  1. REVIEW SCAFFOLD (mode 1, scaffold_output): OPTIONAL pre-write review of a scaffold
     dry-run (write:false) result. Runs project-state and policy layers against the
     generated file set. On success → write_directly:true → call scaffold again with
     write:true to commit. Do NOT hand-write scaffold files and do NOT call validate_code
     on them; scaffold templates are the contract, re-linting them produces false-positive
     loops. NOT required — scaffold(write:true) is the default path; use mode 1 only for
     a second look before committing.

  2. MANUAL PLAN (mode 2, intent): REQUIRED before writing hand-drafted file batches.
     Declares paths/roles/refs for files you will author by hand. On success
     → write_directly:false → you still owe a validate_code pass on the full content of
     each file BEFORE writing it. session.pending is merged automatically so downstream
     validate_code calls suppress cross-ref noise for files in this plan.

${CANONICAL_WORKFLOW_BLOCK}

REQUIRED PREPARATION (MUST, mode 2 only):
  You MUST call domain_guide(domain) for every domain in your manual plan BEFORE calling
  validate_intent. If you have not already called domain_guide for a domain in this
  session, call it now. validate_intent checks against the same rules domain_guide
  teaches — consulting it first means fewer failures here and fewer validate_code
  failures later.
  MUST NOT: call validate_intent without having consulted domain_guide for each
  relevant domain. A plan drafted without domain context is almost always wrong.
  (Mode 1 is exempt — the scaffold generator already embeds the domain rules.)

REQUIRED PROCEDURE:
1. Call validate_intent — mode 1 (optional review of scaffold dry-run output), or mode 2
   (required for hand-drafted batches).
2. If ok:false — read errors[].suggestion and allowed_next_actions, fix, re-call.
3. If ok:true + write_directly:true — call scaffold again with write:true to commit. Do
   NOT hand-write the scaffold files; let scaffold write them so session.pending clears
   and the LSP re-indexes. You are DONE for the scaffold batch after the write:true call.
4. If ok:true + write_directly:false — draft each file, call validate_code on the full
   content, fix findings, then write.
5. If you add a file not in the validated plan — re-call validate_intent with the
   updated plan before writing it (scope drift enforcement).

Manual intent example (mode 2):
  {
    "intent": {
      "goal": "Create blog post listing page with search",
      "changes": [
        {
          "path": "app/views/pages/blog_posts/index.html.liquid",
          "role": "page",
          "action": "create",
          "references": {
            "partials": ["blog_posts/list"],
            "queries":  ["app/lib/queries/blog_posts/search.liquid"]
          }
        },
        {
          "path": "app/views/partials/blog_posts/list.liquid",
          "role": "partial",
          "action": "create"
        },
        {
          "path": "app/lib/queries/blog_posts/search.liquid",
          "role": "query",
          "action": "create",
          "references": { "graphql": ["blog_posts/search"] }
        }
      ]
    }
  }

IMPORTANT: changes must be a JSON array of objects — never a JSON-encoded string.
IMPORTANT: references is optional per change but should be populated — it is used to verify
  that all partials/graphql/schemas/queries referenced actually exist or are in this plan.`,
  inputSchema: {
    scaffold_output: z.preprocess(
      (val) => {
        // Agents using the MCP stdio transport receive tool results as JSON-encoded text.
        // Accept a JSON string and parse it so the agent can pass scaffold output directly.
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch { return val; }
        }
        return val;
      },
      z.object({
        files: z.array(z.object({
          path: z.string(),
          content: z.string().optional(),
          domain: z.string(),
        })),
        creation_order: z.array(z.string()).optional(),
        conflicts: z.array(z.object({
          path: z.string(),
          reason: z.string(),
        })).optional(),
        summary: z.string().optional(),
      }).optional()
    ).describe('Mode 1: pass the complete result object returned by the scaffold tool. Runs project-state checks (cross-references with existing project) and policy checks. Schema/domain checks are skipped — scaffold already generates correct paths.'),
    intent: z.object({
      goal: z.string().describe('What this change is trying to accomplish, in plain language.'),
      changes: z.array(z.object({
        path: z.string().describe('File path relative to project root. Must match the required pattern for the role.'),
        role: z.enum(['page', 'layout', 'partial', 'graphql', 'schema', 'command', 'query', 'translation', 'lib', 'asset', 'config', 'migration', 'module_override']).describe(
          `File role — determines the required directory and extension:
  page:        app/views/pages/<name>.html.liquid
  layout:      app/views/layouts/<name>.liquid
  partial:     app/views/partials/<name>.liquid
  graphql:     app/graphql/<name>.graphql
  schema:      app/schema/<name>.yml
  command:     app/lib/commands/<name>.liquid
  query:       app/lib/queries/<name>.liquid
  translation: app/translations/<locale>.yml
  lib:         app/lib/<name>.liquid (not under commands/ or queries/)
  asset:           app/assets/<subdir>/<filename>  (CSS, JS, images)
  config:          app/config.yml
  migration:       app/migrations/<timestamp>_<name>.liquid
  module_override: app/modules/<module>/public/<path> or app/modules/<module>/private/<path>
                   Use for overriding installed module files (e.g. permissions.liquid).
                   Distinct from bare modules/ paths which are read-only third-party code.`
        ),
        action: z.enum(['create', 'update', 'delete', 'move']).describe('Operation: create (new file), update (modify existing), delete (remove), move (rename/relocate — also provide move_to).'),
        move_to: z.string().optional().describe('Destination path — required when action is "move".'),
        references: z.object({
          partials: z.array(z.string()).optional().describe('Partial names rendered by this file (e.g., "blog_posts/form"). Strip app/views/partials/ prefix and .liquid extension.'),
          graphql: z.array(z.string()).optional().describe('GraphQL operation names used (e.g., "blog_posts/search"). Strip app/graphql/ prefix and .graphql extension.'),
          schemas: z.array(z.string()).optional().describe('Schema table names referenced (e.g., "blog_post"). Strip app/schema/ prefix and .yml extension.'),
          translations: z.array(z.string()).optional().describe('Translation keys used in dot notation (e.g., "app.blog_posts.list.title").'),
          commands: z.array(z.string()).optional().describe('Full relative paths of commands called by this file (e.g., "app/lib/commands/blog_posts/create.liquid").'),
          queries: z.array(z.string()).optional().describe('Full relative paths of queries called by this file (e.g., "app/lib/queries/blog_posts/search.liquid").'),
        }).optional().describe('Optional but important: list files and resources this change depends on. Used to verify they exist in the project or are being created in this same plan.'),
      })).describe('Array of file operations. Must be a JSON array — not a string. Each item describes one file: its path, role, action, and optional references to other files it depends on.'),
    }).optional().describe('Mode 2: manually declared plan for hand-written files. Runs all validation layers: schema correctness, path/role rules, cross-reference with existing project, and architecture policy.'),
  },

  createHandler(ctx) {
    return async (params) => {
      try {
        const result = await validateIntent(params, ctx.directory);

        // On success, overwrite session.pending with this plan's pending state.
        // Every successful validation is authoritative — the latest plan wins.
        // This is what downstream tools (validate_code, analyze_project) read so
        // the agent does not have to re-pass pending_* on every call.
        if (result?.ok && ctx.session?.pending) {
          ctx.session.pending.files         = new Set(result.pending_files ?? []);
          ctx.session.pending.translations  = new Set(result.pending_translations ?? []);
          ctx.session.pending.pages         = new Set(extractPendingPages(result.pending_files ?? []));
          ctx.session.pending.planId        = result.plan_id ?? null;
          ctx.session.pending.validatedAt   = result.validated_at ?? new Date().toISOString();
          ctx.session.pending.writeDirectly = result.write_directly === true;
        }

        return result;
      } catch (e) {
        return {
          ok: false,
          error_count: 1,
          warning_count: 0,
          errors: [{
            layer: 'internal',
            type: 'internal_error',
            message: `validate_intent failed: ${e.message}`,
          }],
          warnings: [],
          allowed_next_actions: [],
        };
      }
    };
  },
};

/**
 * Filter pending_files down to page paths. Pages are already in pending_files (they
 * are just files), but the diagnostic pipeline's MissingPage suppression matches by
 * slug/path differently from MissingPartial, so we extract the page subset.
 */
function extractPendingPages(pendingFiles) {
  return pendingFiles.filter(f => /^app\/views\/pages\/.+\.(html\.liquid|liquid)$/.test(f));
}
