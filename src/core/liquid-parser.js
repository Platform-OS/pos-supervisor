/**
 * Liquid template structural element extractor.
 * Reused from the OpenCode plugin — uses liquid-html-parser AST (tolerant mode).
 */

import { toLiquidHtmlAST, walk, NodeTypes, NamedTags } from '@platformos/liquid-html-parser';

/**
 * Parse Liquid content into an AST using tolerant mode.
 * Returns null if the content cannot be parsed at all.
 */
export function parseLiquidFile(content) {
  try {
    return toLiquidHtmlAST(content, { mode: 'tolerant', allowUnclosedDocumentNode: true });
  } catch {
    return null;
  }
}

/**
 * Walk an already-parsed AST and extract all structural elements in one pass.
 */
export function extractAllFromAST(ast) {
  let slug = null;
  let layout = null;
  let method = null;
  const seenRenders = new Set();
  const renders = [];
  const renderCalls = [];
  const seenGQL = new Set();
  const graphql = [];
  const filters = new Set();
  const tags = new Set();
  const transKeys = new Set();
  const prompts = [];
  const docParams = new Set();

  walk(ast, (node) => {
    switch (node.type) {
      case NodeTypes.YAMLFrontmatter: {
        const m = node.body.match(/^slug:\s*(.+)$/m);
        if (m) slug = m[1].trim();
        const lm = node.body.match(/^layout:\s*(.+)$/m);
        if (lm) {
          const raw = lm[1].trim();
          // Strip quotes — layout: "" or layout: '' means no layout
          layout = raw.replace(/^(['"])(.*)\1$/, '$2');
        }
        const mm = node.body.match(/^method:\s*(.+)$/m);
        if (mm) method = mm[1].trim();
        break;
      }

      case NodeTypes.LiquidTag: {
        tags.add(node.name);
        if (node.name === NamedTags.render || node.name === 'include') {
          if (typeof node.markup === 'string') {
            const partialMatch = node.markup.match(/^["']([^"']+)['"]/);
            if (partialMatch) {
              const partialName = partialMatch[1];
              if (!seenRenders.has(partialName)) {
                seenRenders.add(partialName);
                renders.push(partialName);
              }
              const args = extractArgsFromMarkupString(node.markup);
              renderCalls.push({ partial: partialName, args });
            }
            for (const km of node.markup.matchAll(/["']([^"']+)['"]\s*\|\s*t\b/g)) {
              transKeys.add(km[1]);
            }
          } else {
            const partial = node.markup?.partial;
            if (partial?.type === NodeTypes.String) {
              if (!seenRenders.has(partial.value)) {
                seenRenders.add(partial.value);
                renders.push(partial.value);
              }
              const args = extractArgsFromMarkup(node.markup);
              renderCalls.push({ partial: partial.value, args });
            }
          }
        } else if (node.name === NamedTags.graphql) {
          const markup = node.markup;
          if (markup?.type === NodeTypes.GraphQLMarkup) {
            const gqlPath = markup.graphql;
            if (gqlPath?.type === NodeTypes.String) {
              const queryName = gqlPath.value;
              const sourceKind = classifyGraphqlSourceKind(node);
              const args = extractArgsFromMarkup(markup);
              if (seenGQL.has(queryName)) {
                // Same op called twice. Keep the first entry but upgrade
                // source_kind to the most pessimistic value across calls so
                // downstream rules can detect truncation regardless of which
                // call won the dedup.
                if (sourceKind === 'liquid_multiline_truncated') {
                  const existing = graphql.find(g => g.queryName === queryName);
                  if (existing) existing.source_kind = 'liquid_multiline_truncated';
                }
              } else {
                seenGQL.add(queryName);
                graphql.push({
                  variable: markup.name,
                  queryName,
                  args,
                  source_kind: sourceKind,
                });
              }
            }
          }
        }
        break;
      }

      case NodeTypes.LiquidRawTag: {
        tags.add(node.name);
        break;
      }

      case NodeTypes.LiquidFilter: {
        filters.add(node.name);
        break;
      }

      case NodeTypes.LiquidVariable: {
        const hasT = node.filters?.some(f => f.name === 't');
        if (hasT && node.expression?.type === NodeTypes.String) {
          transKeys.add(node.expression.value);
        }
        break;
      }

      case NodeTypes.LiquidDocPromptNode: {
        prompts.push(node.content.value);
        break;
      }

      case NodeTypes.LiquidDocParamNode: {
        if (node.paramName?.value) {
          docParams.add(node.paramName.value);
        }
        break;
      }
    }
  });

  return { slug, layout, method, renders, renderCalls, graphql, filters, tags, transKeys, prompts, docParams };
}

function extractArgsFromMarkup(markup) {
  if (!markup?.args) return [];
  return markup.args
    .filter(a => a.type === NodeTypes.NamedArgument && typeof a.name === 'string')
    .map(a => a.name);
}

/**
 * Classify the surface form of a `{% graphql %}` call.
 *
 *   'tag'                         — `{% graphql ... %}` (with delimiters).
 *   'liquid_inline'               — inside a `{% liquid %}` block, single-line.
 *   'liquid_multiline_truncated'  — inside a `{% liquid %}` block, written
 *                                   with a comma + newline continuation. The
 *                                   liquid-html-parser truncates the call at
 *                                   the first newline-comma, so `markup.args`
 *                                   silently drops every argument past it —
 *                                   and pos-cli's LSP diagnostic check has
 *                                   the same blind spot. The agent sees the
 *                                   args in source; both parsers don't.
 *
 * Detection criterion for the truncated form: source range starts without
 * `{%` (we are inside a `{% liquid %}` block), the visible source text ends
 * on a comma, AND the immediately trailing characters in the file contain
 * another `name:` clause on a subsequent line. The trailing-text check is
 * the load-bearing signal — without it a legitimate inline call that just
 * happens to end on a comma (rare, but possible) would be misclassified.
 */
export function classifyGraphqlSourceKind(node) {
  const src = typeof node?.source === 'string' ? node.source : '';
  const start = node?.position?.start ?? 0;
  const end = node?.position?.end ?? 0;
  const text = src.slice(start, end);
  if (text.startsWith('{%')) return 'tag';
  if (text.trimEnd().endsWith(',')) {
    const trail = src.slice(end, end + 200);
    if (/\n\s*[A-Za-z_]\w*\s*:/.test(trail)) {
      return 'liquid_multiline_truncated';
    }
  }
  return 'liquid_inline';
}

function extractArgsFromMarkupString(markupStr) {
  const args = [];
  const afterPartial = markupStr.replace(/^["'][^"']+["']\s*,?\s*/, '');
  for (const m of afterPartial.matchAll(/(\w+)\s*:/g)) {
    args.push(m[1]);
  }
  return args;
}

/**
 * Parse and extract all structural elements from raw content.
 */
export function extractAll(content) {
  const ast = parseLiquidFile(content);
  if (!ast) return null;
  return extractAllFromAST(ast);
}
