/**
 * Fix generator — produces concrete, actionable fixes for linter diagnostics.
 *
 * Fix types:
 *   text_edit   — exact range + replacement text (variable rename, filter rename)
 *   insert      — insert text at a position ({% doc %} block)
 *   create_file — create a missing file (MissingPartial)
 *   guidance    — description only, no exact edit (complex cases)
 */

import { walk, NodeTypes } from '@platformos/liquid-html-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractParams } from './diagnostic-record.js';
import { isShopifyObject, isShopifyFilter } from './knowledge-loader.js';
import { offsetToLineCol, lineColToOffset, slugFromPath } from './position-utils.js';
import { POSITION_FUZZY_TOLERANCE } from './constants.js';

// ── AST helpers ─────────────────────────────────────────────────────────────

/**
 * Find all VariableLookup nodes in the AST and return them with line:col ranges.
 */
function indexVariables(ast, content) {
  const vars = [];
  walk(ast, (node) => {
    if (node.type === 'VariableLookup' && node.name && node.position) {
      const start = offsetToLineCol(content, node.position.start);
      const nameEnd = node.position.start + node.name.length;
      const end = offsetToLineCol(content, nameEnd);
      vars.push({ name: node.name, start, end, offset: node.position.start });
    }
  });
  return vars;
}

/**
 * Find all LiquidFilter nodes in the AST.
 */
function indexFilters(ast, content) {
  const filters = [];
  walk(ast, (node) => {
    if (node.type === 'LiquidFilter' && node.name && node.position) {
      // Filter position covers `| name`; the name starts after the pipe+space
      // We need the name-only range. Walk from position.start to find the name.
      const raw = content.slice(node.position.start, node.position.end);
      const nameIdx = raw.indexOf(node.name);
      if (nameIdx >= 0) {
        const nameStart = node.position.start + nameIdx;
        const nameEndOff = nameStart + node.name.length;
        filters.push({
          name: node.name,
          start: offsetToLineCol(content, nameStart),
          end: offsetToLineCol(content, nameEndOff),
        });
      }
    }
  });
  return filters;
}

/**
 * Find the {% doc %} block in the AST, if present.
 * Returns { start, end, params: string[] } or null.
 */
function findDocBlock(ast, content) {
  let docNode = null;
  const params = [];
  walk(ast, (node) => {
    if (node.type === 'LiquidRawTag' && node.name === 'doc') {
      docNode = node;
    }
    if (node.type === 'LiquidDocParamNode') {
      params.push(node);
    }
  });
  if (!docNode) return null;
  return {
    startOffset: docNode.position.start,
    endOffset: docNode.position.end,
    start: offsetToLineCol(content, docNode.position.start),
    end: offsetToLineCol(content, docNode.position.end),
    existingParams: params.map(p => {
      // Extract param name from the raw text
      const raw = content.slice(p.position.start, p.position.end);
      const m = raw.match(/@param\s+\{[^}]*\}\s+(\w+)/);
      return m ? m[1] : null;
    }).filter(Boolean),
  };
}

/**
 * Find front matter end position.
 */
function findFrontMatterEnd(ast, content) {
  let fmEnd = null;
  walk(ast, (node) => {
    if (node.type === 'YAMLFrontmatter' && node.position) {
      fmEnd = offsetToLineCol(content, node.position.end);
    }
  });
  return fmEnd;
}

/**
 * Collect all variables in scope at a given byte offset in the AST.
 *
 * Liquid scoping rules:
 * - Doc params (@param): always in scope for the whole file
 * - For/tablerow loop iterators: only in scope inside the loop body
 * - Assigns, captures, graphql results, function results, parse_json:
 *   in scope for everything after the tag (Liquid has flat scoping)
 *
 * @param {object} ast - Parsed Liquid AST (from parseLiquidFile)
 * @param {number} targetOffset - Byte offset in the source content
 * @returns {Array<{ name: string, source: string }>} Variables in scope, deduplicated by name
 */
