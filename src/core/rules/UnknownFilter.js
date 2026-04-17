/**
 * UnknownFilter rules — filter does not exist in platformOS Liquid.
 *
 * Priority order:
 *   10 — tag_confusion: filter name is actually a tag
 *   20 — shopify_filter: Shopify-specific filter detected
 *   30 — suggest_nearest: did-you-mean via filters index
 *   40 — generic: fallback hint
 */
import { isShopifyFilter, getShopifyFilter } from '../knowledge-loader.js';

export const rules = [
  {
    id: 'UnknownFilter.tag_confusion',
    check: 'UnknownFilter',
    priority: 10,
    when: (diag, facts) => {
      const name = diag.params?.filter;
      return !!name && !!facts.tagsIndex?.isTag(name);
    },
    apply: (diag) => {
      const name = diag.params.filter;
      return {
        rule_id: 'UnknownFilter.tag_confusion',
        hint_md: `\`${name}\` is a tag, not a filter. Use \`{% ${name} ... %}\` instead of \`| ${name}\`.`,
        fixes: [],
        confidence: 0.95,
      };
    },
  },

  {
    id: 'UnknownFilter.shopify_filter',
    check: 'UnknownFilter',
    priority: 20,
    when: (diag) => {
      const name = diag.params?.filter;
      return !!name && isShopifyFilter(name);
    },
    apply: (diag) => {
      const name = diag.params.filter;
      const info = getShopifyFilter(name);
      const suggestion = info?.replacement
        ? `\`${name}\` is a Shopify filter — not in platformOS. Use \`${info.replacement}\` instead.${info.note ? ` ${info.note}` : ''}`
        : `\`${name}\` is a Shopify-specific filter — not in platformOS.${info?.note ? ` ${info.note}` : ''}`;

      return {
        rule_id: 'UnknownFilter.shopify_filter',
        hint_md: suggestion,
        fixes: [],
        confidence: 0.9,
        see_also: {
          tool: 'lookup',
          args: { mode: 'completions' },
          reason: `Use lookup (completions mode) at the filter position to see available platformOS filters.`,
        },
      };
    },
  },

  {
    id: 'UnknownFilter.suggest_nearest',
    check: 'UnknownFilter',
    priority: 30,
    when: (diag, facts) => {
      const name = diag.params?.filter;
      return !!name && !!facts.filtersIndex?.loaded;
    },
    apply: (diag, facts) => {
      const name = diag.params.filter;
      const exact = facts.filtersIndex.lookup(name);
      if (exact) {
        return {
          rule_id: 'UnknownFilter.suggest_nearest',
          hint_md: `Filter \`${exact.name}\` exists: ${exact.syntax || exact.summary}`,
          fixes: [],
          confidence: 0.8,
        };
      }
      const closest = facts.filtersIndex.closestMatch(name);
      if (closest) {
        return {
          rule_id: 'UnknownFilter.suggest_nearest',
          hint_md: `Did you mean \`${closest.name}\`? ${closest.syntax || closest.summary}`,
          fixes: [],
          confidence: 0.6,
        };
      }
      return null;
    },
  },

  {
    id: 'UnknownFilter.generic',
    check: 'UnknownFilter',
    priority: 100,
    when: (diag) => !!diag.params?.filter,
    apply: (diag) => {
      const name = diag.params.filter;
      return {
        rule_id: 'UnknownFilter.generic',
        hint_md: `Filter \`${name}\` is not available in platformOS. Check for typos or use \`lookup\` (completions mode) at the filter position to see available filters.`,
        fixes: [],
        confidence: 0.4,
      };
    },
  },
];
