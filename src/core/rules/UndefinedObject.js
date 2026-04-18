/**
 * UndefinedObject rules — variable not defined in current scope.
 *
 * Priority order:
 *   10 — shopify_object: Shopify theme object detected → migration guidance
 *   20 — context_prefix: bare variable in page needs context. prefix
 *   30 — declare_param: partial/command/query needs @param declaration
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

      return {
        rule_id: 'UndefinedObject.shopify_object',
        hint_md: `${kb?.shopify_guidance ?? suggestion}\n\n${suggestion}`,
        suggestion,
        fixes: [],
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
        fixes: [],
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
        fixes: [],
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
];
