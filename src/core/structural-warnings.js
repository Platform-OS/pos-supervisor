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

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { walk, NodeTypes, NamedTags } from '@platformos/liquid-html-parser';
import { isShopifyObject, isShopifyFilter, getShopifyObject, getShopifyTag } from './knowledge-loader.js';
import { getDomainFromPath } from './domain-detector.js';
import { offsetToLineCol, slugFromPath } from './position-utils.js';
import { classifyGraphqlSourceKind } from './liquid-parser.js';

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

  // 6b. Multi-line `{% graphql %}` continuation inside `{% liquid %}` block.
  //     Both liquid-html-parser and pos-cli's LSP truncate the call at the
  //     first newline-comma — every named arg past it is silently dropped.
  //     LSP then fires `GraphQLVariablesCheck.required` for each missing
  //     arg, the agent sees the args in source and gets stuck in a fix
  //     spiral. Surface the structural cause once per call.
  //     (Reproduced in DEMO 2026-04-27, 4 emits / 100 % regression.)
  const truncationWarnings = detectGraphqlMultilineTruncation(ast, content);
  warnings.push(...truncationWarnings);

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
  }

  // 9b. Page method / form-target sanity. Three distinct misconfigurations:
  //     html_on_post (non-GET page renders HTML), api_renders_html (API-pathed
  //     page is non-GET but emits HTML or lacks `format: json`), and
  //     get_form_target (GET page hosts a `<form method="post">` whose action
  //     points at a non-API slug). All three share a check name so analytics
  //     stay aggregated by symptom; the rule layer routes by message subtype.
  if (domain === 'pages') {
    const pageWarnings = validatePageMethodAndForms(structural, content);
    warnings.push(...pageWarnings);
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
 * Detect `{% graphql %}` calls inside a `{% liquid %}` block written with a
 * comma + newline continuation. Both liquid-html-parser and pos-cli's LSP
 * truncate the call at the first newline-comma — `markup.args` ends up
 * empty and LSP fires `GraphQLVariablesCheck.required` for every named arg
 * that follows. The agent sees the args in source and is misled by the
 * resulting "add the variable" hint into a regression spiral.
 *
 * Surfaced as `error` severity because the call WILL fail at runtime: every
 * arg past the first newline is dropped, so the GraphQL operation receives
 * no values for required variables.
 */
function detectGraphqlMultilineTruncation(ast, content) {
  const warnings = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag || node.name !== NamedTags.graphql) return;
    if (classifyGraphqlSourceKind(node) !== 'liquid_multiline_truncated') return;
    const pos = node.position
      ? offsetToLineCol(content, node.position.start)
      : { line: 0, character: 0 };
    warnings.push({
      check: 'pos-supervisor:GraphqlMultilineInLiquidBlock',
      severity: 'error',
      message:
        'Multi-line `{% graphql %}` call inside a `{% liquid %}` block: the parser truncates ' +
        'the call at the first newline-comma, so every named argument past it is silently ' +
        'dropped at runtime. Move to single-line tag form: `{% graphql result = \'op\', name: value, ... %}`, ' +
        'or keep it inside the block but place every `name: value` argument on the same line as `graphql`.',
      line: pos.line,
      column: pos.character,
    });
  });
  return warnings;
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
  // Pick the right extension by sampling existing layouts in the project.
  // Hardcoding `.html.liquid` (the previous behaviour) creates files at the
  // wrong path in any project that has standardised on the bare `.liquid`
  // suffix — the agent applies the create_file proposal, the file lands in
  // the wrong place, and the original error never resolves. The DEMO
  // failure pattern was exactly this.
  const ext = detectLayoutExtension(projectDir, moduleMatch?.[1]);
  const expectedPath = moduleMatch
    ? `modules/${moduleMatch[1]}/public/views/layouts/${moduleMatch[2]}${ext}`
    : `app/views/layouts/${layoutName}${ext}`;
  return {
    check: 'pos-supervisor:InvalidLayout',
    severity: 'warning',
    message: `Layout \`${layoutName}\` not found. Expected file: \`${expectedPath}\`. Check the layout name or create the missing layout file.`,
    line: line >= 0 ? line : 0,
    column: 0,
  };
}

/**
 * Pick the layout-file extension convention the project already uses.
 * Walks the relevant layouts directory once, counts each suffix variant,
 * returns the dominant one. Falls back to `.liquid` (the modern shape) when
 * no layouts exist on disk yet — that biases toward the more compact suffix
 * which has been the default in scaffolds since pos-cli 6.x.
 *
 * `moduleName` is set when the missing layout itself is a module path,
 * in which case we look at the module's layouts dir; otherwise we look at
 * the top-level `app/views/layouts/`.
 */
