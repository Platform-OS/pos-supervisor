/**
 * Structural warnings — pos-supervisor intelligence beyond the linter.
 *
 * Detects architectural and platform issues that pos-cli check does not catch:
 *   - HTML in pages (pages should be controller-only)
 *   - GraphQL in partials (partials must not run queries)
 *   - Shopify objects/filters in output not flagged by the linter
 *   - Deprecated tags (parse_json, hash_assign) present in structural analysis
 *   - Filter argument misuse (wrong args for known filters)
 *   - Invalid layout reference (layout file not found on disk)
 *   - Missing {% doc %} block in partials (undocumented parameters)
 *   - Invalid method in front matter (must be lowercase get/post/put/delete/patch)
 *   - Missing return in commands
 *   - Invalid/unknown front matter keys in pages
 *   - Missing slug in pages
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { walk, NodeTypes, NamedTags } from '@platformos/liquid-html-parser';
import { isShopifyObject, isShopifyFilter, getShopifyObject, getShopifyTag } from './knowledge-loader.js';
import { getDomainFromPath } from './domain-detector.js';
import { offsetToLineCol, slugFromPath } from './position-utils.js';

const HTML_NODE_TYPES = new Set([
  NodeTypes.HtmlElement,
  NodeTypes.HtmlVoidElement,
  NodeTypes.HtmlSelfClosingElement,
  NodeTypes.HtmlRawNode,
  NodeTypes.HtmlDoctype,
]);

const DEPRECATED_TAGS = new Set(['parse_json', 'hash_assign', 'include']);

const VALID_PAGE_FRONT_MATTER_KEYS = new Set([
  'slug', 'method', 'layout',
  'metadata', 'response_headers', 'max_deep_level',
  'redirect_to', 'redirect_code',
  'searchable', 'format',
]);

// Keys from other frameworks/ORMs that imply nonexistent platformOS behavior
const MISLEADING_FRONT_MATTER_KEYS = {
  authorization_policies: 'Do NOT use `authorization_policies` in front matter — it is a legacy feature. For access control, use `{% function can = \'modules/user/helpers/can_do\', requester: profile, do: \'action\' %}` or `{% if context.current_user %}` for simple auth checks. Remove this key.',
  cache: '`cache` is not a front matter option. Use `{% cache key, expire: 3600 %}` tag in the page body.',
  title: '`title` is not a top-level front matter key. Use `metadata.title` instead: `metadata:\\n  title: "Page Title"`.',
  description: '`description` is not a top-level front matter key. Use `metadata.description` instead.',
  default_layout: '`default_layout` is not a valid front matter key. Use `layout: application` or omit layout (defaults to `application`).',
  content_type: '`content_type` is not a front matter key. Use the file extension: `.json.liquid` for JSON, `.xml.liquid` for XML, `.csv.liquid` for CSV.',
  expires: '`expires` is not a front matter key. Use `{% cache key, expire: seconds %}` tag.',
};

/**
 * Generate structural warnings from AST + domain context.
 *
 * @param {object} ast — Parsed Liquid AST
 * @param {string} content — File content
 * @param {string} filePath — Absolute file path
 * @param {object} structural — Already-extracted structural info (tags_used, filters_used, etc.)
 * @param {Set<string>} existingChecks — Check names already reported by the linter (to avoid duplicates)
 * @param {object} [options] — Optional context (projectDir for filesystem checks)
 * @returns {Array<{check: string, severity: string, message: string, line: number, column: number}>}
 */
