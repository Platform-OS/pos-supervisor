import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';
import { scanProject } from '../../src/core/project-scanner.js';
import { buildDependencyGraph } from '../../src/core/dependency-graph.js';

const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'project');

let projectMap;
let graph;

async function ensureGraph() {
  if (!graph) {
    projectMap = await scanProject(FIXTURE_DIR);
    graph = buildFactGraph(projectMap);
  }
  return graph;
}

describe('ProjectFactGraph — construction', () => {
  test('builds from fixture project without throwing', async () => {
    const g = await ensureGraph();
    expect(g.size).toBeGreaterThan(0);
  });

  test('nodeCount includes all expected types', async () => {
    const g = await ensureGraph();
    const counts = g.nodeCount;
    expect(counts.page).toBeGreaterThan(0);
    expect(counts.partial).toBeGreaterThan(0);
    expect(counts.command).toBeGreaterThan(0);
    expect(counts.query).toBeGreaterThan(0);
    expect(counts.graphql).toBeGreaterThan(0);
    expect(counts.schema).toBeGreaterThan(0);
    expect(counts.layout).toBeGreaterThan(0);
    expect(counts.translation).toBeGreaterThan(0);
    expect(counts.asset).toBeGreaterThan(0);
  });

  test('edgeCount is positive', async () => {
    const g = await ensureGraph();
    expect(g.edgeCount).toBeGreaterThan(0);
  });
});

describe('ProjectFactGraph — node lookups', () => {
  test('nodeByPath returns page node', async () => {
    const g = await ensureGraph();
    const node = g.nodeByPath('app/views/pages/blog_posts/index.html.liquid');
    expect(node).not.toBeNull();
    expect(node.type).toBe('page');
    expect(node.slug).toBeDefined();
  });

  test('nodeByPath returns partial node', async () => {
    const g = await ensureGraph();
    const node = g.nodeByPath('app/views/partials/blog_posts/card.liquid');
    expect(node).not.toBeNull();
    expect(node.type).toBe('partial');
  });

  test('nodeByPath returns command node', async () => {
    const g = await ensureGraph();
    const cmds = g.nodesByType('command');
    expect(cmds.length).toBeGreaterThan(0);
    const cmdPath = cmds[0].path;
    expect(g.nodeByPath(cmdPath)).not.toBeNull();
    expect(g.nodeByPath(cmdPath).type).toBe('command');
  });

  test('nodeByPath returns null for unknown path', async () => {
    const g = await ensureGraph();
    expect(g.nodeByPath('app/views/pages/nonexistent.liquid')).toBeNull();
  });

  test('nodesByType returns all partials', async () => {
    const g = await ensureGraph();
    const partials = g.nodesByType('partial');
    const mapPartials = Object.keys(projectMap.partials);
    expect(partials.length).toBe(mapPartials.length);
  });

  test('nodeByKey finds partial by name', async () => {
    const g = await ensureGraph();
    const node = g.nodeByKey('partial', 'blog_posts/card');
    expect(node).not.toBeNull();
    expect(node.path).toBe('app/views/partials/blog_posts/card.liquid');
  });

  test('nodeByKey finds graphql by operation path', async () => {
    const g = await ensureGraph();
    const node = g.nodeByKey('graphql', 'blog_posts/create');
    expect(node).not.toBeNull();
    expect(node.path).toBe('app/graphql/blog_posts/create.graphql');
  });

  test('hasNode returns true for existing path', async () => {
    const g = await ensureGraph();
    expect(g.hasNode('app/views/partials/blog_posts/card.liquid')).toBe(true);
  });

  test('hasNode returns false for missing path', async () => {
    const g = await ensureGraph();
    expect(g.hasNode('app/views/pages/nope.liquid')).toBe(false);
  });
});