function detectLayoutExtension(projectDir, moduleName = null) {
  if (!projectDir) return '.liquid';
  const dir = moduleName
    ? join(projectDir, 'modules', moduleName, 'public', 'views', 'layouts')
    : join(projectDir, 'app', 'views', 'layouts');
  let entries;
  try { entries = readdirSync(dir, { recursive: true }); }
  catch { return '.liquid'; }

  let html = 0;
  let bare = 0;
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    if (entry.endsWith('.html.liquid')) html += 1;
    else if (entry.endsWith('.liquid')) bare += 1;
  }
  if (html === 0 && bare === 0) return '.liquid';
  return html > bare ? '.html.liquid' : '.liquid';
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
/**
 * Detect three distinct page-method / form-target misconfigurations.
 *
 * Routing rules (mirror the gist analysis: NonGetRenderingPageRule.md, 2026-04-27):
 *   1. method != GET, slug under /api/, /_/, /internal/, AND (HTML present
 *      OR `format: json` is missing) → api_renders_html. The endpoint is
 *      labelled API by slug convention but is leaking HTML to clients that
 *      expect JSON, OR forgetting the explicit format header.
 *   2. method != GET, slug NOT api-pathed, page renders HTML (layout,
 *      partials, output, or HTML tags) → html_on_post. Browser GET → 404
 *      because the page only handles POST/PUT/PATCH/DELETE.
 *   3. method == GET (or omitted), body contains `<form method="post" action="...">`
 *      whose action does NOT start with /api/, /_/, /internal/, AND is not
 *      the page's own slug (self-post is a separate sanctioned pattern) →
 *      get_form_target. Submitting the form will fail unless the action
 *      target is itself a `method: post` page; the canonical fix is to
 *      route through an API slug.
 *
 * Subtype is encoded as the leading clause of the diagnostic message so the
 * rule layer can route by regex without an extractor.
 */