export function generateStructuralWarnings(ast, content, filePath, structural, existingChecks, options = {}) {
  const warnings = [];
  const domain = getDomainFromPath(filePath);

  // 1. HTML in pages — pages should be controller-only (no inline HTML).
  //    Guard: if the page composes partials via {% render %}, the HTML is
  //    usually incidental glue (landing layouts, section wrappers) rather
  //    than a violation. The check had 100% regression in the 2026-04-23
  //    DEMO report because it fired on exactly this pattern. Suppress when
  //    at least one partial is rendered — the composite-page case.
  if (domain === 'pages') {
    const rendersPartials = Array.isArray(structural?.renders_used) && structural.renders_used.length > 0;
    if (!rendersPartials) {
      const htmlWarning = detectHtmlInPage(ast, content);
      if (htmlWarning) warnings.push(htmlWarning);
    }
  }

  // 2. Shopify objects in variable output not caught by linter
  const docParams = new Set(structural?.doc_params ?? []);
  const shopifyWarnings = detectShopifyVariables(ast, content, existingChecks, docParams);
  warnings.push(...shopifyWarnings);

  // 2b. Shopify tags — tags only valid in Shopify Liquid, not in platformOS
  const shopifyTagWarnings = detectShopifyTags(ast, content);
  warnings.push(...shopifyTagWarnings);

  // 3. Deprecated tags present but not flagged by linter
  const deprecationWarnings = detectDeprecatedTags(structural, existingChecks);
  warnings.push(...deprecationWarnings);

  // 4. Filter argument misuse — wrong args for known filters
  const filterArgWarnings = detectFilterArgMisuse(ast, content);
  warnings.push(...filterArgWarnings);

  // 5. Slug validation — wrong dynamic segment syntax, leading slash
  if (domain === 'pages' && structural?.slug) {
    const slugWarnings = validateSlug(structural.slug, content);
    warnings.push(...slugWarnings);
  }

  // 6. GraphQL in partials — partials must not run queries directly
  if (domain === 'partials') {
    const gqlWarning = detectGraphqlInPartial(ast, content);
    if (gqlWarning) warnings.push(gqlWarning);
  }

  // 7. Layout validation — referenced layout must exist on disk
  if (domain === 'pages' && structural?.layout && options.projectDir) {
    const layoutWarning = validateLayout(structural.layout, content, options.projectDir);
    if (layoutWarning) warnings.push(layoutWarning);
  }

  // 8. Missing {% doc %} block in partials — undocumented parameters
  if (domain === 'partials') {
    const docWarning = detectMissingDocBlock(content, structural, domain);
    if (docWarning) warnings.push(docWarning);
  }

  // 9. Method validation — must be lowercase, must be valid HTTP method
  if (domain === 'pages' && structural?.method) {
    const methodWarning = validateMethod(structural.method, content);
    if (methodWarning) warnings.push(methodWarning);

    // 9b. Non-GET pages don't render on browser GET requests. Agents
    //     sometimes set `method: post` on a landing page because they
    //     confuse "this page has a form that POSTs" with "this page
    //     itself is a POST handler". The result: the page loads blank
    //     because browsers do GETs. Flag the pattern when the file
    //     clearly renders user-facing content.
    const nonGetWarning = validateNonGetRenderingPage(structural.method, structural, content);
    if (nonGetWarning) warnings.push(nonGetWarning);
  }

  // 10. Front matter key validation — unknown/misleading keys, missing slug
  if (domain === 'pages') {
    const fmWarnings = validateFrontMatterKeys(content, filePath);
    warnings.push(...fmWarnings);
  }

  // 11. Missing return in commands — commands should return a result
  if (domain === 'commands') {
    const returnWarning = detectMissingReturn(structural);
    if (returnWarning) warnings.push(returnWarning);
  }

  // 12. (Removed per plan B1.5 — 2026-04-23.)
  //     MissingDocBlock previously also fired on commands but the production
  //     sample was 10% resolution / 40% regression: most internal command
  //     files are utility helpers or one-shot scripts with no caller-facing
  //     contract. Keeping the check on partials only — where a missing doc
  //     block is unambiguously a defect because renders need @param signals.

  // 13. Missing {{ content_for_layout }} in layouts — page content won't render
  if (domain === 'layouts') {
    const contentWarning = detectMissingContentForLayout(content);
    if (contentWarning) warnings.push(contentWarning);
  }

  return warnings;
}

/**
 * Detect HTML elements in a page file.
 * Pages should be controller-only — no inline HTML.
 */
