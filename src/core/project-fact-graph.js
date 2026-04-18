import { resolveRenderTarget, resolveFunctionTarget, resolveGraphqlTarget } from './dependency-graph.js';

export function buildFactGraph(projectMap) {
  return new ProjectFactGraph(projectMap);
}

class ProjectFactGraph {
  constructor(projectMap) {
    this._map = projectMap;
    this._nodes = new Map();
    this._byType = new Map();
    this._dependsOn = new Map();
    this._referencedBy = new Map();
    this._renderCalls = new Map();

    this._indexNodes();
    this._buildEdges();
    this._indexRenderCalls();
  }

  _addNode(type, key, path, props = {}) {
    const node = Object.freeze({ type, key, path, ...props });
    if (path) this._nodes.set(path, node);
    if (!this._byType.has(type)) this._byType.set(type, new Map());
    this._byType.get(type).set(key, node);
    return node;
  }

  _addEdge(source, target) {
    if (!source || !target) return;
    if (!this._dependsOn.has(source)) this._dependsOn.set(source, new Set());
    if (!this._referencedBy.has(target)) this._referencedBy.set(target, new Set());
    this._dependsOn.get(source).add(target);
    this._referencedBy.get(target).add(source);
  }

  _indexNodes() {
    const m = this._map;

    for (const [key, page] of Object.entries(m.pages ?? {})) {
      this._addNode('page', key, page.path, {
        slug: page.slug, method: page.method, layout: page.layout,
        renders: page.renders, render_calls: page.render_calls,
        function_calls: page.function_calls,
      });
    }

    for (const [name, partial] of Object.entries(m.partials ?? {})) {
      this._addNode('partial', name, partial.path, {
        params: partial.params, renders: partial.renders,
        render_calls: partial.render_calls,
        function_calls: partial.function_calls, rendered_by: partial.rendered_by,
      });
    }

    for (const [path, cmd] of Object.entries(m.commands ?? {})) {
      this._addNode('command', path, path, {
        params: cmd.params, phases: cmd.phases,
        graphql_calls: cmd.graphql_calls, function_calls: cmd.function_calls,
      });
    }

    for (const [path, q] of Object.entries(m.queries ?? {})) {
      this._addNode('query', path, path, {
        params: q.params, graphql_calls: q.graphql_calls,
        function_calls: q.function_calls,
      });
    }

    for (const [name, gql] of Object.entries(m.graphql ?? {})) {
      this._addNode('graphql', name, `app/graphql/${name}.graphql`, {
        operation: gql.operation, gqlName: gql.name, args: gql.args, table: gql.table,
      });
    }

    for (const [name, schema] of Object.entries(m.schema ?? {})) {
      this._addNode('schema', name, schema.path, { properties: schema.properties });
    }

    for (const [path, layout] of Object.entries(m.layouts ?? {})) {
      this._addNode('layout', path, layout.path, {
        renders: layout.renders,
        render_calls: layout.render_calls,
        function_calls: layout.function_calls,
      });
    }

    for (const [locale, keys] of Object.entries(m.translations ?? {})) {
      for (const key of Object.keys(keys)) {
        this._addNode('translation', `${locale}:${key}`, null, {
          locale, key, value: keys[key],
        });
      }
    }

    for (const asset of (m.assets ?? [])) {
      this._addNode('asset', asset, `app/assets/${asset}`);
    }
  }

