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
import {
  installedModules,
  moduleCallPathsByCategory,
  moduleInstalled,
} from './module-paths.js';

export const rules = [
  {
    id: 'MissingPartial.module_path',
    check: 'MissingPartial',
    priority: 10,
    when: (diag) => {
      const name = diag.params?.partial;
      return !!name && name.startsWith('modules/');
    },
    apply: (diag, facts) => {
      const name = diag.params.partial;
      const parsed = parseModulePath(name);
      const projectDir = facts?.projectDir ?? null;

      // 1. Module not installed → list known modules + Levenshtein.
      if (parsed.moduleName && projectDir && !moduleInstalled(projectDir, parsed.moduleName)) {
        const installed = installedModules(projectDir);
        const nearest = nearestByLevenshtein(parsed.moduleName, installed, 3);
        const list = installed.length > 0
          ? `Installed modules: ${installed.map(m => `\`${m}\``).join(', ')}.`
          : `No modules are installed under \`modules/\`.`;
        const didYouMean = nearest.length > 0
          ? ` Did you mean \`${nearest[0].name}\`?`
          : '';
        return {
          rule_id: 'MissingPartial.module_path',
          hint_md:
            `Module \`${parsed.moduleName}\` is not installed in this project. ${list}${didYouMean} ` +
            `Module paths look like \`modules/<module-name>/<category>/<rest>\` — check the module name first.`,
          fixes: [{
            type: 'guidance',
            description:
              `Module \`${parsed.moduleName}\` not installed. Either install it (\`pos-cli modules install ${parsed.moduleName}\`), ` +
              `pick a different module from the installed list, or move the call into a project-local file under \`app/lib/\`.`,
          }],
          confidence: 0.9,
          see_also: {
            tool: 'project_map',
            args: {},
            reason: `Module '${parsed.moduleName}' not installed. project_map enumerates installed modules and project-local commands/queries.`,
          },
        };
      }

      // 2. Module installed → enumerate exports and reason about the bad path.
      const moduleName = parsed.moduleName;
      const exportsByCategory = projectDir && moduleName
        ? moduleCallPathsByCategory(projectDir, moduleName)
        : null;

      const buildCheckSpecial = parsed.category === 'commands'
        && (parsed.rest === 'build' || parsed.rest === 'check');

      const allExports = exportsByCategory
        ? Object.values(exportsByCategory).flat()
        : [];

      // Levenshtein over every callable in the module, not just the
      // (possibly mistyped) category — agents land in the wrong category
      // bucket all the time (e.g. `commands/find_user` when the export is
      // `queries/users/find`).
      const nearest = allExports.length > 0
        ? nearestByLevenshtein(name, allExports, 5)
        : [];

      const candidatesBlock = nearest.length > 0
        ? nearest.map(n => `\`${n.name}\``).join(', ')
        : '(no close matches in this module)';

      let lead;
      if (buildCheckSpecial) {
        // The original failure mode the report flagged: agents copy the
        // `modules/core/commands/execute` shortcut, then assume `…/build`
        // and `…/check` exist as siblings. They don't — build/check are
        // inline phases of the *caller's* command, written next to
        // execute.liquid in the agent's own `app/lib/commands/<feature>/`
        // tree. Only `execute` is exported by core for the simple-create
        // shortcut.
        lead =
          `\`${name}\` does not exist. \`build\` and \`check\` are **inline phases of your own command**, ` +
          `not module-level helpers — write them as \`build.liquid\` / \`check.liquid\` next to your \`execute.liquid\` ` +
          `under \`app/lib/commands/<feature>/\`. Only \`modules/${moduleName}/commands/execute\` is exported by core ` +
          `(simple-create shortcut). For complex flows (multi-step orchestration, validation chains) ` +
          `keep build/check inline.`;
      } else {
        lead = `\`${name}\` is not exported by module \`${moduleName}\`.`;
      }

      const categorySummary = exportsByCategory
        ? Object.entries(exportsByCategory)
            .filter(([, paths]) => paths.length > 0)
            .map(([cat, paths]) => `${cat} (${paths.length})`)
            .join(', ')
        : null;

      const hint =
        `${lead}\n\n` +
        `Closest matches in \`${moduleName}\`: ${candidatesBlock}.` +
        (categorySummary ? `\nExported categories: ${categorySummary}.` : '') +
        `\nCall \`module_info(${moduleName}, api)\` to read the full export list with @param signatures.`;

      const fixDescription = buildCheckSpecial
        ? `Remove the \`{% function ... = '${name}', ... %}\` call and inline the build/check logic ` +
          `directly in this file (or its sibling phase file). If you intended a different module helper, ` +
          `replace the path with one of: ${nearest.slice(0, 3).map(n => `\`${n.name}\``).join(', ') || '(none)'}. ` +
          `Use \`module_info(${moduleName}, api)\` for the full list.`
        : `Replace \`${name}\` with the closest valid export: ${nearest.slice(0, 3).map(n => `\`${n.name}\``).join(', ') || '(none)'}, ` +
          `or call \`module_info(${moduleName}, api)\` to see every callable path the module exposes.`;

      return {
        rule_id: 'MissingPartial.module_path',
        hint_md: hint,
        fixes: [{
          type: 'guidance',
          description: fixDescription,
        }],
        confidence: nearest.length > 0 ? 0.9 : 0.7,
        see_also: {
          tool: 'module_info',
          args: { name: moduleName, section: 'api' },
          reason: `module_info(${moduleName}, api) returns live-scanned call paths and @param signatures for every export.`,
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

/**
 * Split `modules/<name>/<category>/<rest...>` into its parts. The returned
 * `category` is the literal first segment after the module name (callers
 * decide whether it maps to a known module-export bucket); `rest` is the
 * remainder joined with '/'. Returns nulls when the input doesn't fit the
 * shape so callers can shortcut.
 */
export function parseModulePath(name) {
  if (!name || !name.startsWith('modules/')) {
    return { moduleName: null, category: null, rest: null };
  }
  const parts = name.split('/');
  // parts[0] === 'modules'
  const moduleName = parts[1] ?? null;
  const category = parts[2] ?? null;
  const rest = parts.length > 3 ? parts.slice(3).join('/') : null;
  return { moduleName, category, rest };
}
