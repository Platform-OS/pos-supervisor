/**
 * UnknownProperty rules — property does not exist on the given object.
 *
 * Priority order:
 *   10 — schema_property: object is a known schema table → suggest valid properties
 *   20 — context_property: object is context.* → list valid sub-properties
 *   100 — generic: fallback hint
 */
import { nearestByLevenshtein } from './queries.js';

export const rules = [
  {
    id: 'UnknownProperty.schema_property',
    check: 'UnknownProperty',
    priority: 10,
    when: (diag, facts) => {
      const objectName = diag.params?.object;
      if (!objectName) return false;
      const schemaNodes = facts.graph.nodesByType('schema');
      return schemaNodes.some(n => n.key === objectName || n.key === objectName.replace(/s$/, ''));
    },
    apply: (diag, facts) => {
      const objectName = diag.params.object;
      const propertyName = diag.params.property;

      const schemaNodes = facts.graph.nodesByType('schema');
      const schema = schemaNodes.find(n => n.key === objectName || n.key === objectName.replace(/s$/, ''));
      if (!schema?.properties) return null;

      const validProps = schema.properties.map(p => p.name).filter(Boolean);
      if (validProps.length === 0) return null;

      const nearest = nearestByLevenshtein(propertyName, validProps, 3);
      const suggestion = nearest.length > 0
        ? `Did you mean \`${nearest[0].name}\`?`
        : null;
      const propList = validProps.slice(0, 10).map(p => `\`${p}\``).join(', ');

      return {
        rule_id: 'UnknownProperty.schema_property',
        hint_md: `Property \`${propertyName}\` doesn't exist on \`${objectName}\`.${suggestion ? ` ${suggestion}` : ''}\n\nAvailable properties: ${propList}${validProps.length > 10 ? ` (+${validProps.length - 10} more)` : ''}`,
        suggestion: suggestion ?? `Check property name. Available: ${propList}`,
        fixes: [],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'UnknownProperty.context_property',
    check: 'UnknownProperty',
    priority: 20,
    when: (diag, facts) => {
      const objectName = diag.params?.object;
      if (!objectName) return false;
      return objectName.startsWith('context') && !!facts.objectsIndex?.loaded;
    },
    apply: (diag, facts) => {
      const objectName = diag.params.object;
      const propertyName = diag.params.property;

      const contextObjects = facts.objectsIndex.contextObjects();
      const allProps = [];
      for (const obj of contextObjects) {
        allProps.push(...obj.properties);
      }

      const nearest = nearestByLevenshtein(propertyName, allProps, 3);
      const suggestion = nearest.length > 0
        ? `Did you mean \`${nearest[0].name}\`?`
        : null;
      const contextNames = contextObjects.slice(0, 5).map(o => `\`${o.handle}\``).join(', ');

      return {
        rule_id: 'UnknownProperty.context_property',
        hint_md: `Property \`${propertyName}\` not found on \`${objectName}\`.${suggestion ? ` ${suggestion}` : ''}\n\nAvailable context objects: ${contextNames}. Use \`lookup\` to see full property lists.`,
        fixes: [],
        confidence: 0.7,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'partials', section: 'api' },
          reason: 'Context property not found. domain_guide(partials, api) lists available context.* objects and their properties.',
        },
      };
    },
  },

  {
    id: 'UnknownProperty.generic',
    check: 'UnknownProperty',
    priority: 100,
    when: (diag) => !!(diag.params?.property && diag.params?.object),
    apply: (diag) => {
      const propertyName = diag.params.property;
      const objectName = diag.params.object;
      const isPartial = diag.file?.includes('/partials/');

      return {
        rule_id: 'UnknownProperty.generic',
        hint_md: `Property \`${propertyName}\` doesn't exist on \`${objectName}\`.${isPartial ? ' If this is a partial parameter, declare it in the {% doc %} block.' : ''} Check the property name for typos.`,
        fixes: [],
        confidence: 0.4,
      };
    },
  },
];
