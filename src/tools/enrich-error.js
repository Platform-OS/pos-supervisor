import { enrichError } from '../core/error-enricher.js';
import { toUri, sanitizePath } from '../core/utils.js';

export const enrichErrorTool = {
  name: 'enrich_error',
  description: [
    'PURPOSE:',
    'Deep analysis of a specific linter error using LSP intelligence. Returns hint text,',
    'hover documentation, completion suggestions, closest filter/object matches, and references.',
    '',
    'WHEN TO CALL:',
    'Call this after validate_code (mode: full) returns an error or warning that you cannot',
    'resolve from the diagnostic message alone. It provides maximum context for a single error.',
    'Not a substitute for validate_code — use it to go deeper on a specific line after',
    'validate_code has already identified the problem.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'File path (relative to project root)',
      },
      check_name: {
        type: 'string',
        description: 'Linter check name (e.g. "UnknownFilter", "UndefinedObject", "GraphQLCheck")',
      },
      line: {
        type: 'number',
        description: 'Error line number (0-based)',
      },
      character: {
        type: 'number',
        description: 'Error column (0-based)',
      },
      error_message: {
        type: 'string',
        description: 'The error message text',
      },
    },
    required: ['file_path', 'check_name', 'error_message'],
  },

  createHandler(ctx) {
    return async (params) => {
      const { file_path, check_name, line, character, error_message } = params;

      // Input validation
      if (!file_path || typeof file_path !== 'string') {
        return { error: 'file_path is required' };
      }
      if (!check_name || typeof check_name !== 'string') {
        return { error: 'check_name is required' };
      }
      if (!error_message || typeof error_message !== 'string') {
        return { error: 'error_message is required' };
      }

      let absPath;
      try {
        absPath = sanitizePath(ctx.directory, file_path);
      } catch (e) {
        return { error: e.message };
      }

      const uri = toUri(absPath);

      // Wait for LSP before enriching
      await ctx.awaitLsp();

      const diagnostic = {
        check: check_name,
        severity: 'error',
        message: error_message,
        line: line ?? null,
        column: character ?? null,
      };

      const enriched = await enrichError(diagnostic, {
        uri,
        lsp: ctx.lsp,
        filtersIndex: ctx.filtersIndex,
        objectsIndex: ctx.objectsIndex,
        tagsIndex: ctx.tagsIndex,
        schemaIndex: ctx.schemaIndex,
      });

      // Also try to get completions at the error position
      if (ctx.lsp?.initialized && line != null) {
        try {
          const completions = await ctx.lsp.completions(uri, line, character ?? 0);
          const items = Array.isArray(completions) ? completions : (completions?.items ?? []);
          if (items.length) {
            enriched.completions = items.slice(0, 20).map(item => ({
              label: item.label,
              detail: item.detail ?? null,
            }));
          }
        } catch {
          // completions failed — skip
        }
      }

      return enriched;
    };
  },
};
