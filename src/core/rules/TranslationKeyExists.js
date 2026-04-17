/**
 * TranslationKeyExists rules — translation key not found.
 *
 * Priority order:
 *   10 — suggest_nearest: key is close to an existing translation key
 *   20 — create_key: suggest adding the key to translation file
 */
import { translationKeysForLocale } from './queries.js';
import { nearestByLevenshtein } from './queries.js';

export const rules = [
  {
    id: 'TranslationKeyExists.suggest_nearest',
    check: 'TranslationKeyExists',
    priority: 10,
    when: (diag, facts) => {
      const key = diag.params?.key;
      if (!key) return false;
      const keys = translationKeysForLocale(facts.graph, 'en');
      return keys.length > 0;
    },
    apply: (diag, facts) => {
      const key = diag.params.key;
      const keys = translationKeysForLocale(facts.graph, 'en');
      const nearest = nearestByLevenshtein(key, keys, 3);
      if (nearest.length === 0) return null;

      const suggestions = nearest.map(n => `\`${n.name}\``).join(', ');
      return {
        rule_id: 'TranslationKeyExists.suggest_nearest',
        hint_md: `Translation key \`${key}\` not found. Did you mean: ${suggestions}? Or add it to \`app/translations/en.yml\`.`,
        fixes: [],
        confidence: 0.7,
      };
    },
  },

  {
    id: 'TranslationKeyExists.create_key',
    check: 'TranslationKeyExists',
    priority: 20,
    when: (diag) => !!diag.params?.key,
    apply: (diag) => {
      const key = diag.params.key;
      const parts = key.split('.');
      const yamlLines = [];
      parts.forEach((part, i) => {
        if (i < parts.length - 1) {
          yamlLines.push(`${'  '.repeat(i)}${part}:`);
        } else {
          yamlLines.push(`${'  '.repeat(i)}${part}: "TODO"`);
        }
      });
      const snippet = yamlLines.join('\n');

      return {
        rule_id: 'TranslationKeyExists.create_key',
        hint_md: `Add translation key \`${key}\` to \`app/translations/en.yml\`:\n\`\`\`yaml\n${snippet}\n\`\`\``,
        fixes: [],
        confidence: 0.8,
      };
    },
  },
];
