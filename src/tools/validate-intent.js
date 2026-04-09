/**
 * validate_intent tool — structural plan validation before any file is drafted.
 *
 * Track A: { scaffold_output: <scaffold result> } — runs layers 3+4
 * Track B: { intent: <intent object> }            — runs all 4 layers
 * Track B also accepts a bare intent object (backwards-compatible).
 */

import { z } from 'zod';
import { validateIntent } from '../core/intent-validator.js';

export const validateIntentTool = {
  name: 'validate_intent',
  description: `PURPOSE:
Validate a plan before any file is drafted. Catches architectural errors (wrong directory,
missing prerequisites, broken cross-references, policy violations) before any code exists.
Returns pending_files/pending_translations that feed directly into validate_code.

MANDATE (NON-NEGOTIABLE):
Call this tool BEFORE drafting any file — either after scaffold or after declaring a manual plan.
SKIPPING THIS STEP = undetected cross-file inconsistencies that only surface after multiple writes.

Two calling modes:
  1. After scaffold — pass the scaffold result directly: { scaffold_output: <scaffold result> }
  2. Manual plan   — declare your intent explicitly:    { intent: { goal, changes[] } }

RECOMMENDED PREPARATION:
  For best results, call domain_guide for each role in your plan (pages, partials, commands, etc.)
  and module_info for any modules you reference. This gives you the rules validate_intent checks against.

REQUIRED PROCEDURE:
1. Call validate_intent (either mode).
2. If ok:false — read errors[].suggestion and allowed_next_actions, fix the plan, re-call.
3. If ok:true  — use pending_files as the pending_files parameter in every validate_code call.
4. If you add a file not in the validated plan — re-call validate_intent with the updated plan
   before writing it (scope drift enforcement).

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
        return await validateIntent(params, ctx.directory);
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
