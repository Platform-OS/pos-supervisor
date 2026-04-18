import { getHint } from './hint-loader.js';
import { extractParams, templateOf } from './diagnostic-record.js';
import { isShopifyObject, isShopifyFilter, getShopifyObject, getShopifyFilter } from './knowledge-loader.js';
import { runRules, hasRules } from './rules/engine.js';

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
export async function enrichError(diagnostic, { uri, lsp, filtersIndex, objectsIndex, tagsIndex, schemaIndex, analyticsStore, content, _hoverCache, factGraph, filePath }) {
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

  // 2b. Rule engine — when rules exist for this check and a fact graph is
  //     available, run rules first. If a rule matches, use its output for
  //     hint/see_also/rule_id and skip the regex-based enrichment below.
  if (factGraph && hasRules(diagnostic.check)) {
    const params = extractParams(diagnostic.check, diagnostic.message);
    const tmplFp = templateOf(diagnostic.check, diagnostic.message);
    const diag = { check: diagnostic.check, params, message: diagnostic.message, file: filePath, line: diagnostic.line, template_fp: tmplFp };
    const facts = { graph: factGraph, filtersIndex, objectsIndex, tagsIndex, schemaIndex, analyticsStore };
    const ruleResult = runRules(diag, facts);
    if (ruleResult) {
      result.hint = ruleResult.hint_md;
      result.rule_id = ruleResult.rule_id;
      if (ruleResult.suggestion) result.suggestion = ruleResult.suggestion;
      if (ruleResult.see_also) result.see_also = ruleResult.see_also;
      if (ruleResult.confidence != null) result.confidence = ruleResult.confidence;
      if (ruleResult.case_base_signal) result.case_base_signal = ruleResult.case_base_signal;
      attachSeeAlso(result, content);
      return result;
    }
  }

  // 3. Index lookup for suggestions + Shopify awareness
  if (diagnostic.check === 'UnknownFilter') {
    const filterName = extractParams(diagnostic.check, diagnostic.message).filter ?? null;
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
    const varName = extractParams(diagnostic.check, diagnostic.message).variable ?? null;
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
    const _tp = extractParams(diagnostic.check, diagnostic.message);
    const key = _tp.key ?? null;
    const hasSuggestion = _tp.has_typo_suggestion === 'true';
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
    const partialName = extractParams(diagnostic.check, diagnostic.message).partial ?? null;
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
    const { property: propertyName = null, object: objectName = null } = extractParams(diagnostic.check, diagnostic.message);
    const propVariant = uri?.includes('/partials/') ? 'partial' : null;
    result.hint = (propertyName && objectName)
      ? getHint(diagnostic.check, propVariant, {
          property_name: propertyName,
          object_name: objectName,
        })
      : getHint(diagnostic.check, propVariant);
  }

  if (diagnostic.check === 'DeprecatedTag') {
    const { tag: tagName = null, replacement: replacementTag = null } = extractParams(diagnostic.check, diagnostic.message);
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
    const { partial: partialName = null, missing_param: missingParam = null } = extractParams(diagnostic.check, diagnostic.message);
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
    const varName = extractParams(diagnostic.check, diagnostic.message).variable ?? null;
    result.hint = varName
      ? getHint(diagnostic.check, null, { var_name: varName })
      : getHint(diagnostic.check, null);
  }

  // Fallback hint for check types without a specific enrichment block
  if (result.hint === null) {
    result.hint = getHint(diagnostic.check, null);
  }

  // Route diagnostics to the right reference via a structured see_also field.
  // Prose hints get skipped by agents; structured fields get acted on.
  // See roadmap Fix 3 and the table in the plan.
  attachSeeAlso(result, content);

  return result;
}

/**
 * Attach a structured `see_also` field pointing at the authoritative source
 * for this diagnostic — usually a `domain_guide` call, occasionally
 * `module_info`. MUST be a structured object (tool + args), NOT embedded prose,
 * because agents react reliably to fields and ignore prose advice.
 *
 * This is the "catch the agent at error-fix time and route them to the right
 * guide" intervention from the roadmap: agents that skip domain_guide at plan
 * time see see_also.reason + see_also.call at validate_code time and typically
 * follow it.
 *
 * @param {object} diagnostic — mutated in place
 * @param {string} [content] — file content (optional, for route-slug heuristics)
 */
