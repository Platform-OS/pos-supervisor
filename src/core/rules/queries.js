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
  return graph.nodesByType('translation')
    .filter(n => n.locale === locale)
    .map(n => n.key);
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