function detectHtmlInPage(ast, content) {
  let firstHtmlNode = null;

  walk(ast, (node) => {
    if (firstHtmlNode) return; // Already found one
    if (HTML_NODE_TYPES.has(node.type) && node.position) {
      // Skip HTML comments — those are fine
      if (node.type === NodeTypes.HtmlComment) return;
      firstHtmlNode = node;
    }
  });

  if (!firstHtmlNode) return null;

  const pos = offsetToLineCol(content, firstHtmlNode.position.start);
  return {
    check: 'pos-supervisor:HtmlInPage',
    severity: 'warning',
    message: 'Pages should be controller-only (logic, no inline HTML). Move HTML to a partial and use {% render %}.',
    line: pos.line,
    column: pos.character,
  };
}

/**
 * Detect {% graphql %} tag in a partial file.
 * Partials must not run queries — data should be passed in from pages/commands.
 */
function detectGraphqlInPartial(ast, content) {
  let firstGraphqlNode = null;

  walk(ast, (node) => {
    if (firstGraphqlNode) return;
    if (node.type === NodeTypes.LiquidTag && node.name === NamedTags.graphql && node.position) {
      firstGraphqlNode = node;
    }
  });

  if (!firstGraphqlNode) return null;

  const pos = offsetToLineCol(content, firstGraphqlNode.position.start);
  return {
    check: 'pos-supervisor:GraphqlInPartial',
    severity: 'error',
    message: 'Do NOT run `{% graphql %}` in partials. Partials receive data via explicit variable passing. Move the query to a page or command and pass results to the partial with `{% render "partial", data: query_result %}`.',
    line: pos.line,
    column: pos.character,
  };
}

/**
 * Detect commands without a {% return %} tag.
 * Commands should return a result object.
 */
function detectMissingReturn(structural) {
  if (structural?.tags_used?.includes('return')) return null;

  return {
    check: 'pos-supervisor:MissingReturn',
    severity: 'warning',
    message: 'Command is missing `{% return %}`. Commands should return a result object: `{% return object %}`. Without a return, the caller gets `null`.',
    line: 0,
    column: 0,
  };
}

/**
 * Detect layouts without {{ content_for_layout }}.
 * Every layout must include {{ content_for_layout }} exactly once — it renders the page body.
 * {% yield 'name' %} is separate — it renders named slots and is optional.
 */
function detectMissingContentForLayout(content) {
  if (/\{\{\s*content_for_layout\s*\}\}/.test(content)) return null;

  return {
    check: 'pos-supervisor:MissingContentForLayout',
    severity: 'error',
    message: 'Layout is missing `{{ content_for_layout }}`. Every layout must include this exactly once — it renders the page body. Named slots use `{% yield \'name\' %}` separately.',
    line: 0,
    column: 0,
  };
}

/**
 * Detect partials/commands without a {% doc %} block or @prompt comment.
 * They should document their expected parameters.
 */
function detectMissingDocBlock(content, structural, domain) {
  // Scoped to partials only — commands were producing a high false-positive
  // rate in production (utility commands, one-shot scripts, private helpers
  // with no external callers). See call site comment and plan B1.5.
  if (domain !== 'partials') return null;

  // Has {% doc %} block (parsed by liquid-html-parser as LiquidRawTag 'doc')
  if (structural?.tags_used?.includes('doc')) return null;

  // Has @prompt in a comment block (older convention)
  if (/@prompt\s*:/m.test(content)) return null;

  return {
    check: 'pos-supervisor:MissingDocBlock',
    severity: 'warning',
    message: `Partial is missing a \`{% doc %}\` block. Document expected parameters so callers know what variables to pass. Example: \`{% doc %} @param title {string} Card title {% enddoc %}\`.`,
    line: 0,
    column: 0,
  };
}

/**
 * Detect Shopify-specific objects used in variable outputs ({{ shopify_obj }})
 * that the linter didn't flag as UndefinedObject.
 * @param {Set<string>} docParams — Declared @param names from {% doc %} block (skip these)
 */