export function attachSeeAlso(diagnostic, content) {
  if (!diagnostic || typeof diagnostic !== 'object') return;
  if (diagnostic.see_also) return; // never overwrite an explicit route

  const check = diagnostic.check;
  const message = diagnostic.message ?? '';

  // Shopify contamination → partials gotchas.
  // Identified either by suggestion text mentioning Shopify, or by the
  // UndefinedObject-shopify hint variant. Either signal means the diagnostic
  // is about a Shopify-ism in otherwise valid Liquid.
  if (check === 'UndefinedObject' && /shopify/i.test(diagnostic.suggestion ?? '')) {
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: 'partials', section: 'gotchas' },
      reason: 'Shopify object detected — platformOS uses context.* objects, not shop/cart/customer/product/collection. domain_guide(partials, gotchas) lists every deprecated/forbidden identifier.',
    };
    return;
  }

  // Deprecated {% include %} tag.
  if (check === 'DeprecatedTag' && /include/i.test(message)) {
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: 'partials', section: 'gotchas' },
      reason: '{% include %} is deprecated in platformOS. Use {% render %} for isolated scope or {% function %} for module helpers. domain_guide(partials, gotchas) has the full deprecated-tag list.',
    };
    return;
  }

  // Missing module partial — route to module_info for the authoritative call path.
  if (check === 'MissingPartial') {
    const nameMatch = message.match(/['"]([^'"]+)['"]/);
    const partialName = nameMatch?.[1];
    if (partialName?.startsWith('modules/')) {
      const moduleName = partialName.split('/')[1];
      diagnostic.see_also = {
        tool: 'module_info',
        args: { name: moduleName, section: 'api' },
        reason: `Module partial '${partialName}' not found. module_info(${moduleName}, api) returns the live-scanned call paths and signatures from the installed module — stale memory of module paths is the #1 reason for this error.`,
      };
      return;
    }
  }

  // Missing param on render/function — route to the relevant domain API section.
  // forms/* partials use form-specific conventions documented in the forms guide;
  // everything else falls back to the partials guide.
  if (check === 'MetadataParamsCheck' || check === 'MissingRenderPartialArguments') {
    const isFormPartial = /['"]modules\/common-styling\/forms\//.test(content ?? '') ||
                          /['"][^'"]*forms\/[^'"]+['"]/.test(content ?? '');
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: isFormPartial ? 'forms' : 'partials', section: 'api' },
      reason: isFormPartial
        ? 'Form partial call is missing required params. domain_guide(forms, api) lists every form helper signature (error_list, error_input_handler, etc.).'
        : 'Render call is missing required params. domain_guide(partials, api) explains how {% doc %} @param declarations interact with render and function calls.',
    };
    return;
  }

  // Missing translation key — route to translations gotchas.
  if (check === 'TranslationKeyExists') {
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: 'translations', section: 'gotchas' },
      reason: 'Translation key not found. domain_guide(translations, gotchas) covers locale nesting, key derivation, and dot-notation conventions.',
    };
    return;
  }

  // Hardcoded auth routes — common Shopify/Rails contamination. /sessions
  // and /users are the two specific slugs that route to the wrong place in
  // platformOS (correct forms are /sessions/new and /users/new).
  if (check === 'HardcodedRoutes') {
    const looksAuth = /\/sessions\b|\/users\b|\/login\b|\/signup\b|\/register\b/i.test(message);
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: looksAuth
        ? { domain: 'authentication', section: 'patterns' }
        : { domain: 'routing', section: 'patterns' },
      reason: looksAuth
        ? 'Auth route detected. platformOS uses /sessions/new (not /sessions) and /users/new (not /users). domain_guide(authentication, patterns) has the correct URLs and ownership patterns.'
        : 'Hardcoded route. domain_guide(routing, patterns) explains slug conventions and how to use link_to helpers.',
    };
    return;
  }
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

// Extraction functions (extractFilterName, extractTranslationKey,
// extractPartialName, extractPropertyAndObject, extractDeprecatedTagInfo,
// extractMissingArgInfo) have been centralized into diagnostic-record.js
// extractParams(). See roadmap §A2.

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