export function collectScopeAtOffset(ast, targetOffset) {
  if (!ast) return [];

  const definitions = [];

  walk(ast, (node) => {
    if (node.type === 'LiquidDocParamNode' && node.paramName?.value) {
      definitions.push({
        name: node.paramName.value,
        source: '@param',
        scopeType: 'global',
      });
      return;
    }

    if (node.type !== NodeTypes.LiquidTag || !node.position) return;

    switch (node.name) {
      case 'for':
      case 'tablerow': {
        if (node.markup?.variableName) {
          const collection = node.markup.collection?.name || '...';
          definitions.push({
            name: node.markup.variableName,
            source: `{% ${node.name} ${node.markup.variableName} in ${collection} %}`,
            scopeType: 'block',
            scopeStart: node.position.start,
            scopeEnd: node.position.end,
          });
        }
        break;
      }
      case 'assign': {
        if (node.markup?.name) {
          definitions.push({
            name: node.markup.name,
            source: '{% assign %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'capture': {
        const captureName = typeof node.markup === 'object' ? node.markup?.name : null;
        if (captureName) {
          definitions.push({
            name: captureName,
            source: '{% capture %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'graphql': {
        const gqlName = typeof node.markup === 'object' && typeof node.markup?.name === 'string'
          ? node.markup.name : null;
        if (gqlName) {
          definitions.push({
            name: gqlName,
            source: '{% graphql %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'function': {
        const funcName = typeof node.markup === 'object' ? node.markup?.name?.name : null;
        if (funcName) {
          definitions.push({
            name: funcName,
            source: '{% function %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'parse_json': {
        const pjName = typeof node.markup === 'object' ? node.markup?.name : null;
        if (pjName) {
          definitions.push({
            name: pjName,
            source: '{% parse_json %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
    }
  });

  const inScope = [];
  const seen = new Set();

  for (const def of definitions) {
    let isInScope = false;
    switch (def.scopeType) {
      case 'global':
        isInScope = true;
        break;
      case 'block':
        isInScope = targetOffset >= def.scopeStart && targetOffset <= def.scopeEnd;
        break;
      case 'after':
        isInScope = targetOffset >= def.definedAt;
        break;
    }

    if (isInScope && !seen.has(def.name)) {
      seen.add(def.name);
      inScope.push({ name: def.name, source: def.source });
    }
  }

  return inScope;
}

/**
 * Format scope variables into a human-readable string for guidance messages.
 * Returns empty string if scope is empty.
 */
function formatScopeInfo(scopeVars) {
  if (!scopeVars || scopeVars.length === 0) return '';
  const items = scopeVars.map(v => `${v.name} (${v.source})`).join(', ');
  return `\nVariables in scope: ${items}`;
}

/**
 * Find a VariableLookup node near a diagnostic position.
 */
function findVarAt(varIndex, line, col, varName) {
  // Exact match first
  for (const v of varIndex) {
    if (v.name === varName && v.start.line === line && v.start.character === col) return v;
  }
  // Fuzzy: same line, within a few chars (pos-cli positions may differ slightly)
  for (const v of varIndex) {
    if (v.name === varName && v.start.line === line && Math.abs(v.start.character - col) <= POSITION_FUZZY_TOLERANCE) return v;
  }
  return null;
}

/**
 * Find a LiquidFilter node near a diagnostic position.
 */
function findFilterAt(filterIndex, line, col, filterName) {
  for (const f of filterIndex) {
    if (f.name === filterName && f.start.line === line && Math.abs(f.start.character - col) <= POSITION_FUZZY_TOLERANCE) return f;
  }
  return null;
}

// Extraction functions (extractFilterName, extractPartialPath) have been
// centralized into diagnostic-record.js extractParams(). See roadmap §A2.

// ── Fix handlers per check type ─────────────────────────────────────────────

function fixUndefinedObject(diagnostic, varIndex, isPartialLike, objectsIndex) {
  const varName = extractParams(diagnostic.check, diagnostic.message).variable ?? null;
  if (!varName) return null;

  // Shopify object — don't suggest a platformOS replacement (semantic mismatch)
  if (isShopifyObject(varName)) {
    return {
      type: 'guidance',
      description: `\`${varName}\` is a Shopify theme object — it does not exist in platformOS. Use \`{% graphql %}\` to fetch data from your schema and \`context.*\` for request/user data.`,
    };
  }

  const contextObj = objectsIndex?.lookup(varName);

  if (contextObj) {
    // Known context object → replace bare name with context.X
    const varNode = findVarAt(varIndex, diagnostic.line, diagnostic.column, varName);
    if (varNode) {
      return {
        type: 'text_edit',
        range: { start: varNode.start, end: varNode.end },
        new_text: contextObj.handle,
        description: `Replace \`${varName}\` with \`${contextObj.handle}\``,
      };
    }
    // Fallback: use diagnostic position + name length
    return {
      type: 'text_edit',
      range: {
        start: { line: diagnostic.line, character: diagnostic.column },
        end: { line: diagnostic.line, character: diagnostic.column + varName.length },
      },
      new_text: contextObj.handle,
      description: `Replace \`${varName}\` with \`${contextObj.handle}\``,
    };
  }

  if (isPartialLike) {
    // Not a context object, in a partial/command/query → needs {% doc %} declaration
    return {
      type: 'add_doc_param',
      param_name: varName,
      description: `Declare parameter: add \`@param {object} ${varName}\` to {% doc %} block`,
    };
  }

  // In a page, not a known context object — likely a local variable from
  // graphql/function/assign. Don't suggest a fix (could be misleading).
  return null;
}

function fixUnknownFilter(diagnostic, filterIndex, filtersIndex, tagsIndex) {
  const filterName = extractParams(diagnostic.check, diagnostic.message).filter ?? null;
  if (!filterName) return null;

  // Tag-as-filter (highest priority)
  if (tagsIndex?.isTag(filterName)) {
    return {
      type: 'guidance',
      description: `\`${filterName}\` is a tag, not a filter. Use \`{% ${filterName} ... %}\` block syntax instead of \`| ${filterName}\`.`,
    };
  }

  // Shopify filter — don't suggest a syntactic closest-match (semantic mismatch)
  if (isShopifyFilter(filterName)) {
    return {
      type: 'guidance',
      description: `\`${filterName}\` is a Shopify-specific filter — it does not exist in platformOS. Check platformOS docs for the equivalent functionality.`,
    };
  }

  // Closest match from index (only for non-Shopify filters)
  const closest = filtersIndex?.closestMatch(filterName);
  if (closest && closest.name !== filterName) {
    const filterNode = findFilterAt(filterIndex, diagnostic.line, diagnostic.column, filterName);
    if (filterNode) {
      return {
        type: 'text_edit',
        range: { start: filterNode.start, end: filterNode.end },
        new_text: closest.name,
        description: `Replace \`${filterName}\` with \`${closest.name}\``,
      };
    }
    // Fallback
    return {
      type: 'text_edit',
      range: {
        start: { line: diagnostic.line, character: diagnostic.column },
        end: { line: diagnostic.line, character: diagnostic.column + filterName.length },
      },
      new_text: closest.name,
      description: `Replace \`${filterName}\` with \`${closest.name}\``,
    };
  }

  return null;
}

function fixMissingPartial(diagnostic, projectDir, ast, content) {
  const partialPath = extractParams(diagnostic.check, diagnostic.message).partial ?? null;
  if (!partialPath) return null;

  // Determine the correct directory based on the partial path
  let targetPath;
  let fileType = 'partial';
  if (partialPath.startsWith('commands/') || partialPath.startsWith('lib/commands/')) {
    targetPath = `app/lib/commands/${partialPath.replace(/^(lib\/)?commands\//, '')}.liquid`;
    fileType = 'command';
  } else if (partialPath.startsWith('queries/') || partialPath.startsWith('lib/queries/')) {
    targetPath = `app/lib/queries/${partialPath.replace(/^(lib\/)?queries\//, '')}.liquid`;
    fileType = 'query';
  } else {
    targetPath = `app/views/partials/${partialPath}.liquid`;
  }

  // Module paths: never create_file — agent cannot create files inside installed modules
  if (partialPath.startsWith('modules/')) {
    if (diagnostic.suggestion) {
      return {
        type: 'guidance',
        description: `\`${partialPath}\` is a module path. Fix the path in this file — available paths are in the suggestion field.`,
      };
    }
    return {
      type: 'guidance',
      description: `\`${partialPath}\` cannot be resolved. Call project_map to see installed modules and their available paths.`,
    };
  }

  // Check if file already exists — if so, don't suggest creating it again
  if (projectDir) {
    const absTarget = join(projectDir, targetPath);
    if (existsSync(absTarget)) {
      return {
        type: 'guidance',
        description: `File \`${targetPath}\` exists but the linter still reports it as missing. Check that the file is not empty, has no syntax errors, and the path in the render/function tag matches exactly.`,
      };
    }
  }

  // Generate scaffold content from the render/function call's arguments
  const scaffold = generateScaffold(partialPath, fileType, ast, content);

  return {
    type: 'create_file',
    path: targetPath,
    scaffold,
    description: `Create missing file: \`${targetPath}\``,
  };
}

/**
 * Detect if a parameter name likely refers to a collection (array of items).
 * Used to generate appropriate scaffold content (iteration vs property access).
 */
function isLikelyCollection(paramName) {
  const name = paramName.toLowerCase();
  // Known singular words ending in 's' that are NOT collections
  const knownSingulars = new Set([
    'status', 'address', 'access', 'progress', 'process', 'focus',
    'canvas', 'alias', 'class', 'success', 'basis', 'radius',
  ]);
  if (knownSingulars.has(name)) return false;
  // Explicit collection suffixes
  if (/_(list|collection|records|results|items|entries)$/.test(name)) return true;
  // Common collection-only names
  if (/^(records|results|items|entries|data|rows)$/.test(name)) return true;
  // Plural by 's' suffix (but not 'ss' endings like 'success', 'address')
  if (name.length > 4 && name.endsWith('s') && !name.endsWith('ss')) return true;
  return false;
}

/**
 * Naive singularization for scaffold variable names.
 */
function singularize(name) {
  if (name.endsWith('ies') && name.length > 4) return name.slice(0, -3) + 'y';
  if (name.endsWith('ses') && name.length > 4) return name.slice(0, -2); // statuses → status
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 3) return name.slice(0, -1);
  return name;
}

/**
 * Generate scaffold content for a missing file by parsing render/function call arguments.
 */
function generateScaffold(partialPath, fileType, ast, content) {
  if (!ast) return null;

  // Find the render/function tag that references this partial
  const params = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag) return;

    // Check render tags
    if (node.name === 'render' || node.name === 'function' || node.name === 'theme_render_rc') {
      const markup = node.markup;
      if (typeof markup === 'string') {
        // String markup: 'partial_name', key: val, key2: val2
        if (!markup.includes(partialPath)) return;
        // Extract named args from the markup string
        const argMatches = markup.matchAll(/,\s*(\w+)\s*:/g);
        for (const m of argMatches) {
          if (!params.includes(m[1])) params.push(m[1]);
        }
      } else if (markup?.partial) {
        // Parsed markup with partial node
        const partialValue = markup.partial?.value;
        if (partialValue !== partialPath) return;
        // Extract named args from parsed markup
        if (markup.args) {
          for (const arg of markup.args) {
            const name = arg.name ?? arg.key;
            if (name && !params.includes(name)) params.push(name);
          }
        }
      }
    }
  });

  if (params.length === 0) return null;

  // Build the scaffold
  const docParams = params.map(p => `  @param {object} ${p}`).join('\n');

  if (fileType === 'command') {
    return `{% doc %}\n${docParams}\n{% enddoc %}\n{% liquid\n  # Build\n  assign object = {} | hash_merge: ${params.map(p => `${p}: ${p}`).join(', ')}\n\n  # Check\n  # Add validation here\n\n  # Execute\n  return object\n%}`;
  }

  if (fileType === 'query') {
    // graphql tag resolves from app/graphql/ — strip the queries/ or lib/queries/ prefix
    const graphqlPath = partialPath.replace(/^(lib\/)?queries\//, '');
    return `{% doc %}\n${docParams}\n{% enddoc %}\n{% liquid\n  graphql result = '${graphqlPath}', ${params.map(p => `${p}: ${p}`).join(', ')}\n  return result\n%}`;
  }

  // Partial scaffold — generate iteration for collection params, property access for singular params
  const paramLines = params.map(p => {
    if (isLikelyCollection(p)) {
      const singular = singularize(p);
      return `  {% for ${singular} in ${p} %}\n    {{ ${singular} }}\n  {% endfor %}`;
    }
    return `  {{ ${p} }}`;
  }).join('\n');
  return `{% doc %}\n${docParams}\n{% enddoc %}\n<div>\n${paramLines}\n</div>`;
}

function fixConvertInclude(diagnostic, content) {
  const line = content.split('\n')[diagnostic.line];
  if (!line) return null;

  // Module helper includes need scope sharing — don't auto-replace
  if (/include\s+['"]modules\//.test(line)) {
    return {
      type: 'guidance',
      description: '`{% include %}` for module helpers (e.g., authorization, redirects) is correct — they need shared scope. Only replace with `{% render %}` if the partial does NOT modify the parent scope.',
    };
  }

  // Find 'include' in the line near the diagnostic column
  const searchStart = Math.max(0, diagnostic.column - 5);
  const idx = line.indexOf('include', searchStart);
  if (idx < 0) return null;

  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: idx },
      end: { line: diagnostic.line, character: idx + 'include'.length },
    },
    new_text: 'render',
    description: 'Replace `include` with `render` — render has isolated scope, pass all needed variables explicitly',
  };
}

function fixDeprecatedTag(diagnostic, content) {
  const msg = diagnostic.message || '';

  // hash_assign → assign
  if (msg.includes('hash_assign')) {
    const line = content.split('\n')[diagnostic.line];
    if (!line) return null;
    const idx = line.indexOf('hash_assign');
    if (idx < 0) return null;
    return {
      type: 'text_edit',
      range: {
        start: { line: diagnostic.line, character: idx },
        end: { line: diagnostic.line, character: idx + 'hash_assign'.length },
      },
      new_text: 'assign',
      description: 'Replace deprecated `hash_assign` with `assign`',
    };
  }

  return null;
}

function fixMissingRenderPartialArguments(diagnostic, ast, content) {
  const msg = diagnostic.message || '';
  const partialMatch = msg.match(/partial\s+['"`]([^'"`]+)['"`]/) || msg.match(/['"`]([^'"`\/]+\/[^'"`]+)['"`]/);
  const paramMatch = msg.match(/argument\s+['"`](\w+)['"`]/) || msg.match(/@param\s+(?:\{[^}]*\}\s+)?(\w+)/);

  let scopeInfo = '';
  if (ast && content && diagnostic.line != null) {
    const offset = lineColToOffset(content, diagnostic.line, diagnostic.column ?? 0);
    scopeInfo = formatScopeInfo(collectScopeAtOffset(ast, offset));
  }

  if (!partialMatch || !paramMatch) {
    return {
      type: 'guidance',
      description: `Add the missing required parameter(s) to the \`{% render %}\` call. Check the partial's \`{% doc %}\` block for required \`@param\` declarations.${scopeInfo}`,
    };
  }

  return {
    type: 'guidance',
    description: `Add \`${paramMatch[1]}: <value>\` to the \`{% render '${partialMatch[1]}' %}\` call.${scopeInfo}`,
  };
}

function fixNestedGraphQLQuery(diagnostic) {
  return {
    type: 'guidance',
    description: 'Move the `{% graphql %}` call BEFORE the loop and use a batch/list query to fetch all data in one request. Each loop iteration currently makes a separate database query (N+1 problem).',
  };
}

// ── New fix handlers (V2) ────────────────────────────────────────────────────

function fixImgLazyLoading(diagnostic, content) {
  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;

  // Find <img in the line (or nearby)
  const imgIdx = line.indexOf('<img');
  if (imgIdx < 0) return null;

  // Check if loading= already exists
  if (/loading\s*=/.test(line)) return null;

  // Find the closing > of the img tag
  const closeIdx = line.indexOf('>', imgIdx);
  if (closeIdx < 0) return null;

  // Insert before the closing > (or before />)
  const insertBefore = line[closeIdx - 1] === '/' ? closeIdx - 1 : closeIdx;
  const before = line.slice(0, insertBefore);
  const after = line.slice(insertBefore);

  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: insertBefore },
      end: { line: diagnostic.line, character: insertBefore },
    },
    new_text: ' loading="lazy"',
    description: `Add \`loading="lazy"\` to <img> tag for better page load performance`,
  };
}

function fixImgWidthAndHeight(diagnostic, content) {
  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;

  const imgIdx = line.indexOf('<img');
  if (imgIdx < 0) return null;

  const hasWidth = /width\s*=/.test(line);
  const hasHeight = /height\s*=/.test(line);
  if (hasWidth && hasHeight) return null;

  const closeIdx = line.indexOf('>', imgIdx);
  if (closeIdx < 0) return null;

  const insertBefore = line[closeIdx - 1] === '/' ? closeIdx - 1 : closeIdx;
  const attrs = [];
  if (!hasWidth) attrs.push('width=""');
  if (!hasHeight) attrs.push('height=""');

  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: insertBefore },
      end: { line: diagnostic.line, character: insertBefore },
    },
    new_text: ' ' + attrs.join(' '),
    description: `Add ${attrs.join(' and ')} to <img> tag to prevent layout shift (CLS)`,
  };
}

function fixHardcodedRoutes(diagnostic, content) {
  const msg = diagnostic.message || '';
  const pathMatch = msg.match(/['"`](\/[^'"`]+)['"`]/);
  if (!pathMatch) {
    return {
      type: 'guidance',
      description: 'Avoid hardcoded URL paths — they break when slugs change. Build URLs dynamically using variables and `| append` filter.',
    };
  }

  const hardcodedPath = pathMatch[1];

  return {
    type: 'guidance',
    description: `Avoid hardcoded \`${hardcodedPath}\`. Build the URL dynamically using variables: e.g., \`{% assign url = '/products/' | append: item.id %}\`. This ensures URLs stay correct if slugs change.`,
  };
}

// ── Remaining linter check fixes ─────────────────────────────────────────────

function fixInvalidHashAssignTarget(diagnostic, content) {
  const msg = diagnostic.message || '';
  const varMatch = msg.match(/['"`](\w+)['"`]/);
  const varName = varMatch ? varMatch[1] : 'my_hash';

  return {
    type: 'guidance',
    description: `Initialize the variable before setting properties: \`{% assign ${varName} = {} %}\`. Then use \`{% assign ${varName}["key"] = "value" %}\`. Both \`hash_assign\` and \`parse_json\` are deprecated — use \`assign\` with hash literals.`,
  };
}

function fixMissingAsset(diagnostic) {
  const msg = diagnostic.message || '';
  const pathMatch = msg.match(/['"`]([^'"`]+)['"`]/);
  if (!pathMatch) {
    return {
      type: 'guidance',
      description: 'Create the missing asset in `app/assets/`. This check has a high false-positive rate for module assets — verify the file is truly missing.',
    };
  }

  const assetPath = pathMatch[1];
  return {
    type: 'create_file',
    path: `app/assets/${assetPath}`,
    description: `Create missing asset: \`app/assets/${assetPath}\`. If this is a module asset, the file may already exist in the module's asset directory.`,
  };
}

function fixMetadataParamsCheck(diagnostic, ast, content) {
  const msg = diagnostic.message || '';
  const isFunctionCall = /function call/i.test(msg);
  const tag = isFunctionCall ? 'function' : 'render';
  const targetLabel = isFunctionCall ? "query/command's" : "partial's";

  let scopeInfo = '';
  if (ast && content && diagnostic.line != null) {
    const offset = lineColToOffset(content, diagnostic.line, diagnostic.column ?? 0);
    scopeInfo = formatScopeInfo(collectScopeAtOffset(ast, offset));
  }

  const partialMatch = msg.match(/partial\s+['"`]([^'"`]+)['"`]/) || msg.match(/['"`]([^'"`\/]+\/[^'"`]+)['"`]/);
  const paramMatch = msg.match(/argument\s+['"`](\w+)['"`]/) || msg.match(/param(?:eter)?\s+['"`](\w+)['"`]/);

  if (partialMatch && paramMatch) {
    const tagExample = isFunctionCall
      ? `{% function result = '${partialMatch[1]}', ${paramMatch[1]}: <value> %}`
      : `{% render '${partialMatch[1]}', ${paramMatch[1]}: <value> %}`;
    return {
      type: 'guidance',
      description: `Add \`${paramMatch[1]}: <value>\` to the \`${tagExample}\` call. The ${targetLabel} \`{% doc %}\` block requires this parameter. Passing \`null\` is valid for any typed parameter. Common defaults by type: \`[]\` for array, \`{}\` for object, \`""\` for string, \`false\` for boolean.${scopeInfo}`,
    };
  }

  return {
    type: 'guidance',
    description: `Check the target ${targetLabel} \`{% doc %}\` block for required \`@param\` declarations. Pass all required parameters with matching types.${scopeInfo}`,
  };
}

function fixUnknownProperty(diagnostic, objectsIndex) {
  const msg = diagnostic.message || '';

  // Common GraphQL traversal mistakes
  if (msg.includes('results') || msg.includes('records')) {
    return {
      type: 'guidance',
      description: 'GraphQL query results use `result.records.results` for the list and `result.records.total_entries` for count. Do NOT use `result.results` or `result.total_count`.',
    };
  }

  return {
    type: 'guidance',
    description: 'The linter cannot verify this property exists. Check the object\'s traversal path with `platformos_hover`. For GraphQL results: `result.records.results` for the list.',
  };
}

function fixLiquidHTMLSyntaxError(diagnostic, content) {
  const msg = diagnostic.message || '';
  const lines = content.split('\n');
  const line = lines[diagnostic.line];

  // Missing = in graphql/function tag: {% graphql result "query" %} → {% graphql result = "query" %}
  if (line && /\{%[-\s]*(?:graphql|function)\s+\w+\s+['"]/.test(line)) {
    const fixedLine = line.replace(
      /(\{%[-\s]*(?:graphql|function)\s+\w+)\s+(['"])/,
      '$1 = $2'
    );
    if (fixedLine !== line) {
      return {
        type: 'text_edit',
        range: {
          start: { line: diagnostic.line, character: 0 },
          end: { line: diagnostic.line, character: line.length },
        },
        new_text: fixedLine,
        description: 'Add missing `=` in graphql/function tag assignment',
      };
    }
  }

  // Unclosed Liquid tag
  if (msg.includes('end') || msg.includes('unclosed') || msg.includes('Unclosed')) {
    return {
      type: 'guidance',
      description: 'Unclosed Liquid block detected. Ensure every `{% if %}` has `{% endif %}`, every `{% for %}` has `{% endfor %}`, etc. Inside `{% liquid %}` blocks, each statement goes on its own line without delimiters.',
    };
  }

  // Mismatched quotes
  if (msg.includes('quote') || msg.includes('Quote') || msg.includes('string')) {
    return {
      type: 'guidance',
      description: 'Check for mismatched quotes. Single and double quotes must be properly paired. In Liquid, both `\'string\'` and `"string"` are valid.',
    };
  }

  return null;
}

// ── pos-supervisor structural check fixes ───────────────────────────────────────────

function fixStructuralCheck(diagnostic, content, ast, filePath) {
  switch (diagnostic.check) {
    case 'pos-supervisor:InvalidMethod':
      return fixInvalidMethod(diagnostic, content);
    case 'pos-supervisor:InvalidSlug':
      return fixInvalidSlugEdit(diagnostic, content);
    case 'pos-supervisor:MissingContentForLayout':
      return fixMissingContentForLayout(diagnostic, content, ast);
    case 'pos-supervisor:MissingReturn':
      return fixMissingReturnInsert(diagnostic, content);
    case 'pos-supervisor:MissingDocBlock':
      return fixMissingDocBlockInsert(diagnostic, content, ast);
    case 'pos-supervisor:MissingSlug':
      return fixMissingSlugInsert(diagnostic, content, filePath);
    case 'pos-supervisor:GraphqlInPartial':
      return {
        type: 'guidance',
        description: 'Move the `{% graphql %}` call to a page or command. Pass the query results to the partial: `{% render "partial", data: query_result %}`.',
      };
    case 'pos-supervisor:HtmlInPage':
      return {
        type: 'guidance',
        description: 'Extract HTML into a partial and render it: `{% render "partial_name" %}`. Pages should contain only logic (graphql, assign, render, redirect_to).',
      };
    case 'pos-supervisor:ShopifyObject':
      return fixShopifyObject(diagnostic);
    case 'pos-supervisor:SchemaPropertyType':
      return fixSchemaPropertyType(diagnostic, content);
    case 'pos-supervisor:InvalidLayout':
      return {
        type: 'create_file',
        path: extractLayoutPath(diagnostic.message),
        description: `Create the missing layout file. Layouts live in \`app/views/layouts/\`.`,
      };
    case 'pos-supervisor:InvalidFrontMatter':
      return fixInvalidFrontMatter(diagnostic, content);
    default:
      return null;
  }
}

function fixInvalidMethod(diagnostic, content) {
  const msg = diagnostic.message || '';
  // Extract the current method and suggested lowercase version
  const methodMatch = msg.match(/`(\w+)`.*lowercase.*`(\w+)`/) || msg.match(/`(\w+)`/);
  if (!methodMatch) return null;

  const currentMethod = methodMatch[1];
  const lowerMethod = methodMatch[2] || currentMethod.toLowerCase();

  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;

  const re = new RegExp(`method:\\s*${currentMethod}\\b`);
  const match = line.match(re);
  if (!match) return null;

  const methodStart = line.indexOf(currentMethod, match.index);
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: methodStart },
      end: { line: diagnostic.line, character: methodStart + currentMethod.length },
    },
    new_text: lowerMethod,
    description: `Fix method case: \`${currentMethod}\` → \`${lowerMethod}\``,
  };
}

function fixInvalidSlugEdit(diagnostic, content) {
  const msg = diagnostic.message || '';

  // Extract the suggested corrected slug from the message
  const correctedMatch = msg.match(/: `([^`]+)`\.$/);
  if (!correctedMatch) return null;

  const correctedSlug = correctedMatch[1];
  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;

  // Find the slug value in the line
  const slugMatch = line.match(/slug:\s*(.+)$/);
  if (!slugMatch) return null;

  const valueStart = line.indexOf(slugMatch[1]);
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: valueStart },
      end: { line: diagnostic.line, character: valueStart + slugMatch[1].length },
    },
    new_text: correctedSlug,
    description: `Fix slug syntax: \`${slugMatch[1].trim()}\` → \`${correctedSlug}\``,
  };
}

function fixMissingContentForLayout(diagnostic, content, ast) {
  // Find a good insertion point — after <body> if present, or end of file
  const bodyMatch = content.match(/<body[^>]*>/);
  if (bodyMatch) {
    const offset = bodyMatch.index + bodyMatch[0].length;
    const pos = offsetToLineCol(content, offset);
    return {
      type: 'insert',
      range: { start: pos, end: pos },
      new_text: '\n  {{ content_for_layout }}\n',
      description: 'Insert `{{ content_for_layout }}` after `<body>` to render page content',
    };
  }

  // No <body> tag — insert at line 0
  return {
    type: 'insert',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    new_text: '{{ content_for_layout }}\n',
    description: 'Insert `{{ content_for_layout }}` — required for page content to render in layout',
  };
}

function fixMissingReturnInsert(diagnostic, content) {
  const lines = content.split('\n');

  // Find the last {% liquid block or last %} to insert before it
  let insertLine = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '%}') {
      // Insert return before the closing %} of a liquid block
      return {
        type: 'insert',
        range: { start: { line: i, character: 0 }, end: { line: i, character: 0 } },
        new_text: '  return object\n',
        description: 'Add `return object` before the end of the liquid block',
      };
    }
  }

  return {
    type: 'insert',
    range: { start: { line: insertLine, character: 0 }, end: { line: insertLine, character: 0 } },
    new_text: '{% return object %}\n',
    description: 'Add `{% return object %}` at the end of the command',
  };
}

function fixMissingDocBlockInsert(diagnostic, content, ast) {
  // Determine insertion point: after front matter, or line 0
  const fmEnd = ast ? findFrontMatterEnd(ast, content) : null;
  const insertLine = fmEnd ? fmEnd.line + 1 : 0;

  return {
    type: 'insert',
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    new_text: '{% doc %}\n  @param {object} param_name - Description\n{% enddoc %}\n\n',
    description: 'Add `{% doc %}` block to document parameters',
    _source: 'MissingDocBlock',
  };
}

function fixMissingSlugInsert(diagnostic, content, filePath) {
  const slug = slugFromPath(filePath);
  const slugLine = `slug: ${slug}\n`;

  // Check if there's already a front matter block
  const hasFrontMatter = content.startsWith('---\n');

  if (hasFrontMatter) {
    // Insert slug after the opening ---
    return {
      type: 'insert',
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      new_text: slugLine,
      description: slug
        ? `Add \`slug: ${slug}\` to front matter`
        : 'Add `slug:` to front matter to define the URL explicitly',
    };
  }

  // No front matter — create one
  return {
    type: 'insert',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    new_text: `---\n${slugLine}---\n`,
    description: slug
      ? `Add front matter with \`slug: ${slug}\``
      : 'Add front matter with `slug:` to define the URL',
  };
}

function fixShopifyObject(diagnostic) {
  const msg = diagnostic.message || '';

  // Extract the Shopify object name
  const nameMatch = msg.match(/`(\w+)`/);
  const name = nameMatch ? nameMatch[1] : 'object';

  return {
    type: 'guidance',
    description: `\`${name}\` is a Shopify theme object. In platformOS: use \`{% graphql %}\` to fetch data from your schema, \`context.params\` for request parameters, \`context.current_user\` for user data.`,
  };
}

const TYPE_ALIASES = {
  int: 'integer', number: 'integer', num: 'integer',
  double: 'float', decimal: 'float',
  bool: 'boolean',
  str: 'string', varchar: 'string', char: 'string',
  timestamp: 'datetime', time: 'datetime',
  file: 'upload', image: 'upload', attachment: 'upload', blob: 'upload',
  json: 'text', object: 'text', hash: 'text',
  list: 'array',
};

function fixSchemaPropertyType(diagnostic, content) {
  const msg = diagnostic.message || '';

  // Extract the invalid type and suggestion from message
  const typeMatch = msg.match(/`(\w+)`.*Did you mean `(\w+)`/);
  if (typeMatch) {
    const [, invalidType, suggestedType] = typeMatch;
    const lines = content.split('\n');
    const line = lines[diagnostic.line];
    if (line) {
      const typeIdx = line.indexOf(invalidType);
      if (typeIdx >= 0) {
        return {
          type: 'text_edit',
          range: {
            start: { line: diagnostic.line, character: typeIdx },
            end: { line: diagnostic.line, character: typeIdx + invalidType.length },
          },
          new_text: suggestedType,
          description: `Fix property type: \`${invalidType}\` → \`${suggestedType}\``,
        };
      }
    }
  }

  // Try our own alias lookup
  const rawTypeMatch = msg.match(/`(\w+)`/);
  if (rawTypeMatch) {
    const invalidType = rawTypeMatch[1];
    const suggestion = TYPE_ALIASES[invalidType.toLowerCase()];
    if (suggestion) {
      const lines = content.split('\n');
      const line = lines[diagnostic.line];
      if (line) {
        const typeIdx = line.indexOf(invalidType);
        if (typeIdx >= 0) {
          return {
            type: 'text_edit',
            range: {
              start: { line: diagnostic.line, character: typeIdx },
              end: { line: diagnostic.line, character: typeIdx + invalidType.length },
            },
            new_text: suggestion,
            description: `Fix property type: \`${invalidType}\` → \`${suggestion}\``,
          };
        }
      }
    }
  }

  return null;
}

function fixInvalidFrontMatter(diagnostic, content) {
  const msg = diagnostic.message || '';
  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;

  // For misleading keys (errors), suggest removal
  if (diagnostic.severity === 'error') {
    // Extract the key name
    const keyMatch = msg.match(/`(\w+)`/);
    if (keyMatch) {
      return {
        type: 'text_edit',
        range: {
          start: { line: diagnostic.line, character: 0 },
          end: { line: diagnostic.line, character: line.length },
        },
        new_text: '', // Remove the line
        description: `Remove invalid front matter key \`${keyMatch[1]}\` — ${msg}`,
      };
    }
  }

  return null;
}

function extractLayoutPath(message) {
  // The structural emitter (`validateLayout` in structural-warnings.js) has
  // access to projectDir and detects whether the project standardised on
  // `.liquid` or `.html.liquid` for layouts. It bakes the full expected
  // file path into the message ("Expected file: `app/views/layouts/X.liquid`"),
  // so the right thing here is to lift that path verbatim — never re-derive.
  const expected = message?.match(/Expected file:\s*`([^`]+)`/);
  if (expected) return expected[1];

  // Defensive fallback: only used when the message shape changes upstream.
  // We bias toward `.liquid` (the modern shape) and ignore module layouts —
  // an agent shouldn't be creating files inside an installed module anyway.
  const layoutName = message?.match(/`([^`]+)`.*not found/)?.[1];
  return layoutName ? `app/views/layouts/${layoutName}.liquid` : 'app/views/layouts/application.liquid';
}

/**
 * Heuristic fix for TranslationKeyExists.
 *
 * Scope (intentionally narrow): produce an actionable text_edit when the
 * upstream LSP message contains a "Did you mean 'X'" suggestion AND we
 * can locate the offending quoted key on the diagnostic's line. This is
 * a complement to the rule-engine `TranslationKeyExists.suggest_nearest`
 * — the rule emits guidance, the heuristic emits the diff.
 *
 * Cases the rule engine OWNS (heuristic must NOT duplicate):
 *   - `foo[0]` array-index misuse → `TranslationKeyExists.array_index_misuse`
 *   - generic Levenshtein guidance text → `TranslationKeyExists.suggest_nearest`
 *
 * Returning null means "no heuristic fix available" — the rule fix (if any)
 * stands alone. This is the correct behavior when we can't produce an
 * actionable edit.
 */
function fixTranslationKeyExists(diagnostic, content) {
  const msg = diagnostic.message || '';
  const wrongKeyMatch = msg.match(/['"`]([^'"`]+)['"`]/);
  const wrongKey = wrongKeyMatch ? wrongKeyMatch[1] : null;

  // Array-index misuse is owned by the rule engine. Don't emit guidance
  // here — it would duplicate (and risk diverging from) the rule's hint.
  if (wrongKey && /\[\d+\]/.test(wrongKey)) return null;

  // When the LSP message carries a "did you mean 'X'" suggestion AND we can
  // locate the quoted key on the line, produce a text_edit. This is the
  // ONLY case where the heuristic outranks rule guidance, because text_edits
  // are actionable diffs the rule layer cannot produce.
  const suggestMatch = msg.match(/[Dd]id you mean\s+['"`]([^'"`]+)['"`]/);
  if (suggestMatch && wrongKey && wrongKey !== suggestMatch[1]) {
    const suggestedKey = suggestMatch[1];
    const lines = content.split('\n');
    const line = lines[diagnostic.line];
    if (line) {
      for (const pattern of [`'${wrongKey}'`, `"${wrongKey}"`]) {
        const idx = line.indexOf(pattern);
        if (idx >= 0) {
          const quote = pattern[0];
          return {
            type: 'text_edit',
            range: {
              start: { line: diagnostic.line, character: idx },
              end: { line: diagnostic.line, character: idx + pattern.length },
            },
            new_text: `${quote}${suggestedKey}${quote}`,
            description: `Replace \`${wrongKey}\` with \`${suggestedKey}\``,
          };
        }
      }
    }
  }

  // Generic guidance is the safety net for the case where the rule engine
  // is not registered / facts are missing. In normal operation the merge
  // loop in validate-code.js DROPS this guidance because the rule engine
  // produces an attributed equivalent. See the precedence comment there.
  return {
    type: 'guidance',
    description: 'Translation key not found. Add it to app/translations/en.yml, or check for typos in the key name.',
  };
}

// ── {% doc %} block generation ──────────────────────────────────────────────

/**
 * Merge multiple add_doc_param fixes into a single insertion or update.
 */
function mergeDocParamFixes(paramFixes, content, ast) {
  const uniqueParams = [...new Set(paramFixes.map(f => f.param_name))];

  // Check if there's already a {% doc %} block
  const existingDoc = ast ? findDocBlock(ast, content) : null;

  if (existingDoc) {
    // Filter out params that are already declared
    const newParams = uniqueParams.filter(p => !existingDoc.existingParams.includes(p));
    if (newParams.length === 0) {
      return {
        type: 'guidance',
        description: `All parameters (${uniqueParams.join(', ')}) are already declared in {% doc %} block — linter may need a more specific type annotation`,
      };
    }

    // Insert new @param lines before {% enddoc %}
    const paramLines = newParams.map(p => `  @param {object} ${p}`).join('\n');
    // Find the position just before {% enddoc %}
    const enddocMatch = content.indexOf('{% enddoc %}', existingDoc.startOffset);
    if (enddocMatch >= 0) {
      const insertPos = offsetToLineCol(content, enddocMatch);
      return {
        type: 'insert',
        range: { start: insertPos, end: insertPos },
        new_text: paramLines + '\n',
        description: `Add parameter declarations to existing {% doc %} block: ${newParams.join(', ')}`,
        resolves_params: newParams,
      };
    }
  }

  // No existing doc block — create one
  const paramLines = uniqueParams.map(p => `  @param {object} ${p}`).join('\n');
  const docBlock = `{% doc %}\n${paramLines}\n{% enddoc %}\n\n`;

  // Determine insertion point: after front matter, or at line 0
  const fmEnd = ast ? findFrontMatterEnd(ast, content) : null;
  const insertLine = fmEnd ? fmEnd.line + 1 : 0;

  return {
    type: 'insert',
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    new_text: docBlock,
    description: `Add {% doc %} block declaring parameters: ${uniqueParams.join(', ')}`,
    resolves_params: uniqueParams,
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Generate proposed fixes for a set of diagnostics.
 *
 * @param {Array} diagnostics - All errors + warnings
 * @param {object|null} ast - Parsed Liquid AST (null if parse failed)
 * @param {string} content - File content
 * @param {string} filePath - File path (relative to project)
 * @param {object} ctx - { objectsIndex, filtersIndex, tagsIndex, schemaIndex }
 * @returns {{ proposedFixes: Array, diagnosticFixes: Map<number, object> }}
 */
export function generateFixes(diagnostics, ast, content, filePath, ctx, projectDir = null) {
  const proposedFixes = [];
  const diagnosticFixes = new Map();

  const isPartialLike = /\/(partials|commands|queries)\//.test(filePath);

  // Build AST indexes for position lookup
  const varIndex = ast ? indexVariables(ast, content) : [];
  const filterIdx = ast ? indexFilters(ast, content) : [];

  // Collect doc param fixes for merging
  const docParamFixes = [];

  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    let fix = null;

    switch (d.check) {
      case 'UndefinedObject':
        fix = fixUndefinedObject(d, varIndex, isPartialLike, ctx.objectsIndex);
        break;
      case 'UnknownFilter':
        fix = fixUnknownFilter(d, filterIdx, ctx.filtersIndex, ctx.tagsIndex);
        break;
      case 'ConvertIncludeToRender':
        fix = fixConvertInclude(d, content);
        break;
      case 'DeprecatedTag':
        fix = fixDeprecatedTag(d, content);
        break;
      case 'MissingPartial':
        fix = fixMissingPartial(d, projectDir, ast, content);
        break;
      case 'MissingRenderPartialArguments':
        fix = fixMissingRenderPartialArguments(d, ast, content);
        break;
      case 'NestedGraphQLQuery':
        fix = fixNestedGraphQLQuery(d);
        break;
      case 'TranslationKeyExists':
        fix = fixTranslationKeyExists(d, content);
        break;
      case 'ImgLazyLoading':
        fix = fixImgLazyLoading(d, content);
        break;
      case 'ImgWidthAndHeight':
        fix = fixImgWidthAndHeight(d, content);
        break;
      case 'HardcodedRoutes':
        fix = fixHardcodedRoutes(d, content);
        break;
      case 'InvalidHashAssignTarget':
        fix = fixInvalidHashAssignTarget(d, content);
        break;
      case 'MissingAsset':
        fix = fixMissingAsset(d);
        break;
      case 'MetadataParamsCheck':
        fix = fixMetadataParamsCheck(d, ast, content);
        break;
      case 'UnknownProperty':
        fix = fixUnknownProperty(d, ctx.objectsIndex);
        break;
      case 'LiquidHTMLSyntaxError':
        fix = fixLiquidHTMLSyntaxError(d, content);
        break;
      default:
        // pos-supervisor structural checks
        if (d.check?.startsWith('pos-supervisor:')) {
          fix = fixStructuralCheck(d, content, ast, filePath);
        }
        break;
    }

    if (!fix) continue;

    // I1 — rule attribution for heuristic fixes. Tagging once here keeps every
    // per-check branch above free of boilerplate. The emit loop propagates this
    // into the proposed_fixes.rule_id column so Rule Performance can attribute
    // adoption to a specific heuristic variant (heuristic:<Check>.<fix_type>).
    if (!fix.rule_id) {
      fix.rule_id = `heuristic:${d.check ?? 'Unknown'}.${fix.type ?? 'fix'}`;
    }

    if (fix.type === 'add_doc_param') {
      docParamFixes.push({ index: i, ...fix });
      // Attach per-diagnostic fix reference
      diagnosticFixes.set(i, { type: 'add_doc_param', description: fix.description, param_name: fix.param_name, rule_id: fix.rule_id });
    } else {
      diagnosticFixes.set(i, fix);
      // Deduplicate: don't add identical fixes
      const isDupe = proposedFixes.some(f =>
        f.type === fix.type &&
        f.description === fix.description &&
        f.new_text === fix.new_text &&
        f.range?.start?.line === fix.range?.start?.line &&
        f.range?.start?.character === fix.range?.start?.character
      );
      if (!isDupe) proposedFixes.push(fix);
    }
  }

  // Merge all doc param fixes into one insertion
  if (docParamFixes.length > 0) {
    const merged = mergeDocParamFixes(docParamFixes, content, ast);
    // Remove any generic MissingDocBlock insert — the merged fix supersedes it
    for (let j = proposedFixes.length - 1; j >= 0; j--) {
      if (proposedFixes[j]._source === 'MissingDocBlock') {
        proposedFixes.splice(j, 1);
      }
    }
    proposedFixes.push(merged);
    // Update all doc param diagnostic fixes to reference the merged fix
    for (const item of docParamFixes) {
      diagnosticFixes.set(item.index, {
        type: merged.type,
        description: merged.description,
        param_name: item.param_name,
      });
    }
  }

  // Add contextual fix examples (before/after from actual code)
  for (const [diagIdx, fix] of diagnosticFixes) {
    if (fix.type === 'text_edit' && fix.range) {
      const ctx = generateFixContext(fix, content);
      if (ctx) fix.context = ctx;
    }
  }
  for (const fix of proposedFixes) {
    if (fix.type === 'text_edit' && fix.range) {
      const ctx = generateFixContext(fix, content);
      if (ctx) fix.context = ctx;
    }
  }

  return { proposedFixes, diagnosticFixes };
}

/**
 * Generate contextual before/after from the actual code line.
 */
function generateFixContext(fix, content) {
  if (!fix.range?.start || fix.new_text == null) return null;
  const lines = content.split('\n');
  const line = lines[fix.range.start.line];
  if (!line) return null;

  const before = line.trim();
  const startChar = fix.range.start.character;
  const endChar = fix.range.end?.character ?? startChar;
  const after = (line.slice(0, startChar) + fix.new_text + line.slice(endChar)).trim();

  if (before === after) return null;
  return { before, after, line: fix.range.start.line };
}

/**
 * Cluster related diagnostics for reduced noise.
 * Groups by check name + extracts common pattern.
 *
 * @param {Array} errors - Error diagnostics
 * @param {Array} warnings - Warning diagnostics
 * @returns {Array<{ check, count, pattern, message, items }>}
 */
export function clusterDiagnostics(errors, warnings) {
  const all = [
    ...errors.map(e => ({ ...e, _severity: 'error' })),
    ...warnings.map(w => ({ ...w, _severity: 'warning' })),
  ];

  // Group by check name
  const groups = new Map();
  for (const d of all) {
    const key = d.check;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }

  const clusters = [];
  for (const [check, items] of groups) {
    if (items.length < 2) continue; // Only cluster 2+

    // Extract common pattern from messages
    let pattern = null;
    let unifiedFix = null;

    if (check === 'UndefinedObject') {
      // Extract variable names
      const vars = items.map(d => {
        const m = d.message?.match(/['"`]([^'"`]+)['"`]/);
        return m ? m[1] : null;
      }).filter(Boolean);

      // Check if they share a common prefix (e.g., all context.* objects)
      const contextVars = vars.filter(v => ['params', 'session', 'current_user', 'page', 'location', 'headers', 'environment'].includes(v));
      if (contextVars.length >= 2) {
        pattern = 'context_properties';
        unifiedFix = `These are all \`context\` sub-objects. Prefix each with \`context.\`: ${contextVars.map(v => `\`context.${v}\``).join(', ')}.`;
      }
    }

    if (check === 'UnknownFilter') {
      pattern = 'multiple_unknown_filters';
      const names = items.map(d => {
        const m = d.message?.match(/`([^`]+)`/);
        return m ? m[1] : null;
      }).filter(Boolean);
      if (names.length >= 2) {
        unifiedFix = `${names.length} unknown filters found: ${names.map(n => `\`${n}\``).join(', ')}. Check for Shopify-specific filters and typos.`;
      }
    }

    if (pattern) {
      clusters.push({
        check,
        count: items.length,
        pattern,
        unified_fix: unifiedFix,
        items: items.map(d => ({
          line: d.line,
          column: d.column,
          message: d.message,
          fix: d.fix,
        })),
      });
    }
  }

  return clusters;
}

/**
 * Generate an architecture scorecard based on structural analysis.
 *
 * @param {object} structural - Extracted structural info
 * @param {string} domain - File domain
 * @param {Array} errors - Current errors
 * @param {Array} warnings - Current warnings
 * @returns {Array<{ level: string, message: string }>}
 */
export function generateScorecard(structural, domain, errors, warnings) {
  const notes = [];
  if (!structural) return notes;

  const queryCount = structural.graphql_queries?.length ?? 0;
  const renderCount = structural.renders?.length ?? 0;
  const filterCount = structural.filters_used?.length ?? 0;
  const tagCount = structural.tags_used?.length ?? 0;
  const transKeyCount = structural.translation_keys?.length ?? 0;

  // Pages: multiple queries → consider consolidation
  if (domain === 'pages' && queryCount >= 3) {
    notes.push({
      level: 'advisory',
      message: `Page runs ${queryCount} GraphQL queries — consider consolidating into fewer queries or using a command to orchestrate data fetching.`,
    });
  }

  // Pages: no renders but likely has content → extract to partials
  if (domain === 'pages' && renderCount === 0 && tagCount > 3) {
    notes.push({
      level: 'advisory',
      message: 'Page renders 0 partials. Extract reusable HTML into partials for better maintainability.',
    });
  }

  // Commands: no error handling
  if (domain === 'commands' && queryCount > 0) {
    const hasTry = structural.tags_used?.includes('try');
    const hasIfErrors = errors.length === 0 && !hasTry;
    if (hasIfErrors) {
      notes.push({
        level: 'advisory',
        message: 'Command runs GraphQL queries but has no `{% try %}` error handling. Wrap queries in `{% try %}...{% catch error %}` to handle failures gracefully.',
      });
    }
  }

  // Partials: large number of parameters (potential code smell)
  if (domain === 'partials' && structural.prompts?.length > 0) {
    // Count @param declarations from prompts
    const paramCount = structural.prompts.reduce((count, p) => count + (p.match(/@param/g)?.length ?? 0), 0);
    if (paramCount >= 8) {
      notes.push({
        level: 'advisory',
        message: `Partial declares ${paramCount} parameters — consider splitting into smaller, focused partials.`,
      });
    }
  }

  // High translation key count → check for missing translations
  if (transKeyCount >= 10) {
    notes.push({
      level: 'advisory',
      message: `File uses ${transKeyCount} translation keys — verify all keys exist in translation files.`,
    });
  }

  // Many renders → good structure, but check for over-abstraction
  if (renderCount >= 8) {
    notes.push({
      level: 'advisory',
      message: `File renders ${renderCount} partials — ensure each partial serves a distinct purpose and nesting isn't too deep.`,
    });
  }

  return notes;
}
