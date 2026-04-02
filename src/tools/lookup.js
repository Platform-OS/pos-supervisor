import { readFile } from 'node:fs/promises';
import { toUri, sanitizePath } from '../core/utils.js';

export const lookupTool = {
  name: 'lookup',
  description: 'Direct access to platformOS LSP intelligence at a specific position in a file. Returns hover documentation, completions, definitions, references, or dependencies. Use for precise information about any Liquid tag, filter, object, or GraphQL element.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'File path (relative to project root)',
      },
      line: {
        type: 'number',
        description: 'Line number (0-based)',
      },
      character: {
        type: 'number',
        description: 'Column number (0-based)',
      },
      mode: {
        type: 'string',
        enum: ['hover', 'completions', 'definition', 'references', 'dependencies'],
        description: 'LSP operation to perform',
      },
    },
    required: ['file_path', 'mode'],
  },

  createHandler(ctx) {
    return async (params) => {
      const { file_path, line, character, mode } = params;

      // Input validation
      if (!file_path || typeof file_path !== 'string') {
        return { error: 'file_path is required' };
      }
      if (!mode || typeof mode !== 'string') {
        return { error: 'mode is required' };
      }

      let absPath;
      try {
        absPath = sanitizePath(ctx.directory, file_path);
      } catch (e) {
        return { error: e.message };
      }

      const uri = toUri(absPath);

      // Wait for LSP to be ready
      await ctx.awaitLsp();

      if (!ctx.lsp?.initialized) {
        return { error: 'LSP not initialized. The language server failed to start.' };
      }

      // Sync file content to LSP
      try {
        const content = await readFile(absPath, 'utf8');
        ctx.lsp.syncDoc(uri, content);
      } catch (e) {
        return { error: `Cannot read file: ${e.message}` };
      }

      try {
        switch (mode) {
          case 'hover': {
            if (line == null) return { error: 'line is required for hover' };
            const result = await ctx.lsp.hover(uri, line, character ?? 0);
            return formatHover(result);
          }
          case 'completions': {
            if (line == null) return { error: 'line is required for completions' };
            const result = await ctx.lsp.completions(uri, line, character ?? 0);
            return formatCompletions(result);
          }
          case 'definition': {
            if (line == null) return { error: 'line is required for definition' };
            const result = await ctx.lsp.definition(uri, line, character ?? 0);
            return formatDefinitions(result);
          }
          case 'references': {
            const result = await ctx.lsp.references(uri);
            return formatReferences(result, 'References');
          }
          case 'dependencies': {
            const result = await ctx.lsp.dependencies(uri);
            return formatReferences(result, 'Dependencies');
          }
          default:
            return { error: `Unknown mode: ${mode}` };
        }
      } catch (e) {
        return { error: `LSP ${mode} failed: ${e.message}` };
      }
    };
  },
};

function formatHover(result) {
  if (!result?.contents) return { content: null };
  const c = result.contents;
  let text;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) text = c.map(x => typeof x === 'string' ? x : (x.value ?? '')).join('\n\n');
  else text = c.value ?? null;
  return { content: text, range: result.range ?? null };
}

function formatCompletions(result) {
  const items = Array.isArray(result) ? result : (result?.items ?? []);
  return {
    count: items.length,
    items: items.slice(0, 50).map(item => ({
      label: item.label,
      detail: item.detail ?? null,
      documentation: typeof item.documentation === 'string'
        ? item.documentation
        : (item.documentation?.value ?? null),
    })),
  };
}

function formatDefinitions(result) {
  if (!result?.length) return { definitions: [] };
  return {
    definitions: result.map(loc => ({
      path: (loc.targetUri ?? loc.uri ?? '').replace('file://', ''),
      line: (loc.targetRange?.start ?? loc.range?.start)?.line ?? null,
    })),
  };
}

function formatReferences(result, label) {
  const items = result?.items ?? result ?? [];
  if (!Array.isArray(items)) return { label, items: [] };
  return {
    label,
    items: items.map(ref => {
      const loc = ref.source?.exists !== false ? ref.source : ref.target;
      return {
        path: (loc?.uri ?? '').replace('file://', ''),
        excerpt: loc?.excerpt?.trim() ?? null,
      };
    }),
  };
}
