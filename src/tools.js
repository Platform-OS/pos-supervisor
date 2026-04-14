import { z } from 'zod';
import { validateCodeTool } from './tools/validate-code.js';
import { enrichErrorTool } from './tools/enrich-error.js';
import { domainGuideTool } from './tools/domain-guide.js';
import { analyzeProjectTool } from './tools/analyze-project.js';
import { lookupTool } from './tools/lookup.js';
import { serverStatusTool } from './tools/server-status.js';
import { projectMapTool } from './tools/project-map.js';
import { scaffoldTool } from './tools/scaffold.js';
import { moduleInfoTool } from './tools/module-info.js';
import { validateIntentTool } from './tools/validate-intent.js';
import { loadDevelopmentGuideTool } from './tools/load-development-guide.js';

/**
 * All available MCP tools with their definitions and handler factories.
 */
const TOOL_DEFS = [
  validateCodeTool,
  enrichErrorTool,
  domainGuideTool,
  analyzeProjectTool,
  lookupTool,
  serverStatusTool,
  projectMapTool,
  scaffoldTool,
  moduleInfoTool,
  validateIntentTool,
  loadDevelopmentGuideTool,
];

/**
 * Convert a Zod shape (ZodRawShape) to JSON Schema for MCP protocol.
 * Returns the full JSON Schema object with type: 'object'.
 *
 * Uses Zod v4's native `z.toJSONSchema()` (shipped with zod 4.x). The
 * external `zod-to-json-schema@3.x` package does NOT handle Zod v4 schemas
 * and silently returns `{}` — that bug previously erased every tool's
 * inputSchema from the HTTP `/tools` response, leaving clients blind to
 * required parameters (e.g. scaffold's `properties` field).
 */
function zodShapeToJsonSchema(shape) {
  if (!shape || Object.keys(shape).length === 0) {
    return { type: 'object', properties: {} };
  }
  const schema = z.toJSONSchema(z.object(shape));
  // toJSONSchema tags its output with $schema — MCP clients don't need that.
  delete schema.$schema;
  // additionalProperties:false is valid JSON Schema but breaks some clients
  // that treat unknown fields as errors when the agent sends extras.
  delete schema.additionalProperties;
  return schema;
}

/**
 * Build tool registry: Map<name, { definition, handler }>
 *
 * The registry is the source of truth for both MCP (stdio) and HTTP dispatch.
 * - `definition` uses JSON Schema (converted from Zod) for protocol compatibility
 * - `handler` is wrapped with telemetry and session tracking
 *
 * If an McpServer instance is provided, tools are also registered on it
 * via registerTool() for the official MCP SDK stdio transport.
 */
export function createToolRegistry(ctx, mcpServer = null) {
  const registry = new Map();

  for (const tool of TOOL_DEFS) {
    const rawHandler = tool.createHandler(ctx);

    // Wrap handler with timing telemetry + session tracking
    const timedHandler = async (args) => {
      const start = Date.now();
      let success = true;
      try {
        const result = await rawHandler(args);
        const durationMs = Date.now() - start;
        ctx.emit?.('tool_call', { tool: tool.name, durationMs, success, input: args, output: result });

        // Session tracking (non-blocking, best-effort)
        try { updateSession(ctx.session, tool.name, args, result); } catch (e) { ctx.log?.(`Session tracking error: ${e.message}`); }

        // Tool avoidance detection: if there's a validated plan with unvalidated files
        // and the agent is calling tools other than validation, add an advisory note
        try {
          if (ctx.session?.validatedPlan && typeof result === 'object' && result !== null) {
            const EXEMPT = new Set(['validate_code', 'validate_intent', 'server_status', 'project_map', 'enrich_error', 'lookup']);
            if (!EXEMPT.has(tool.name)) {
              const plan = ctx.session.validatedPlan;
              const unvalidated = [...plan.pendingFiles].filter(f => !plan.validatedFiles.has(f));
              if (unvalidated.length > 0) {
                result._supervision_note = `${unvalidated.length} of ${plan.pendingFiles.size} planned file(s) not yet validated: ${unvalidated.slice(0, 3).join(', ')}${unvalidated.length > 3 ? '...' : ''}. MUST validate files with validate_code before writing.`;
              }
            }
          }
        } catch (e) { ctx.log?.(`Supervision note error: ${e.message}`); }

        return result;
      } catch (e) {
        success = false;
        const durationMs = Date.now() - start;
        ctx.emit?.('tool_call', { tool: tool.name, durationMs, success, input: args, error: e.message });
        throw e;
      }
    };

    // Convert Zod shape to JSON Schema for registry definition
    const jsonSchema = zodShapeToJsonSchema(tool.inputSchema);

    registry.set(tool.name, {
      definition: {
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema,
      },
      handler: timedHandler,
    });

    // Register on McpServer for SDK-managed stdio transport
    if (mcpServer) {
      const inputSchema = tool.inputSchema;
      mcpServer.tool(
        tool.name,
        tool.description,
        // Pass Zod shape if tool has parameters, omit for parameterless tools
        ...(Object.keys(inputSchema).length > 0 ? [inputSchema] : []),
        async (args) => {
          try {
            const result = await timedHandler(args);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          } catch (e) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true };
          }
        }
      );
    }
  }

  return registry;
}

/**
 * Get tool list in MCP format (JSON Schema).
 */
export function getToolList(registry) {
  return [...registry.values()].map(t => t.definition);
}

/**
 * Dispatch a tool call.
 */
export async function dispatchTool(registry, name, args) {
  const tool = registry.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}. Available: ${[...registry.keys()].join(', ')}`);
  }
  return tool.handler(args ?? {});
}

/**
 * Update session state after a tool call. Called from the dispatch wrapper.
 * Must never throw — all session tracking is best-effort.
 */
function updateSession(session, toolName, args, result) {
  if (!session) return;

  // Track validated plans
  if (toolName === 'validate_intent' && result?.ok === true) {
    const files = new Set(result.pending_files ?? []);
    // Scaffold-generated files are valid by construction — pre-mark them as validated.
    // Only manually-declared intent leaves validatedFiles empty (those need explicit validate_code).
    const preValidated = args?.scaffold_output ? new Set(files) : new Set();
    session.validatedPlan = {
      planId: result.plan_id,
      pendingFiles: files,
      validatedFiles: preValidated,
      source: args?.scaffold_output ? 'scaffold' : 'manual',
    };
  }

  // Track per-file validation history
  if (toolName === 'validate_code' && args?.file_path) {
    const fp           = args.file_path;
    const errorCount   = result?.errors?.length   ?? 0;
    const warningCount = result?.warnings?.length ?? 0;
    const prev = session.fileHistory.get(fp);

    if (prev) {
      prev.calls++;
      if (errorCount >= prev.lastErrorCount && prev.lastErrorCount > 0) {
        prev.consecutiveNonDecreasing++;
      } else {
        prev.consecutiveNonDecreasing = 0;
      }
      prev.lastErrorCount   = errorCount;
      prev.lastWarningCount = warningCount;
    } else {
      session.fileHistory.set(fp, {
        calls: 1,
        lastErrorCount: errorCount,
        lastWarningCount: warningCount,
        consecutiveNonDecreasing: 0,
      });
    }

    // Mark file as validated in current plan.
    // 'ok' = clean; 'warning' = has warnings agent must review but no errors.
    // Both mean the agent has validated the file and can act on the result.
    // 'error' stays pending — the agent must fix errors and re-validate.
    if (session.validatedPlan && result?.status !== 'error') {
      session.validatedPlan.validatedFiles.add(fp);
    }
  }
}