function detectShopifyVariables(ast, content, existingChecks, docParams) {
  const warnings = [];
  const seenVars = new Set();

  walk(ast, (node) => {
    if (node.type === NodeTypes.VariableLookup && node.name && node.position) {
      const name = node.name;
      if (seenVars.has(name)) return;

      if (isShopifyObject(name)) {
        // Skip variables declared as @param — the developer chose this name deliberately
        if (docParams.has(name)) return;
        // Check if linter already flagged this variable (avoid duplicate)
        if (!existingChecks.has(`UndefinedObject:${name}`)) {
          seenVars.add(name);
          const pos = offsetToLineCol(content, node.position.start);

          const info = getShopifyObject(name);
          const suggestion = info?.replacement
            ? `\`${name}\` is a Shopify object. Use: \`${info.replacement}\`${info.note ? ` — ${info.note}` : ''}`
            : `\`${name}\` is a Shopify theme object — not in platformOS.${info?.note ? ` ${info.note}` : ' Use GraphQL queries to fetch data and `context.*` for request/user data.'}`;
          const message = `\`${name}\` is a Shopify theme object — it does not exist in platformOS. Use \`{% graphql %}\` to fetch data and \`context.*\` for request/user data.`;

          warnings.push({
            check: 'pos-supervisor:ShopifyObject',
            severity: 'error',
            message,
            suggestion,
            line: pos.line,
            column: pos.character,
          });
        }
      }
    }
  });

  return warnings;
}

/**
 * Detect Shopify-specific tags used in the AST.
 * These are invalid in platformOS and cause LiquidHTMLSyntaxError,
 * but this provides a more specific contextual message.
 */
function detectShopifyTags(ast, content) {
  const warnings = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag || !node.position) return;
    const tagInfo = getShopifyTag(node.name);
    if (!tagInfo) return;
    const pos = offsetToLineCol(content, node.position.start);
    const replacementPart = tagInfo.replacement
      ? ` Use \`{% ${tagInfo.replacement} %}\` instead.`
      : '';
    warnings.push({
      check: 'pos-supervisor:ShopifyTag',
      severity: 'error',
      message: `\`{% ${node.name} %}\` is a Shopify-only tag — not valid in platformOS.${replacementPart} ${tagInfo.note}`.trimEnd(),
      line: pos.line,
      column: pos.character,
    });
  });
  return warnings;
}

/**
 * Detect deprecated tags in structural analysis that the linter didn't flag.
 */
function detectDeprecatedTags(structural, existingChecks) {
  const warnings = [];
  if (!structural?.tags_used) return warnings;

  for (const tag of structural.tags_used) {
    if (!DEPRECATED_TAGS.has(tag)) continue;
    // Skip if linter already flagged this specific tag
    if (existingChecks.has('DeprecatedTag') && (
      (tag === 'parse_json' && existingChecks.has('DeprecatedTag:parse_json')) ||
      (tag === 'hash_assign' && existingChecks.has('DeprecatedTag:hash_assign')) ||
      (tag === 'include' && existingChecks.has('DeprecatedTag:include'))
    )) continue;

    let message;
    if (tag === 'parse_json') {
      message = '`{% parse_json %}` is deprecated. Use `{% assign var = { "key": "value" } %}` for hashes and `{% assign var = ["a", "b"] %}` for arrays.';
    } else if (tag === 'hash_assign') {
      message = '`{% hash_assign %}` is deprecated. Use `{% assign var["key"] = "value" %}` or `{% assign var.key = "value" %}`.';
    } else if (tag === 'include') {
      message = '`{% include %}` is deprecated. Use `{% render %}` instead — render has isolated scope (variables must be passed explicitly). Exception: module helpers that require scope sharing.';
    }

    warnings.push({
      check: 'pos-supervisor:DeprecatedTag',
      severity: 'warning',
      message,
      line: 0,
      column: 0,
    });
  }

  return warnings;
}

/**
 * Validate slug from front matter.
 * Detects wrong dynamic segment syntax and leading slash.
 */
