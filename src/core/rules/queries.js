/**
 * Fact query helpers — typed lookups against ProjectFactGraph.
 *
 * Pure functions: (graph, ...) → result. No side effects.
 * Used by rules to query project structure without ad-hoc lookups.
 */

export function nearestByLevenshtein(name, candidates, k = 5) {
  if (!name || !candidates || candidates.length === 0) return [];
  return candidates
    .map(c => ({ name: c, distance: levenshtein(name, c) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)
    .filter(c => c.distance <= Math.max(name.length * 0.6, 3));
}

export function partialNames(graph) {
  return graph.nodesByType('partial').map(n => n.key);
}

export function commandPaths(graph) {
  return graph.nodesByType('command').map(n => n.key);
}

export function queryPaths(graph) {
  return graph.nodesByType('query').map(n => n.key);
}

export function partialsReachableFrom(graph, filePath) {
  const visited = new Set();
  const queue = [filePath];
  const reachable = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = graph.dependsOn(current);
    for (const dep of deps) {
      const node = graph.nodeByPath(dep);
      if (node?.type === 'partial') reachable.push(node.key);
      queue.push(dep);
    }
  }
  return reachable;
}

export function dependentsOf(graph, filePath) {
  return graph.referencedBy(filePath);
}

export function translationKeysForLocale(graph, locale = 'en') {
  // The graph stores translation node keys exactly as they appear after
  // `flattenYaml`. When the YAML file is shaped correctly (root locale key
  // wraps everything — required by platformOS) the flattener emits keys
  // prefixed with `<locale>.` (e.g. `en.app.title`). When the file is
  // mis-shaped (no locale wrapper), keys come through bare (`app.title`).
  // Liquid's `'foo' | t` lookup never expects the prefix — it auto-prepends
  // the active locale. Surfacing prefixed keys to the rule engine led
  // `suggest_nearest` to emit "Did you mean `en.app.title`?" hints that,
  // when followed verbatim, resolved to `en.en.app.title` and failed again.
  // Strip the prefix here so every consumer sees the keys the agent should
  // actually write into a `| t` filter.
  const prefix = `${locale}.`;
  return graph.nodesByType('translation')
    .filter(n => n.locale === locale)
    .map(n => (n.key && n.key.startsWith(prefix)) ? n.key.slice(prefix.length) : n.key);
}

/**
 * Strip a leading `<locale>.` from a translation key. Returns the key
 * unchanged when no prefix is present. Useful in extractor-side rules that
 * need to compare an agent-supplied key (which may or may not include the
 * prefix, depending on how the agent formed the `| t` call) against the
 * canonical bare-key shape used in YAML.
 */
export function stripLocalePrefix(key, locale = 'en') {
  if (!key) return key;
  const prefix = `${locale}.`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function schemaNames(graph) {
  return graph.nodesByType('schema').map(n => n.key);
}

export function graphqlOperations(graph) {
  return graph.nodesByType('graphql').map(n => n.key);
}

export function fileExists(graph, path) {
  return graph.hasNode(path);
}

/**
 * List every asset path the project scanner indexed (relative to
 * `app/assets/`, no leading slash). Empty when the project has no assets
 * directory or the scan failed.
 */
export function assetNames(graph) {
  return graph.nodesByType('asset').map(n => n.key);
}

export function classifyPath(partialName) {
  if (!partialName) return { type: 'unknown', path: null };
  if (partialName.startsWith('modules/')) return { type: 'module', path: null };
  if (partialName.startsWith('commands/') || partialName.startsWith('lib/commands/')) {
    const stripped = partialName.replace(/^(lib\/)?commands\//, '');
    return { type: 'command', path: `app/lib/commands/${stripped}.liquid` };
  }
  if (partialName.startsWith('queries/') || partialName.startsWith('lib/queries/')) {
    const stripped = partialName.replace(/^(lib\/)?queries\//, '');
    return { type: 'query', path: `app/lib/queries/${stripped}.liquid` };
  }
  return { type: 'partial', path: `app/views/partials/${partialName}.liquid` };
}

export function callerCount(graph, filePath) {
  if (!graph || !filePath) return 0;
  return graph.referencedBy(filePath).length;
}

export function isOrphan(graph, filePath) {
  if (!graph || !filePath) return false;
  return graph.hasNode(filePath) && graph.referencedBy(filePath).length === 0;
}

export function hasDocParams(graph, filePath) {
  if (!graph || !filePath) return false;
  const node = graph.nodeByPath(filePath);
  return Array.isArray(node?.params) && node.params.length > 0;
}

export function classifyFileType(filePath) {
  if (!filePath) return 'unknown';
  if (filePath.startsWith('app/views/pages/')) return 'page';
  if (filePath.startsWith('app/views/partials/')) return 'partial';
  if (filePath.startsWith('app/views/layouts/')) return 'layout';
  if (filePath.startsWith('app/lib/commands/')) return 'command';
  if (filePath.startsWith('app/lib/queries/')) return 'query';
  if (filePath.startsWith('app/graphql/')) return 'graphql';
  if (filePath.startsWith('app/schema/')) return 'schema';
  if (filePath.startsWith('modules/')) return 'module';
  return 'unknown';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}
