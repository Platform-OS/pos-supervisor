/**
 * MissingPartial rules — first check fully ported to rule engine.
 *
 * Priority order:
 *   10 — module_path: module partials → guidance + module_info see_also
 *   20 — file_exists: target exists on disk but LSP still flags → guidance
 *   30 — suggest_nearest: did-you-mean via Levenshtein on reachable partials
 *   40 — create_file: generate create_file fix with scaffold
 */
import { classifyPath, nearestByLevenshtein, partialNames, partialsReachableFrom } from './queries.js';

export const rules = [
  {
    id: 'MissingPartial.module_path',
    check: 'MissingPartial',
    priority: 10,
    when: (diag) => {
      const name = diag.params?.partial;
      return !!name && name.startsWith('modules/');
    },
    apply: (diag) => {
      const name = diag.params.partial;
      const moduleName = name.split('/')[1];
      return {
        rule_id: 'MissingPartial.module_path',
        hint_md: `\`${name}\` is a module path — cannot create files inside installed modules. Use \`module_info\` to verify the correct path.`,
        fixes: [{
          type: 'guidance',
          description: `Cannot create files inside module \`${moduleName}\`. Call \`module_info("${moduleName}", "api")\` to find the correct partial path exported by this module.`,
        }],
        confidence: 0.9,
        see_also: {
          tool: 'module_info',
          args: { name: moduleName, section: 'api' },
          reason: `Module partial '${name}' not found. module_info(${moduleName}, api) returns live-scanned call paths from the installed module.`,
        },
      };
    },
  },

  {
    id: 'MissingPartial.file_exists',
    check: 'MissingPartial',
    priority: 20,
    when: (diag, facts) => {
      const name = diag.params?.partial;
      if (!name) return false;
      const { path } = classifyPath(name);
      return path && facts.graph.hasNode(path);
    },
    apply: (diag) => {
      const { path } = classifyPath(diag.params.partial);
      return {
        rule_id: 'MissingPartial.file_exists',
        hint_md: `File \`${path}\` exists but the linter still reports it as missing. Check that the file is not empty, has no syntax errors, and the path in the render/function tag matches exactly.`,
        fixes: [{
          type: 'guidance',
          description: `File \`${path}\` exists on disk. Verify: (1) file is not empty, (2) no Liquid syntax errors inside it, (3) the render/function tag path matches exactly (case-sensitive).`,
        }],
        confidence: 0.7,
      };
    },
  },

  {
    id: 'MissingPartial.suggest_nearest',
    check: 'MissingPartial',
    priority: 30,
    when: (diag, facts) => {
      const name = diag.params?.partial;
      if (!name || name.startsWith('modules/')) return false;
      const { type } = classifyPath(name);
      if (type === 'module') return false;
      const candidates = type === 'partial'
        ? partialNames(facts.graph)
        : []; // commands/queries use exact paths
      return candidates.length > 0;
    },
    apply: (diag, facts) => {
      const name = diag.params.partial;
      const { type, path: targetPath } = classifyPath(name);

      let candidates;
      if (type === 'partial') {
        // Prefer partials reachable from the caller's dependency tree
        const reachable = diag.file ? partialsReachableFrom(facts.graph, diag.file) : [];
        candidates = reachable.length > 0 ? reachable : partialNames(facts.graph);
      } else {
        candidates = [];
      }

      const nearest = nearestByLevenshtein(name, candidates, 5);
      if (nearest.length === 0) return null;

      const suggestions = nearest.map(n => `\`${n.name}\` (distance: ${n.distance})`).join(', ');
      const tag = type === 'partial' ? 'render' : 'function';

      const bestMatch = nearest[0].name;
      return {
        rule_id: 'MissingPartial.suggest_nearest',
        hint_md: `\`${name}\` not found. Did you mean: ${suggestions}? Fix the name in the \`{% ${tag} %}\` tag.`,
        fixes: [{
          type: 'guidance',
          description: `Replace \`${name}\` with \`${bestMatch}\` in the \`{% ${tag} '${name}' %}\` tag.`,
        }],
        confidence: 0.6,
      };
    },
  },

  {
    id: 'MissingPartial.create_file',
    check: 'MissingPartial',
    priority: 40,
    when: (diag) => {
      const name = diag.params?.partial;
      if (!name || name.startsWith('modules/')) return false;
      const { path } = classifyPath(name);
      return !!path;
    },
    apply: (diag, facts) => {
      const name = diag.params.partial;
      const { type, path: targetPath } = classifyPath(name);

      // Constraint: path must not collide with existing node
      if (facts.graph.hasNode(targetPath)) return null;

      // Constraint: path follows convention
      if (type === 'partial' && !targetPath.startsWith('app/views/partials/')) return null;
      if (type === 'command' && !targetPath.startsWith('app/lib/commands/')) return null;
      if (type === 'query' && !targetPath.startsWith('app/lib/queries/')) return null;

      const tag = type === 'partial' ? 'render' : 'function';

      return {
        rule_id: 'MissingPartial.create_file',
        hint_md: `Create missing file: \`${targetPath}\`. Use \`scaffold\` tool or create manually with appropriate \`{% doc %}\` block.`,
        fixes: [{
          type: 'create_file',
          path: targetPath,
          description: `Create missing ${type}: \`${targetPath}\``,
        }],
        confidence: 0.8,
      };
    },
  },
];
