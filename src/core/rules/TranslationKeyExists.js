/**
 * TranslationKeyExists rules — translation key not found.
 *
 * Priority order (first match wins):
 *   5  — array_index_misuse: agent wrote `key[0]` / `key[1]` etc.
 *        platformOS translations cannot be subscripted with `[N]` —
 *        the modern pattern is `{% assign items = 'key' | t %}` then
 *        iterate with `{% for item in items %}`. Owns this case so the
 *        downstream Levenshtein rule never produces a misleading
 *        "did you mean en.key.items" suggestion.
 *   10 — suggest_nearest: key is close to an existing translation key
 *   20 — create_key:      suggest adding the key to translation file
 */
import { translationKeysForLocale } from './queries.js';
import { nearestByLevenshtein } from './queries.js';

export const rules = [
  {
    id: 'TranslationKeyExists.array_index_misuse',
    check: 'TranslationKeyExists',
    priority: 5,
    when: (diag) => /\[\d+\]/.test(diag.params?.key ?? ''),
    apply: (diag) => {
      const key = diag.params.key;
      const arrayKey = key.replace(/\[\d+\]/g, '');
      const guidance =
        `Translation arrays don't support [index] syntax in Liquid. ` +
        `Pass the full array, then iterate, for example: ` +
        `{% assign items = '${arrayKey}' | t %}\n` +
        `{% for item in items %}\n  <li>{{ item }}</li>\n{% endfor %}`;
      return {
        rule_id: 'TranslationKeyExists.array_index_misuse',
        hint_md:
          `Translation key \`${key}\` uses \`[${key.match(/\[(\d+)\]/)[1]}]\` indexing — not supported. ` +
          `Load the array with \`{% assign items = '${arrayKey}' | t %}\` and iterate with \`{% for %}\`.`,
        fixes: [{ type: 'guidance', description: guidance }],
        confidence: 0.9,
      };
    },
  },

  {
    id: 'TranslationKeyExists.suggest_nearest',
    check: 'TranslationKeyExists',
    priority: 10,
    when: (diag, facts) => {
      const key = diag.params?.key;
      if (!key) return false;
      // Array-index misuse owns its own rule above; don't double-fire here
      // (Levenshtein on `foo[0]` reliably finds a misleading parent key).
      if (/\[\d+\]/.test(key)) return false;
      const keys = translationKeysForLocale(facts.graph, 'en');
      return keys.length > 0;
    },
    apply: (diag, facts) => {
      const key = diag.params.key;
      const keys = translationKeysForLocale(facts.graph, 'en');
      const nearest = nearestByLevenshtein(key, keys, 3);
      if (nearest.length === 0) return null;

      const bestMatch = nearest[0].name;
      const suggestions = nearest.map(n => `\`${n.name}\``).join(', ');
      return {
        rule_id: 'TranslationKeyExists.suggest_nearest',
        hint_md: `Translation key \`${key}\` not found. Did you mean: ${suggestions}? Or add it to \`app/translations/en.yml\`.`,
        fixes: [{
          type: 'guidance',
          description: `Replace \`${key}\` with \`${bestMatch}\` in the \`{{ '${key}' | t }}\` filter, or add the missing key to \`app/translations/en.yml\`.`,
        }],
        confidence: 0.7,
      };
    },
  },

  {
    id: 'TranslationKeyExists.create_key',
    check: 'TranslationKeyExists',
    priority: 20,
    when: (diag) => {
      const key = diag.params?.key;
      if (!key) return false;
      // Don't propose creating `foo[0]: TODO` — array_index_misuse owns this.
      if (/\[\d+\]/.test(key)) return false;
      return true;
    },
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
        fixes: [{
          type: 'guidance',
          description: `Add the following YAML to \`app/translations/en.yml\`:\n${snippet}`,
        }],
        confidence: 0.8,
      };
    },
  },
];
