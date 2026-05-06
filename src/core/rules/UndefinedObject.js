/**
 * UndefinedObject rules — variable not defined in current scope.
 *
 * Priority order:
 *    10 — shopify_object:   Shopify theme object detected → migration guidance
 *    20 — context_prefix:   bare variable in page needs context. prefix
 *    30 — declare_param:    partial/command/query needs @param declaration
 *   100 — generic:          variable name extracted but no specialised rule applies
 *  1000 — default:          catch-all for the case where extraction failed
 *         (LSP message shape change, etc.). Without this rule the diagnostic
 *         would land as `UndefinedObject.unmatched`. Confidence is intentionally
 *         lower than `.generic` so analytics treat it as a coverage signal, not
 *         an authoritative answer.
 */
import { isShopifyObject, getShopifyObject, getCheckKnowledge } from '../knowledge-loader.js';

export const rules = [
  {
    id: 'UndefinedObject.shopify_object',
    check: 'UndefinedObject',
    priority: 10,
    when: (diag) => {
      const name = diag.params?.variable;
      return !!name && isShopifyObject(name);
    },
    apply: (diag) => {
      const name = diag.params.variable;
      const info = getShopifyObject(name);
      const suggestion = info?.replacement
        ? `\`${name}\` is a Shopify object. Use: \`${info.replacement}\`${info.note ? ` — ${info.note}` : ''}`
        : `\`${name}\` is a Shopify theme object — not in platformOS.${info?.note ? ` ${info.note}` : ' Use GraphQL queries to fetch data and `context.*` for request/user data.'}`;

      const kb = getCheckKnowledge('UndefinedObject', 'default');

      const fixes = [];
      if (info?.replacement) {
        fixes.push({
          type: 'text_edit',
          range: {
            start: { line: diag.line, character: diag.column },
            end: { line: diag.line, character: diag.column + name.length },
          },
          new_text: info.replacement,
          description: `Replace Shopify object \`${name}\` with \`${info.replacement}\``,
        });
      } else {
        fixes.push({
          type: 'guidance',
          description: `\`${name}\` is a Shopify theme object. Use \`{% graphql %}\` to fetch data and \`context.*\` for request/user data.`,
        });
      }

      return {
        rule_id: 'UndefinedObject.shopify_object',
        hint_md: `${kb?.shopify_guidance ?? suggestion}\n\n${suggestion}`,
        suggestion,
        fixes,
        confidence: 0.95,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'pages', section: 'gotchas' },
          reason: `Shopify object \`${name}\` detected — platformOS uses different patterns for data access.`,
        },
      };
    },
  },

  {
    id: 'UndefinedObject.context_prefix',
    check: 'UndefinedObject',
    priority: 20,
    when: (diag) => {
      const name = diag.params?.variable;
      if (!name) return false;
      const isPage = diag.file && /\/pages\//.test(diag.file);
      if (!isPage) return false;
      const CONTEXT_PROPS = ['params', 'session', 'current_user', 'page', 'location', 'environment', 'authenticity_token', 'headers', 'constants'];
      return CONTEXT_PROPS.includes(name);
    },
    apply: (diag) => {
      const name = diag.params.variable;
      return {
        rule_id: 'UndefinedObject.context_prefix',
        hint_md: `Use \`context.${name}\` instead of bare \`${name}\`. In pages, all built-in objects require the \`context.\` prefix: \`context.params\`, \`context.session\`, \`context.current_user\`, \`context.page\`.`,
        fixes: [{
          type: 'text_edit',
          range: {
            start: { line: diag.line, character: diag.column },
            end: { line: diag.line, character: diag.column + name.length },
          },
          new_text: `context.${name}`,
          description: `Replace \`${name}\` with \`context.${name}\``,
        }],
        confidence: 0.9,
      };
    },
  },

  {
    id: 'UndefinedObject.declare_param',
    check: 'UndefinedObject',
    priority: 30,
    when: (diag) => {
      const name = diag.params?.variable;
      if (!name) return false;
      const isPartial = diag.file && /\/partials\/|\/commands\/|\/queries\//.test(diag.file);
      return isPartial;
    },
    apply: (diag) => {
      const name = diag.params.variable;
      const isCommand = diag.file && /\/commands\//.test(diag.file);
      const isQuery = diag.file && /\/queries\//.test(diag.file);
      const fileType = isCommand ? 'command' : isQuery ? 'query' : 'partial';

      return {
        rule_id: 'UndefinedObject.declare_param',
        hint_md: `Variable \`${name}\` is not defined. In ${fileType}s, all variables must be passed explicitly. Add a \`{% doc %}\` block: \`{% doc %} @param {object} ${name} {% enddoc %}\` and pass it from the caller.`,
        fixes: [{
          type: 'insert',
          position: { line: 0, character: 0 },
          text: `{% doc %}\n  @param {object} ${name}\n{% enddoc %}\n`,
          description: `Add \`@param {object} ${name}\` declaration in a {% doc %} block at the top of the file`,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'UndefinedObject.generic',
    check: 'UndefinedObject',
    priority: 100,
    when: (diag) => !!diag.params?.variable,
    apply: (diag) => {
      const name = diag.params.variable;
      return {
        rule_id: 'UndefinedObject.generic',
        hint_md: `Variable \`${name}\` is not defined in the current scope. Use \`context.${name}\` for built-in objects, or ensure it's assigned before use with \`{% assign %}\`, \`{% graphql %}\`, or \`{% function %}\`.`,
        fixes: [],
        confidence: 0.5,
      };
    },
  },

  // Last-resort catch-all. Reached only when `.generic`'s extraction guard
  // failed — the LSP emitted an UndefinedObject whose message did not match
  // the documented shape. Surfaces a diagnostic that names "an undefined
  // variable" without pretending we know which one.
  {
    id: 'UndefinedObject.default',
    check: 'UndefinedObject',
    priority: 1000,
    when: () => true,
    apply: () => ({
      rule_id: 'UndefinedObject.default',
      hint_md:
        `An undefined variable is referenced. Read the upstream message — it names the variable. ` +
        `Three canonical resolutions:\n` +
        `  • **In a page** — bare names like \`params\`, \`session\`, \`current_user\` need ` +
        `the \`context.\` prefix.\n` +
        `  • **In a partial / command / query** — declare the variable as a \`{% doc %} ` +
        `@param {<type>} <name> {% enddoc %}\` and have the caller pass it.\n` +
        `  • **Local computation** — assign before use: \`{% assign x = ... %}\` / ` +
        `\`{% graphql x = ... %}\` / \`{% function x = ... %}\`.`,
      fixes: [{
        type: 'guidance',
        description:
          `Re-read the upstream message for the variable name, then either prefix with \`context.\`, ` +
          `declare as a \`@param\`, or assign before use depending on where the reference lives.`,
      }],
      confidence: 0.4,
    }),
  },
];