function validateSlug(slug, content) {
  const warnings = [];

  // Find slug line number for better positioning
  const slugLine = findFrontmatterLine(content, 'slug');
  const line = slugLine >= 0 ? slugLine : 0;

  // [param] syntax — Next.js/file-based routing, not platformOS
  const bracketMatch = slug.match(/\[(\w+)\]/);
  if (bracketMatch) {
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug uses \`[${bracketMatch[1]}]\` bracket syntax (Next.js/file-based routing). platformOS uses \`:${bracketMatch[1]}\` for dynamic segments: \`${slug.replace(/\[(\w+)\]/g, ':$1')}\`.`,
      line,
      column: 0,
    });
  }

  // {param} syntax — Express/Swagger style
  const braceMatch = slug.match(/\{(\w+)\}/);
  if (braceMatch) {
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug uses \`{${braceMatch[1]}}\` brace syntax (Express/Swagger style). platformOS uses \`:${braceMatch[1]}\` for dynamic segments: \`${slug.replace(/\{(\w+)\}/g, ':$1')}\`.`,
      line,
      column: 0,
    });
  }

  // <param> syntax — Flask/Angular style
  const angleMatch = slug.match(/<(\w+)>/);
  if (angleMatch) {
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug uses \`<${angleMatch[1]}>\` angle bracket syntax. platformOS uses \`:${angleMatch[1]}\` for dynamic segments: \`${slug.replace(/<(\w+)>/g, ':$1')}\`.`,
      line,
      column: 0,
    });
  }

  // Leading slash — unconventional, may cause routing issues
  if (slug.startsWith('/')) {
    const corrected = slug.replace(/^\/+/, '');
    const hint = corrected === ''
      ? 'For the home page (root `/`), omit the slug line entirely — `app/views/pages/index.liquid` serves `/` by convention without one.'
      : `platformOS slugs are relative: \`${corrected}\`.`;
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug starts with \`/\` — remove the leading slash. ${hint}`,
      line,
      column: 0,
    });
  }

  return warnings;
}

