import { getHint } from './hint-loader.js';
import { extractVarName } from './objects-index.js';
import { isShopifyObject, isShopifyFilter, getShopifyObject, getShopifyFilter } from './knowledge-loader.js';

/**
 * Extract readable text from LSP hover result.
 */
function extractHoverText(result) {
  if (!result?.contents) return null;
  const c = result.contents;
  if (typeof c === 'string') return c;
  if (Array.isArray(c))
    return c.map((x) => (typeof x === 'string' ? x : (x.value ?? ''))).join('\n\n');
  return c.value ?? null;
}

/**
 * Enrich a single linter diagnostic with hint, LSP data, and index suggestions.
 *
 * @param {object} diagnostic - { check, severity, message, line, column }
 * @param {object} ctx
 * @param {string} ctx.uri - File URI for LSP requests
 * @param {object} ctx.lsp - PlatformOSLSPClient instance
 * @param {object} ctx.filtersIndex
 * @param {object} ctx.objectsIndex
 * @param {object} ctx.tagsIndex
 * @param {object} ctx.schemaIndex
 * @returns {Promise<object>} Enriched diagnostic
 */
export async function enrichError(diagnostic, { uri, lsp, filtersIndex, objectsIndex, tagsIndex, schemaIndex, content, _hoverCache }) {
  const result = { ...diagnostic };

  // 1. Hint set per-check below with template vars; fallback for unhandled checks at end
  result.hint = null;

  // 2. LSP hover at error position (use cache from enrichAll, or fetch directly)
  if (diagnostic.line != null) {
    const posKey = `${diagnostic.line}:${diagnostic.column ?? 0}`;
    if (_hoverCache?.has(posKey)) {
      const cached = _hoverCache.get(posKey);
      if (cached) result.hover_docs = cached;
    } else if (lsp?.initialized) {
      try {
        const hover = await lsp.hover(uri, diagnostic.line, diagnostic.column ?? 0);
        const text = extractHoverText(hover);
        if (text) result.hover_docs = text;
      } catch {
        // LSP hover failed — skip
      }
    }
  }

  // 3. Index lookup for suggestions + Shopify awareness
  if (diagnostic.check === 'UnknownFilter') {
    const filterName = extractFilterName(diagnostic.message);
    let suggestion = null;
    if (filterName) {
      if (tagsIndex?.isTag(filterName)) {
        suggestion = `\`${filterName}\` is a tag, not a filter. Use \`{% ${filterName} ... %}\` instead of \`| ${filterName}\`.`;
      } else if (isShopifyFilter(filterName)) {
        const info = getShopifyFilter(filterName);
        suggestion = info?.replacement
          ? `\`${filterName}\` is a Shopify filter — not in platformOS. Use \`${info.replacement}\` instead.${info.note ? ` ${info.note}` : ''}`
          : `\`${filterName}\` is a Shopify-specific filter — not in platformOS.${info?.note ? ` ${info.note}` : ''}`;
      } else if (filtersIndex?.loaded) {
        const exact = filtersIndex.lookup(filterName);
        if (exact) {
          suggestion = `Filter \`${exact.name}\` exists: ${exact.syntax || exact.summary}`;
        } else {
          const closest = filtersIndex.closestMatch(filterName);
          if (closest) {
            suggestion = `Did you mean \`${closest.name}\`? ${closest.syntax || closest.summary}`;
          }
        }
      }
    }
    if (suggestion) result.suggestion = suggestion;
    result.hint = filterName
      ? getHint(diagnostic.check, null, {
          filter_name: filterName,
          has_suggestion: !!suggestion,
          suggestion: suggestion ?? '',
        })
      : getHint(diagnostic.check, null);
  }

  if (diagnostic.check === 'UndefinedObject') {
    const varName = extractVarName(diagnostic.message);
    const isPartial = uri?.includes('/partials/');
    // Compute suggestion first so has_suggestion can be passed to hint template
    let suggestion = null;
    let isShopify = false;
    if (varName) {
      if (isShopifyObject(varName)) {
        isShopify = true;
        const info = getShopifyObject(varName);
        suggestion = info?.replacement
          ? `\`${varName}\` is a Shopify object. Use: \`${info.replacement}\`${info.note ? ` — ${info.note}` : ''}`
          : `\`${varName}\` is a Shopify theme object — not in platformOS.${info?.note ? ` ${info.note}` : ' Use GraphQL queries to fetch data and `context.*` for request/user data.'}`;
      } else if (objectsIndex?.loaded) {
        const obj = objectsIndex.lookup(varName);
        if (obj) {
          suggestion = `Use \`${obj.handle}\` instead of bare \`${varName}\`. Properties: ${obj.properties.slice(0, 5).join(', ')}`;
        }
      }
    }
    if (suggestion) result.suggestion = suggestion;
    // Pick variant: Shopify objects get dedicated hint (never "declare as @param"),
    // partials get partial variant, pages get default variant
    const objVariant = isShopify ? 'shopify' : (isPartial ? 'partial' : null);
    result.hint = varName
      ? getHint(diagnostic.check, objVariant, {
          var_name: varName,
          has_suggestion: !!suggestion,
          suggestion: suggestion ?? '',
        })
      : getHint(diagnostic.check, isPartial ? 'partial' : null);
  }

  if (diagnostic.check === 'GraphQLCheck') {
    const vars = classifyGraphQLError(diagnostic.message);
    result.hint = getHint(diagnostic.check, null, vars);
  }

  if (diagnostic.check === 'TranslationKeyExists') {
    const key = extractTranslationKey(diagnostic.message);
    // Check if the linter message already contains a typo suggestion ("Did you mean...")
    const hasSuggestion = key && /did you mean/i.test(diagnostic.message);
    if (key) {
      result.hint = getHint(diagnostic.check, null, {
        key,
        yaml_snippet: buildYamlSnippet(key),
        yaml_path_comment: key.split('.').join(' > '),
        has_suggestion: hasSuggestion,
      });
    }
  }

  if (diagnostic.check === 'MissingPartial') {
    const partialName = extractPartialName(diagnostic.message);
    const objType = detectObjectType(partialName);
    const createPath = buildCreatePath(objType, partialName);
    const tag = objType === 'partial' ? 'render' : 'function';
    const hintVariant = objType === 'module' ? 'module' : null;

    // For module paths: fetch LSP completions to show available paths.
    // For project paths: agent has project_map context — no completions needed.
    let suggestion = null;
    if (objType === 'module' && partialName && lsp?.initialized && content && diagnostic.line != null) {
      const lines = content.split('\n');
      const lineContent = lines[diagnostic.line] ?? '';
      const squoteIdx = lineContent.indexOf(`'${partialName}'`);
      const dquoteIdx = lineContent.indexOf(`"${partialName}"`);
      const quoteIdx = squoteIdx >= 0 ? squoteIdx : dquoteIdx;
      if (quoteIdx >= 0) {
        const col = quoteIdx + 1;
        try {
          const completionResult = await lsp.completions(uri, diagnostic.line, col);
          const labels = extractCompletionLabels(completionResult);
          if (labels.length > 0) {
            const moduleParts = partialName.split('/');
            const modulePrefix = moduleParts.length >= 2 ? `${moduleParts[0]}/${moduleParts[1]}/` : '';
            const inSameModule = modulePrefix ? labels.filter(l => l.startsWith(modulePrefix)) : [];
            // Only suggest paths from the SAME module — don't fall back to unrelated project paths
            if (inSameModule.length > 0) {
              const filtered = inSameModule.slice(0, 8);
              suggestion = `'${partialName}' not found in module. Available: ${filtered.join(', ')}`;
            }
          }
        } catch {
          // LSP completions failed — no suggestions
        }
      }
    }
    if (suggestion) result.suggestion = suggestion;

    result.hint = partialName
      ? getHint(diagnostic.check, hintVariant, {
          object: objType,
          name: partialName,
          create_path: createPath,
          tag,
          has_suggestion: !!suggestion,
        })
      : getHint(diagnostic.check, hintVariant);
  }

  if (diagnostic.check === 'UnknownProperty') {
    const { propertyName, objectName } = extractPropertyAndObject(diagnostic.message);
    const propVariant = uri?.includes('/partials/') ? 'partial' : null;
    result.hint = (propertyName && objectName)
      ? getHint(diagnostic.check, propVariant, {
          property_name: propertyName,
          object_name: objectName,
        })
      : getHint(diagnostic.check, propVariant);
  }

  if (diagnostic.check === 'DeprecatedTag') {
    const { tagName, replacementTag } = extractDeprecatedTagInfo(diagnostic.message);
    result.hint = tagName
      ? getHint(diagnostic.check, null, {
          tag_name: tagName,
          replacement_tag: replacementTag ?? '',
        })
      : getHint(diagnostic.check, null);

    // Override the LSP message for deprecated tags — the LSP shows "Invalid syntax
    // for tag 'X'. Expected syntax: ..." which implies the tag is still usable.
    // Replace with a clear deprecation message to avoid contradicting our hint.
    if (tagName && /Expected syntax/i.test(diagnostic.message)) {
      const REPLACEMENTS = {
        hash_assign: "{% assign hash[\"key\"] = \"value\" %} (platformOS assign supports bracket/dot notation)",
        parse_json: "{% assign obj = { \"key\": \"value\" } %} (use assign with hash/array literals)",
        include: "{% render 'partial', var: value %} (render has isolated scope — pass all variables explicitly)",
      };
      const replacement = REPLACEMENTS[tagName];
      result.message = replacement
        ? `'{% ${tagName} %}' is deprecated and will be removed. Replace with: ${replacement}.`
        : `'{% ${tagName} %}' is deprecated and will be removed.`;
    }
  }

  if (diagnostic.check === 'MissingRenderPartialArguments') {
    const { partialName, missingParam } = extractMissingArgInfo(diagnostic.message);
    result.hint = (partialName || missingParam)
      ? getHint(diagnostic.check, null, {
          partial_name: partialName ?? 'unknown',
          missing_param: missingParam ?? 'unknown',
        })
      : getHint(diagnostic.check, null);
  }

  if (diagnostic.check === 'MetadataParamsCheck') {
    // Distinguish function calls (queries/commands) from render calls (partials)
    const isFunctionCall = /function call/i.test(diagnostic.message);
    result.hint = getHint(diagnostic.check, null, {
      is_function_call: isFunctionCall,
    });
  }

  if (diagnostic.check === 'UnusedAssign') {
    const varName = extractVarName(diagnostic.message);
    result.hint = varName
      ? getHint(diagnostic.check, null, { var_name: varName })
      : getHint(diagnostic.check, null);
  }

  // Fallback hint for check types without a specific enrichment block
  if (result.hint === null) {
    result.hint = getHint(diagnostic.check, null);
  }

  return result;
}