function validatePageMethodAndForms(structural, content) {
  const warnings = [];
  if (!structural || typeof content !== 'string') return warnings;

  const method = (structural.method || '').toLowerCase();
  const slug = normalizePageSlug(structural.slug);
  const isApiSlug = isApiPath(slug);
  const methodLine = findFrontmatterLine(content, 'method');
  const formatHeader = parseFormatHeader(content);

  const hasLayout = isExplicitLayout(structural?.layout);
  const rendersPartials = Array.isArray(structural?.renders_used) && structural.renders_used.length > 0;
  const hasOutput = /\{\{/.test(content);
  const hasHtmlTags = /<(html|body|div|main|section|article|form|h[1-6]|p|ul|ol|nav|header|footer)\b/i.test(content);
  // For non-API pages any output expression counts as HTML rendering — the
  // default format IS html, so `{{ x }}` becomes a visible page body. For
  // API pages with `format: json`, bare `{{ result | json }}` is the
  // canonical response body and explicitly NOT HTML rendering. Use a
  // tighter signal there: only layout / partials / HTML tags count.
  const looksLikeUiPage = hasLayout || rendersPartials || hasOutput || hasHtmlTags;
  const apiHasHtmlSignal = hasLayout || rendersPartials || hasHtmlTags;

  if (method && method !== 'get' && ['post', 'put', 'delete', 'patch'].includes(method)) {
    if (isApiSlug) {
      // (1) api_renders_html — fires when the API page either emits HTML
      // (layout, partials, HTML tags — but NOT bare `{{ }}` output, which
      // is the intended JSON serialization) OR forgets `format: json`.
      // Both are silent breakage modes for an endpoint that callers
      // expect to consume as JSON.
      if (apiHasHtmlSignal || formatHeader !== 'json') {
        const symptom = apiHasHtmlSignal
          ? `it renders HTML${hasLayout ? ` (layout: \`${structural.layout}\`)` : ' (layout, partials, or HTML tags)'}`
          : `\`format: json\` is missing — without it the page defaults to HTML`;
        warnings.push({
          check: 'pos-supervisor:NonGetRenderingPage',
          severity: 'warning',
          message:
            `API page (slug \`${slug}\`) has \`method: ${method}\` but ${symptom}. ` +
            `Pages under \`/api/\`, \`/_/\`, or \`/internal/\` must return JSON: ` +
            `set \`format: json\` in front matter, drop the layout, and emit the response with ` +
            `\`{% graphql ... %}\` + \`{{ result | json }}\`.`,
          line: methodLine >= 0 ? methodLine : 0,
          column: 0,
        });
      }
    } else if (looksLikeUiPage) {
      // (2) html_on_post — non-API page that won't serve any browser
      // navigation because the verb is wrong.
      warnings.push({
        check: 'pos-supervisor:NonGetRenderingPage',
        severity: 'warning',
        message:
          `Page has \`method: ${method}\` but renders HTML (layout, partials, or \`{{ ... }}\` output). ` +
          `Browser GETs to this URL return 404 — only ${method.toUpperCase()} requests reach the handler. ` +
          `If this page should display content, remove the \`method\` field (defaults to \`get\`). ` +
          `If it's a form endpoint, move the handler to \`app/lib/commands/\` and have the form ` +
          `\`POST\` to an API slug.`,
        line: methodLine >= 0 ? methodLine : 0,
        column: 0,
      });
    }
  }

  // (3) get_form_target — fires only on GET pages (or pages with no method,
  // which default to GET). Walks every `<form method="post" action="...">`
  // in the body and flags non-API actions that don't self-post. Inline
  // forms that omit `method` default to GET in HTML and are NOT flagged
  // (no submission risk).
  if ((method === '' || method === 'get') && content) {
    for (const form of parsePostForms(content)) {
      if (!form.action) continue;
      if (isApiPath(form.action)) continue;
      if (selfPosts(form.action, slug)) continue;
      warnings.push({
        check: 'pos-supervisor:NonGetRenderingPage',
        severity: 'warning',
        message:
          `Form on GET page posts to \`${form.action}\`. Action paths outside \`/api/\`, \`/_/\`, or ` +
          `\`/internal/\` must correspond to a page with \`method: post\` (or matching verb). The canonical ` +
          `pattern is to point form actions at an API slug — set \`<form action="/api/${stripLeadingSlash(form.action)}" method="post">\` ` +
          `and create \`app/views/pages/api/${stripLeadingSlash(form.action)}.liquid\` with \`method: post\` + ` +
          `\`format: json\`.`,
        line: form.line,
        column: form.column,
      });
    }
  }

  return warnings;
}

/**
 * Normalize a slug to the canonical leading-slash form for routing checks.
 * Empty / null input returns '' so `isApiPath('')` is well-defined.
 */
function normalizePageSlug(slug) {
  if (typeof slug !== 'string') return '';
  let s = slug.trim().toLowerCase();
  if (!s) return '';
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

/**
 * Internal-API path heuristic. Mirrors the convention documented in the
 * platformOS Contact-Form tutorial and the linked NonGetRenderingPageRule
 * gist analysis: `/api/`, `/_/`, `/internal/` (case-insensitive).
 */
function isApiPath(path) {
  if (typeof path !== 'string' || !path) return false;
  const p = path.startsWith('/') ? path : `/${path}`;
  return /^\/(api|_|internal)\//i.test(p);
}

/**
 * Extract the `format:` frontmatter header (lowercased), or null when not set.
 * The page's `format` is not currently parsed by `extractAllFromAST`, so we
 * peek at the YAML head directly. Quote stripping mirrors the `layout:`
 * extractor in liquid-parser.
 */
function parseFormatHeader(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1].match(/^format:\s*(.+?)\s*$/m);
  if (!fm) return null;
  return fm[1].replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase() || null;
}

/**
 * Layout truthiness for HTML detection. Treat empty strings, `false`, `null`,
 * and missing values as "no layout"; everything else counts as an HTML wrap.
 */
function isExplicitLayout(layout) {
  if (layout === undefined || layout === null) return false;
  if (typeof layout === 'boolean') return layout === true;
  if (typeof layout !== 'string') return false;
  const trimmed = layout.trim();
  if (!trimmed) return false;
  if (trimmed === 'false' || trimmed === 'null') return false;
  return true;
}

/**
 * Walk the raw content for `<form ... method="post" ... action="..."` (in
 * either attribute order) and return `{ action, line, column }` for each.
 * Stays attribute-order-independent because authors flip them frequently.
 * Single quotes, double quotes, and unquoted attribute values are accepted.
 */
function parsePostForms(content) {
  const out = [];
  // Accept method= and action= in either order; require both. Allow other
  // attributes (id, class, data-*) interleaved.
  const formRe = /<form\b([^>]*)>/gi;
  let m;
  while ((m = formRe.exec(content)) !== null) {
    const attrs = m[1] || '';
    const methodMatch = attrs.match(/\bmethod\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    if (!methodMatch) continue;
    const methodVal = (methodMatch[1] ?? methodMatch[2] ?? methodMatch[3] ?? '').toLowerCase();
    if (!['post', 'put', 'patch', 'delete'].includes(methodVal)) continue;
    const actionMatch = attrs.match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    if (!actionMatch) continue;
    const action = (actionMatch[1] ?? actionMatch[2] ?? actionMatch[3] ?? '').trim();
    if (!action) continue;
    const offset = m.index;
    const before = content.slice(0, offset);
    const line = (before.match(/\n/g) || []).length;
    const column = offset - (before.lastIndexOf('\n') + 1);
    out.push({ action, line, column });
  }
  return out;
}

/**
 * True when `formAction` resolves to the same URL the page itself serves —
 * i.e. the page is a self-post (form on the page submits back to the same
 * slug, which then handles the POST). Self-post is a sanctioned
 * platformOS pattern (the page must be `method: post` to receive it, but
 * that's a separate concern handled by html_on_post).
 */
function selfPosts(formAction, pageSlug) {
  if (!formAction || !pageSlug) return false;
  const a = formAction.toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
  const s = pageSlug.toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
  return a === s;
}

function stripLeadingSlash(s) {
  return typeof s === 'string' ? s.replace(/^\/+/, '') : s;
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