function findFrontmatterLine(content, key) {
  const lines = content.split('\n');
  const re = new RegExp(`^\\s*${key}:\\s`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Validate that a layout referenced in front matter exists on disk.
 */
function validateLayout(layoutName, content, projectDir) {
  // Empty string means "no layout" (disabled) — skip validation
  if (!layoutName) return null;

  // Build candidate file paths
  const candidates = [];

  // Module layout: "modules/{module_name}/{layout_name}"
  const moduleMatch = layoutName.match(/^modules\/([^/]+)\/(.+)$/);
  if (moduleMatch) {
    const [, moduleName, layoutPath] = moduleMatch;
    candidates.push(
      `modules/${moduleName}/public/views/layouts/${layoutPath}.html.liquid`,
      `modules/${moduleName}/public/views/layouts/${layoutPath}.liquid`,
      `modules/${moduleName}/private/views/layouts/${layoutPath}.html.liquid`,
      `modules/${moduleName}/private/views/layouts/${layoutPath}.liquid`,
    );
  } else {
    // Standard app layout
    candidates.push(
      `app/views/layouts/${layoutName}.html.liquid`,
      `app/views/layouts/${layoutName}.liquid`,
    );
  }

  const found = candidates.some(rel => existsSync(join(projectDir, rel)));
  if (found) return null;

  const line = findFrontmatterLine(content, 'layout');
  const expectedPath = moduleMatch
    ? `modules/${moduleMatch[1]}/public/views/layouts/${moduleMatch[2]}.html.liquid`
    : `app/views/layouts/${layoutName}.html.liquid`;
  return {
    check: 'pos-supervisor:InvalidLayout',
    severity: 'warning',
    message: `Layout \`${layoutName}\` not found. Expected file: \`${expectedPath}\`. Check the layout name or create the missing layout file.`,
    line: line >= 0 ? line : 0,
    column: 0,
  };
}

const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

/**
 * Validate method from front matter.
 * Must be lowercase and a valid HTTP method.
 */
function validateMethod(method, content) {
  const line = findFrontmatterLine(content, 'method');
  const lower = method.toLowerCase();

  if (VALID_METHODS.has(method)) return null; // Already valid

  if (VALID_METHODS.has(lower)) {
    // Valid method but wrong case (e.g. POST, Get, DELETE)
    return {
      check: 'pos-supervisor:InvalidMethod',
      severity: 'error',
      message: `Method \`${method}\` must be lowercase: \`${lower}\`. platformOS front matter methods are always lowercase.`,
      line: line >= 0 ? line : 0,
      column: 0,
    };
  }

  // Completely invalid method
  return {
    check: 'pos-supervisor:InvalidMethod',
    severity: 'error',
    message: `Invalid method \`${method}\`. Valid values: \`get\`, \`post\`, \`put\`, \`delete\`, \`patch\`.`,
    line: line >= 0 ? line : 0,
    column: 0,
  };
}

/**
 * Flag pages whose `method` is non-GET but whose body clearly renders
 * HTML / uses a layout. On platformOS these pages will not respond to
 * browser navigation — GET requests get a 404. The agent's usual mistake
 * pattern is `method: post` on a landing page that includes forms; the
 * correct shape is `method: get` (or omit) with the form POSTing to a
 * command endpoint.
 *
 * Intentionally permissive: if the page is clearly an API endpoint
 * (returns JSON, slug under /api/, filename suggests an action), skip
 * the warning. Trust the developer when the signal is strong.
 */
function validateNonGetRenderingPage(method, structural, content) {
  const lower = (method || '').toLowerCase();
  if (lower === 'get' || lower === '') return null;
  if (!['post', 'put', 'delete', 'patch'].includes(lower)) return null;

  const line = findFrontmatterLine(content, 'method');
  const slug = (structural?.slug || '').toLowerCase();

  // API heuristics — skip warning if the page is clearly a backend endpoint.
  const hasLayout = !!structural?.layout;
  const rendersPartials = Array.isArray(structural?.renders_used) && structural.renders_used.length > 0;
  const hasOutput = /\{\{/.test(content);
  const hasHtmlTags = /<(html|body|div|main|section|article|form|h[1-6]|p|ul|ol|nav|header|footer)\b/i.test(content);

  // If the page has no layout, no renders, no {{ ... }} outputs, and no HTML,
  // it's almost certainly a JSON/redirect endpoint. Respect that.
  const looksLikeUiPage = hasLayout || rendersPartials || hasOutput || hasHtmlTags;
  if (!looksLikeUiPage) return null;

  // Agent-convention API slugs: `/api/...`, `/_/…`, explicit verb suffixes.
  if (/^\/?(api|_|internal)\//i.test(slug)) return null;

  return {
    check: 'pos-supervisor:NonGetRenderingPage',
    severity: 'warning',
    message: `Page has \`method: ${lower}\` but renders HTML (layout, partials, or {{ ... }} output). Browser GETs to this URL return 404 — only ${lower.toUpperCase()} requests reach the handler. If this page should display content, remove the \`method\` field (defaults to \`get\`). If it's a form endpoint, move the handler to \`app/lib/commands/\` and have the form \`POST\` there.`,
    line: line >= 0 ? line : 0,
    column: 0,
  };
}

/**
 * Detect whether a page file is the root/index page that serves `/` by
 * convention — these do not need a slug in their front matter.
 */
function isRootIndexPage(filePath) {
  if (!filePath) return false;
  const basename = filePath.split('/').pop();
  return basename === 'index.liquid' || basename === 'index.html.liquid';
}

/**
 * Validate front matter keys and check for missing slug.
 * Parses the YAML front matter block and checks each key.
 */
function validateFrontMatterKeys(content, filePath) {
  const warnings = [];
  const rootPage = isRootIndexPage(filePath);

  // Extract front matter text between --- delimiters
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    // No front matter at all — root/index page is fine without one
    if (rootPage) return warnings;
    const suggested = slugFromPath(filePath);
    warnings.push({
      check: 'pos-supervisor:MissingSlug',
      severity: 'warning',
      message: `Page has no front matter. Add \`slug\` to define the URL explicitly: \`---\\nslug: ${suggested}\\n---\`.`,
      line: 0,
      column: 0,
    });
    return warnings;
  }

  let doc;
  try {
    doc = yaml.load(fmMatch[1]);
  } catch {
    return warnings; // Invalid YAML — other checks will catch this
  }

  if (!doc || typeof doc !== 'object') return warnings;

  // Missing slug — suppress for root/index pages (URL derives from path by convention)
  if (!doc.slug && !rootPage) {
    const suggested = slugFromPath(filePath);
    const slugHint = suggested
      ? `Add \`slug: ${suggested}\` for an explicit URL.`
      : 'The URL will be derived from the file path.';
    warnings.push({
      check: 'pos-supervisor:MissingSlug',
      severity: 'warning',
      message: `Page is missing \`slug\` in front matter. ${slugHint}`,
      line: 0,
      column: 0,
    });
  }

  // Check each key
  for (const key of Object.keys(doc)) {
    if (VALID_PAGE_FRONT_MATTER_KEYS.has(key)) continue;

    const misleadingMsg = MISLEADING_FRONT_MATTER_KEYS[key];
    if (misleadingMsg) {
      warnings.push({
        check: 'pos-supervisor:InvalidFrontMatter',
        severity: 'error',
        message: misleadingMsg,
        line: findFrontmatterLine(content, key),
        column: 0,
      });
    } else {
      warnings.push({
        check: 'pos-supervisor:InvalidFrontMatter',
        severity: 'warning',
        message: `Unknown front matter key \`${key}\`. Valid keys: slug, method, layout, metadata, response_headers, max_deep_level, redirect_to, redirect_code, searchable, format.`,
        line: findFrontmatterLine(content, key),
        column: 0,
      });
    }
  }

  return warnings;
}

/**
 * Known filter argument rules.
 * Each entry: { maxPositional, allowNamed, message }
 *   maxPositional — max number of positional args (string/number/variable)
 *   allowNamed — whether named arguments (key: value) are valid
 *   message — help text when misused
 */
const FILTER_ARG_RULES = {
  map: {
    maxPositional: 1,
    allowNamed: false,
    message: '`map` takes exactly one argument (property name): `{{ items | map: "property" }}`. Named arguments are not supported.',
  },
  sort: {
    maxPositional: 1,
    allowNamed: false,
    message: '`sort` takes one optional argument (property name): `{{ items | sort: "property" }}`. Named arguments are not supported.',
  },
  where: {
    maxPositional: 2,
    allowNamed: false,
    message: '`where` takes 1-2 arguments: `{{ items | where: "property", "value" }}`. Named arguments are not supported.',
  },
  slice: {
    maxPositional: 2,
    allowNamed: false,
    message: '`slice` takes 1-2 arguments (offset, length): `{{ string | slice: 0, 5 }}`. Named arguments are not supported.',
  },
  replace: {
    maxPositional: 2,
    allowNamed: false,
    message: '`replace` takes 2 arguments: `{{ string | replace: "old", "new" }}`.',
  },
  default: {
    maxPositional: 1,
    allowNamed: true,
    message: '`default` takes one value and optional `allow_false: true`: `{{ var | default: "fallback", allow_false: true }}`.',
  },
  t: {
    maxPositional: 0,
    allowNamed: true,
    message: '`t` (translate) takes named arguments only: `{{ "key" | t: name: "value" }}`. The first positional arg is the key before the pipe.',
  },
};

/**
 * Detect filter argument misuse by walking LiquidFilter nodes.
 */
function detectFilterArgMisuse(ast, content) {
  const warnings = [];

  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidFilter || !node.name || !node.position) return;

    const rule = FILTER_ARG_RULES[node.name];
    if (!rule) return;

    const args = node.args ?? [];
    const positionalArgs = args.filter(a => a.type !== 'NamedArgument');
    const namedArgs = args.filter(a => a.type === 'NamedArgument');

    let violation = null;

    if (!rule.allowNamed && namedArgs.length > 0) {
      violation = rule.message;
    } else if (positionalArgs.length > rule.maxPositional) {
      violation = rule.message;
    }

    if (violation) {
      const pos = offsetToLineCol(content, node.position.start);
      warnings.push({
        check: 'pos-supervisor:FilterArgMisuse',
        severity: 'warning',
        message: violation,
        line: pos.line,
        column: pos.character,
      });
    }
  });

  return warnings;
}