  _buildEdges() {
    const m = this._map;

    const layoutsByName = {};
    for (const layout of Object.values(m.layouts ?? {})) {
      if (!layout?.path) continue;
      const name = layout.path
        .replace(/^app\/views\/layouts\//, '')
        .replace(/\.html\.liquid$/, '')
        .replace(/\.liquid$/, '');
      layoutsByName[name] = layout.path;
    }

    for (const page of Object.values(m.pages ?? {})) {
      if (!page?.path) continue;
      for (const r of page.renders ?? []) {
        this._addEdge(page.path, resolveRenderTarget(r, m, page.path));
      }
      for (const fc of page.function_calls ?? []) {
        this._addEdge(page.path, resolveFunctionTarget(fc.path));
      }
      if (page.layout) {
        const layoutPath = layoutsByName[page.layout];
        if (layoutPath) this._addEdge(page.path, layoutPath);
      }
    }

    for (const layout of Object.values(m.layouts ?? {})) {
      if (!layout?.path) continue;
      for (const r of layout.renders ?? []) {
        this._addEdge(layout.path, resolveRenderTarget(r, m, layout.path));
      }
      for (const fc of layout.function_calls ?? []) {
        this._addEdge(layout.path, resolveFunctionTarget(fc.path));
      }
    }

    for (const partial of Object.values(m.partials ?? {})) {
      if (!partial?.path) continue;
      for (const r of partial.renders ?? []) {
        this._addEdge(partial.path, resolveRenderTarget(r, m, partial.path));
      }
      for (const fc of partial.function_calls ?? []) {
        this._addEdge(partial.path, resolveFunctionTarget(fc.path));
      }
    }

    for (const [cmdPath, cmd] of Object.entries(m.commands ?? {})) {
      for (const fc of cmd.function_calls ?? []) {
        this._addEdge(cmdPath, resolveFunctionTarget(fc.path));
      }
      for (const g of cmd.graphql_calls ?? []) {
        const opName = typeof g === 'string' ? g : g?.queryName;
        this._addEdge(cmdPath, resolveGraphqlTarget(opName));
      }
    }

    for (const [qPath, q] of Object.entries(m.queries ?? {})) {
      for (const fc of q.function_calls ?? []) {
        this._addEdge(qPath, resolveFunctionTarget(fc.path));
      }
      for (const g of q.graphql_calls ?? []) {
        const opName = typeof g === 'string' ? g : g?.queryName;
        this._addEdge(qPath, resolveGraphqlTarget(opName));
      }
    }
  }

  _indexRenderCalls() {
    for (const [path, node] of this._nodes) {
      const calls = node.render_calls;
      if (calls && calls.length > 0) {
        this._renderCalls.set(path, calls);
      }
    }
  }

  // ── Query API ──

  nodeByPath(path) {
    return this._nodes.get(path) ?? null;
  }

  nodesByType(type) {
    const m = this._byType.get(type);
    return m ? [...m.values()] : [];
  }

  nodeByKey(type, key) {
    return this._byType.get(type)?.get(key) ?? null;
  }

  hasNode(path) {
    return this._nodes.has(path);
  }

  dependsOn(path) {
    return [...(this._dependsOn.get(path) ?? [])];
  }

  referencedBy(path) {
    return [...(this._referencedBy.get(path) ?? [])];
  }

  allFiles() {
    return [...this._nodes.keys()].sort();
  }

  allLiquidFiles() {
    return this.allFiles().filter(f => f.endsWith('.liquid'));
  }

  allCheckableFiles() {
    return this.allFiles().filter(f => f.endsWith('.liquid') || f.endsWith('.graphql'));
  }

  get size() {
    return this._nodes.size;
  }

  get nodeCount() {
    const counts = {};
    for (const [type, m] of this._byType) counts[type] = m.size;
    return counts;
  }

  get edgeCount() {
    let n = 0;
    for (const set of this._dependsOn.values()) n += set.size;
    return n;
  }

  toDependencyGraph() {
    const graph = {};
    const seed = (p) => { if (p && !graph[p]) graph[p] = { depends_on: [], referenced_by: [] }; };

    for (const path of this._nodes.keys()) seed(path);
    for (const [source, targets] of this._dependsOn) {
      seed(source);
      for (const target of targets) {
        seed(target);
        graph[source].depends_on.push(target);
        graph[target].referenced_by.push(source);
      }
    }
    return graph;
  }

  checkEdgeIntegrity() {
    const missing = [];
    for (const [source, targets] of this._dependsOn) {
      for (const target of targets) {
        if (!this._nodes.has(target)) {
          missing.push({ source, target });
        }
      }
    }
    return missing;
  }

  renderCallsFrom(filePath) {
    return this._renderCalls.get(filePath) ?? [];
  }

  renderCallsTo(partialKey) {
    const results = [];
    for (const [callerPath, calls] of this._renderCalls) {
      for (const call of calls) {
        if (call.partial === partialKey) {
          results.push({ callerPath, args: call.args });
        }
      }
    }
    return results;
  }

  partialSignature(partialKey) {
    const node = this.nodeByKey('partial', partialKey);
    if (!node) return null;
    return node.params ?? [];
  }
}