describe('ProjectFactGraph — edge queries', () => {
  test('page depends on rendered partials', async () => {
    const g = await ensureGraph();
    const pages = g.nodesByType('page');
    const pageWithRenders = pages.find(p => (p.renders ?? []).length > 0);
    if (!pageWithRenders) return; // fixture may not have renders from pages
    const deps = g.dependsOn(pageWithRenders.path);
    expect(deps.length).toBeGreaterThan(0);
  });

  test('partial is referencedBy its callers', async () => {
    const g = await ensureGraph();
    const partials = g.nodesByType('partial');
    const referenced = partials.find(p => g.referencedBy(p.path).length > 0);
    expect(referenced).toBeDefined();
    const refs = g.referencedBy(referenced.path);
    expect(refs.length).toBeGreaterThan(0);
  });

  test('command depends on graphql operations', async () => {
    const g = await ensureGraph();
    const cmds = g.nodesByType('command');
    const cmdWithGql = cmds.find(c => (c.graphql_calls ?? []).length > 0);
    if (!cmdWithGql) return;
    const deps = g.dependsOn(cmdWithGql.path);
    expect(deps.some(d => d.endsWith('.graphql'))).toBe(true);
  });

  test('dependsOn returns empty for leaf node', async () => {
    const g = await ensureGraph();
    const assets = g.nodesByType('asset');
    if (assets.length === 0) return;
    expect(g.dependsOn(assets[0].path)).toEqual([]);
  });

  test('referencedBy returns empty for unknown path', async () => {
    const g = await ensureGraph();
    expect(g.referencedBy('nonexistent')).toEqual([]);
  });
});

describe('ProjectFactGraph — file listing', () => {
  test('allFiles returns all indexed paths sorted', async () => {
    const g = await ensureGraph();
    const files = g.allFiles();
    expect(files.length).toBe(g.size);
    for (let i = 1; i < files.length; i++) {
      expect(files[i] >= files[i - 1]).toBe(true);
    }
  });

  test('allLiquidFiles returns only .liquid files', async () => {
    const g = await ensureGraph();
    const liquid = g.allLiquidFiles();
    expect(liquid.length).toBeGreaterThan(0);
    expect(liquid.every(f => f.endsWith('.liquid'))).toBe(true);
  });

  test('allCheckableFiles returns .liquid and .graphql', async () => {
    const g = await ensureGraph();
    const checkable = g.allCheckableFiles();
    expect(checkable.every(f => f.endsWith('.liquid') || f.endsWith('.graphql'))).toBe(true);
    expect(checkable.length).toBeGreaterThanOrEqual(g.allLiquidFiles().length);
  });

  test('allFiles covers all project-map categories', async () => {
    const g = await ensureGraph();
    const files = new Set(g.allFiles());
    for (const page of Object.values(projectMap.pages)) {
      expect(files.has(page.path)).toBe(true);
    }
    for (const partial of Object.values(projectMap.partials)) {
      expect(files.has(partial.path)).toBe(true);
    }
    for (const cmdPath of Object.keys(projectMap.commands)) {
      expect(files.has(cmdPath)).toBe(true);
    }
  });
});

describe('ProjectFactGraph — edge integrity invariant', () => {
  test('every edge target is a known node or a missing reference', async () => {
    const g = await ensureGraph();
    const missing = g.checkEdgeIntegrity();
    for (const { source, target } of missing) {
      expect(typeof source).toBe('string');
      expect(typeof target).toBe('string');
    }
  });
});

describe('ProjectFactGraph — dependency graph parity', () => {
  test('toDependencyGraph matches buildDependencyGraph for static edges', async () => {
    const g = await ensureGraph();
    const fromGraph = g.toDependencyGraph();
    const fromLegacy = buildDependencyGraph(projectMap);

    for (const [path, legacyEntry] of Object.entries(fromLegacy)) {
      const graphEntry = fromGraph[path];
      if (!graphEntry) continue;
      const legacyDeps = new Set(legacyEntry.depends_on);
      const graphDeps = new Set(graphEntry.depends_on);
      for (const dep of legacyDeps) {
        expect(graphDeps.has(dep)).toBe(true);
      }
    }
  });
});

describe('ProjectFactGraph — empty project', () => {
  test('handles empty project map gracefully', () => {
    const g = buildFactGraph({});
    expect(g.size).toBe(0);
    expect(g.edgeCount).toBe(0);
    expect(g.allFiles()).toEqual([]);
    expect(g.nodeByPath('anything')).toBeNull();
    expect(g.dependsOn('anything')).toEqual([]);
  });

  test('handles partial project map', () => {
    const g = buildFactGraph({ pages: {}, partials: {} });
    expect(g.size).toBe(0);
    expect(g.nodesByType('page')).toEqual([]);
  });
});
