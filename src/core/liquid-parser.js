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
            if (gqlPath?.type === NodeTypes.String && !seenGQL.has(gqlPath.value)) {
              seenGQL.add(gqlPath.value);
              graphql.push({ variable: markup.name, queryName: gqlPath.value });
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