/**
 * Classify a GraphQL error message into a category with extracted variables.
 * Returns template vars for the GraphQLCheck hint template.
 */
function classifyGraphQLError(message) {
  if (!message) return { category_generic: true };

  // Unused variable: "Variable "$foo" is never used in operation "bar"."
  const unusedMatch = message.match(/Variable\s+["']?\$(\w+)["']?\s+is never used/i);
  if (unusedMatch) {
    return { category_unused_var: true, var_name: unusedMatch[1] };
  }

  // Unknown field: "Cannot query field "foo" on type "Bar"."
  const fieldMatch = message.match(/Cannot query field\s+["']?(\w+)["']?\s+on type\s+["']?(\w+)["']?/i);
  if (fieldMatch) {
    const isRecord = fieldMatch[2] === 'Record';
    return {
      // Flat categories — no nesting in template
      [`category_unknown_field_${isRecord ? 'record' : 'other'}`]: true,
      field_name: fieldMatch[1],
      type_name: fieldMatch[2],
    };
  }

  // Type mismatch: "Variable "$id" of type "ID!" used in position expecting type "UniqIdFilter"."
  const typeMismatch = message.match(/Variable\s+["']?\$(\w+)["']?\s+of type\s+["']?([^"']+)["']?\s+used in position expecting(?: type)?\s+["']?([^"'.]+)["']?/i);
  if (typeMismatch) {
    const expectedType = typeMismatch[3].trim();
    const isFilter = /filter/i.test(expectedType);
    return {
      [`category_type_mismatch_${isFilter ? 'filter' : 'other'}`]: true,
      var_name: typeMismatch[1],
      actual_type: typeMismatch[2],
      expected_type: expectedType,
    };
  }

  // Filter type: "Expected value of type "StringFilter", found "product"."
  const filterMatch = message.match(/Expected value of type\s+["']?(\w+)["']?,?\s+found\s+["']?([^"'.]+)["']?/i);
  if (filterMatch) {
    const isFilter = /filter/i.test(filterMatch[1]);
    return {
      [`category_type_mismatch_${isFilter ? 'filter' : 'other'}`]: true,
      var_name: filterMatch[2].trim(),
      actual_type: `"${filterMatch[2].trim()}"`,
      expected_type: filterMatch[1],
    };
  }

  // Fallback — generic hint
  return { category_generic: true };
}

/**
 * Extract property name and object name from an UnknownProperty error message.
 * Handles: "Unknown property 'foo' on 'bar'", "property `foo` ... `bar`", etc.
 */
function extractPropertyAndObject(message) {
  if (!message) return { propertyName: null, objectName: null };
  const bt = message.match(/`([^`]+)`[^`]*`([^`]+)`/);
  const dq = message.match(/"([^"]+)"[^"]*"([^"]+)"/);
  const sq = message.match(/'([^']+)'[^']*'([^']+)'/);
  const m = bt || dq || sq;
  return m ? { propertyName: m[1], objectName: m[2] } : { propertyName: null, objectName: null };
}

/**
 * Extract tag name and replacement from a DeprecatedTag error message.
 */
function extractDeprecatedTagInfo(message) {
  if (!message) return { tagName: null, replacementTag: null };
  const tagMatch = message.match(/[`'"](\w+)[`'"]/) || message.match(/\btag\s+[`'"]?(\w+)[`'"]?/i);
  const tagName = tagMatch ? tagMatch[1] : null;
  // Match "replaced by `render`" or "use `render`" — but NOT "use the way" or "reduces"
  const replMatch = message.match(/replaced\s+by\s+\[?[`'"](\w+)[`'"]\]?/i)
                 || message.match(/\buse\s+[`'"](\w+)[`'"]/i);
  const replacementTag = replMatch ? replMatch[1] : (tagName === 'include' ? 'render' : null);
  return { tagName, replacementTag };
}

/**
 * Extract partial name and missing param from a MissingRenderPartialArguments error message.
 */
function extractMissingArgInfo(message) {
  if (!message) return { partialName: null, missingParam: null };
  // Partial name: quoted path containing a slash, e.g. 'products/card'
  const partialMatch = message.match(/[`'"]([^`'"]+\/[^`'"]+)[`'"]/);
  const partialName = partialMatch ? partialMatch[1] : null;
  // Parameter name: matches "argument 'name'" in the actual linter message format:
  // "Missing required argument 'email' in render tag for partial 'sessions/form'"
  const paramMatch = message.match(/\bargument\s+['"`](\w+)['"`]/i);
  const missingParam = paramMatch ? paramMatch[1] : null;
  return { partialName, missingParam };
}

/**
 * Extract filter name from an UnknownFilter error message.
 */
function extractFilterName(message) {
  if (!message) return null;
  const m = message.match(/`([^`]+)`/) || message.match(/"([^"]+)"/) || message.match(/'([^']+)'/);
  return m ? m[1] : null;
}

/**
 * Extract translation key from a TranslationKeyExists error message.
 * Message format: "Translation key 'some.key' not found." or similar.
 */
function extractTranslationKey(message) {
  if (!message) return null;
  const m = message.match(/['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

/**
 * Build an indented YAML snippet showing where to add a translation key.
 * e.g. 'foo.bar.baz' → "  en:\n    foo:\n      bar:\n        baz: \"TODO: translation text\""
 */
function buildYamlSnippet(key) {
  if (!key) return '  en:\n    your_key: "TODO: translation text"';
  const parts = key.split('.');
  const lines = ['  en:'];
  for (let i = 0; i < parts.length; i++) {
    const indent = '  '.repeat(i + 2);
    if (i === parts.length - 1) {
      lines.push(`${indent}${parts[i]}: "TODO: translation text"`);
    } else {
      lines.push(`${indent}${parts[i]}:`);
    }
  }
  return lines.join('\n');
}

/**
 * Extract partial name from a MissingPartial error message.
 */
function extractPartialName(message) {
  if (!message) return null;
  const m = message.match(/['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/**
 * Normalize LSP completion result to an array of label strings.
 * LSP returns either CompletionItem[] or CompletionList { isIncomplete, items }.
 */
function extractCompletionLabels(result) {
  if (!result) return [];
  const items = Array.isArray(result) ? result : (result.items ?? []);
  return items.map(c => c.label ?? c.insertText ?? '').filter(Boolean);
}

/**
 * Detect what kind of platformOS object a missing partial name refers to.
 * @param {string|null} name - e.g. 'blog_posts/indexa', 'lib/commands/products/create', 'modules/core/...'
 * @returns {'partial'|'command'|'query'|'module'}
 */
function detectObjectType(name) {
  if (!name) return 'partial';
  if (name.startsWith('modules/')) return 'module';
  if (/(?:^|\/)commands\//.test(name)) return 'command';
  if (/(?:^|\/)queries\//.test(name)) return 'query';
  return 'partial';
}

/**
 * Build the expected disk path for a missing platformOS file.
 * @param {'partial'|'command'|'query'|'module'} type
 * @param {string|null} name
 * @returns {string}
 */
function buildCreatePath(type, name) {
  if (!name) return '(unknown path)';
  switch (type) {
    case 'command':
    case 'query': {
      // Name may come with or without lib/ prefix — normalize to avoid app/lib/lib/...
      const stripped = name.replace(/^lib\//, '');
      return `app/lib/${stripped}.liquid`;
    }
    case 'module': {
      const moduleName = name.split('/')[1] ?? name;
      return `(install module '${moduleName}' or check modules/${moduleName}/ on disk)`;
    }
    default:        return `app/views/partials/${name}.liquid`;
  }
}

/**
 * Enrich all diagnostics in a check result.
 * Deduplicates LSP hover calls — errors at the same position share one hover result.
 */
export async function enrichAll(diagnostics, ctx) {
  // Pre-fetch hover docs by unique position to avoid duplicate LSP calls
  const hoverCache = new Map();
  if (ctx.lsp?.initialized) {
    const positions = new Set();
    for (const d of diagnostics) {
      if (d.line != null) positions.add(`${d.line}:${d.column ?? 0}`);
    }
    await Promise.all([...positions].map(async (key) => {
      const [line, col] = key.split(':').map(Number);
      try {
        const hover = await ctx.lsp.hover(ctx.uri, line, col);
        const text = extractHoverText(hover);
        // Cache both hits AND misses to prevent duplicate LSP calls in enrichError
        hoverCache.set(key, text ?? null);
      } catch {
        // Mark as attempted so enrichError doesn't retry
        hoverCache.set(key, null);
      }
    }));
  }

  return Promise.all(diagnostics.map(d => enrichError(d, { ...ctx, _hoverCache: hoverCache })));
}
