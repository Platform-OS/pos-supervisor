import { describe, it, expect } from 'bun:test';
import { buildFixOrder } from '../../src/tools/analyze-project.js';

const DIR = '/project';

// Helper: build a dependency graph entry where `depends_on` uses absolute paths
function graph(entries) {
  // entries: { [relPath]: string[] } — depends_on as relative paths (we convert to abs)
  const g = {};
  for (const [path, deps] of Object.entries(entries)) {
    g[path] = { depends_on: deps.map(d => `${DIR}/${d}`) };
  }
  return g;
}

function file(path, errors = 1, warnings = 0) {
  return { path, errors, warnings };
}

describe('buildFixOrder', () => {
  it('returns empty array when no files have errors', () => {
    expect(buildFixOrder([], {}, DIR)).toEqual([]);
  });

  it('returns single file with no constraints', () => {
    const result = buildFixOrder([file('app/a.liquid')], {}, DIR);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('app/a.liquid');
    expect(result[0].reason).toBe('No cross-error dependencies');
    expect(result[0].dependents_with_errors).toBe(0);
  });

  it('places dependency before its dependent — simple chain', () => {
    // page.liquid renders partial.liquid; both have errors → fix partial first
    const files = [
      file('app/views/pages/show.html.liquid'),
      file('app/views/partials/items/show.liquid'),
    ];
    const g = graph({
      'app/views/pages/show.html.liquid': ['app/views/partials/items/show.liquid'],
      'app/views/partials/items/show.liquid': [],
    });

    const result = buildFixOrder(files, g, DIR);
    const paths = result.map(r => r.path);
    expect(paths.indexOf('app/views/partials/items/show.liquid'))
      .toBeLessThan(paths.indexOf('app/views/pages/show.html.liquid'));
  });

  it('annotates dependents_with_errors correctly', () => {
    const files = [
      file('app/views/pages/show.html.liquid'),
      file('app/views/partials/items/show.liquid'),
    ];
    const g = graph({
      'app/views/pages/show.html.liquid': ['app/views/partials/items/show.liquid'],
      'app/views/partials/items/show.liquid': [],
    });

    const result = buildFixOrder(files, g, DIR);
    const partial = result.find(r => r.path === 'app/views/partials/items/show.liquid');
    const page = result.find(r => r.path === 'app/views/pages/show.html.liquid');

    expect(partial.dependents_with_errors).toBe(1);
    expect(page.dependents_with_errors).toBe(0);
    expect(partial.reason).toMatch(/Fix first/);
  });

  it('three-level chain — deepest dependency first', () => {
    // graphql ← query ← page  (all have errors)
    const files = [
      file('app/views/pages/index.html.liquid'),
      file('app/lib/queries/items/search.liquid'),
      file('app/graphql/items/search.graphql'),
    ];
    const g = graph({
      'app/views/pages/index.html.liquid': ['app/lib/queries/items/search.liquid'],
      'app/lib/queries/items/search.liquid': ['app/graphql/items/search.graphql'],
      'app/graphql/items/search.graphql': [],
    });

    const result = buildFixOrder(files, g, DIR);
    const paths = result.map(r => r.path);
    expect(paths[0]).toBe('app/graphql/items/search.graphql');
    expect(paths[1]).toBe('app/lib/queries/items/search.liquid');
    expect(paths[2]).toBe('app/views/pages/index.html.liquid');
  });

  it('two files sharing a common broken dependency', () => {
    // partial.liquid is rendered by both page-a and page-b; all three have errors
    const files = [
      file('app/views/pages/a.html.liquid'),
      file('app/views/pages/b.html.liquid'),
      file('app/views/partials/shared/header.liquid'),
    ];
    const g = graph({
      'app/views/pages/a.html.liquid': ['app/views/partials/shared/header.liquid'],
      'app/views/pages/b.html.liquid': ['app/views/partials/shared/header.liquid'],
      'app/views/partials/shared/header.liquid': [],
    });

    const result = buildFixOrder(files, g, DIR);
    const paths = result.map(r => r.path);
    // header must come before both pages
    expect(paths.indexOf('app/views/partials/shared/header.liquid'))
      .toBeLessThan(paths.indexOf('app/views/pages/a.html.liquid'));
    expect(paths.indexOf('app/views/partials/shared/header.liquid'))
      .toBeLessThan(paths.indexOf('app/views/pages/b.html.liquid'));

    const header = result.find(r => r.path === 'app/views/partials/shared/header.liquid');
    expect(header.dependents_with_errors).toBe(2);
  });

  it('ignores dependencies that do not have errors', () => {
    // page depends on partial, but only page has errors — no ordering constraint
    const files = [file('app/views/pages/show.html.liquid')];
    const g = graph({
      'app/views/pages/show.html.liquid': ['app/views/partials/items/show.liquid'],
      // partial is NOT in fileResults (no errors)
    });

    const result = buildFixOrder(files, g, DIR);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('No cross-error dependencies');
    expect(result[0].dependents_with_errors).toBe(0);
  });

  it('handles files with no entry in dependency graph gracefully', () => {
    const files = [
      file('app/views/pages/a.html.liquid'),
      file('app/views/pages/b.html.liquid'),
    ];
    // No graph entries at all
    const result = buildFixOrder(files, {}, DIR);
    expect(result).toHaveLength(2);
    result.forEach(r => expect(r.reason).toBe('No cross-error dependencies'));
  });

  it('handles cycle — includes all files, marks as circular', () => {
    // a → b → a  (cycle)
    const files = [
      file('app/a.liquid'),
      file('app/b.liquid'),
    ];
    const g = graph({
      'app/a.liquid': ['app/b.liquid'],
      'app/b.liquid': ['app/a.liquid'],
    });

    const result = buildFixOrder(files, g, DIR);
    expect(result).toHaveLength(2);
    result.forEach(r => expect(r.reason).toBe('Circular dependency — fix in any order'));
  });

  it('reason shows "All dependencies fixed" for the tail file in a chain', () => {
    // graphql ← query ← page
    // graphql: no error-deps, 1 error-dependent  → "Fix first"
    // query:   1 error-dep,   1 error-dependent  → "Fix first"
    // page:    1 error-dep,   0 error-dependents → "All dependencies fixed"
    const files = [
      file('app/views/pages/index.html.liquid'),
      file('app/lib/queries/items/search.liquid'),
      file('app/graphql/items/search.graphql'),
    ];
    const g = graph({
      'app/views/pages/index.html.liquid': ['app/lib/queries/items/search.liquid'],
      'app/lib/queries/items/search.liquid': ['app/graphql/items/search.graphql'],
      'app/graphql/items/search.graphql': [],
    });

    const result = buildFixOrder(files, g, DIR);
    const page = result.find(r => r.path === 'app/views/pages/index.html.liquid');
    const query = result.find(r => r.path === 'app/lib/queries/items/search.liquid');
    const graphql = result.find(r => r.path === 'app/graphql/items/search.graphql');

    expect(graphql.reason).toMatch(/Fix first/);
    expect(query.reason).toMatch(/Fix first/);
    expect(page.reason).toBe('All dependencies fixed — fix this next');
  });

  it('preserves errors and warnings counts in output', () => {
    const files = [file('app/a.liquid', 3, 2)];
    const result = buildFixOrder(files, {}, DIR);
    expect(result[0].errors).toBe(3);
    expect(result[0].warnings).toBe(2);
  });

  it('handles projectDir with trailing slash', () => {
    const files = [
      file('app/views/pages/show.html.liquid'),
      file('app/views/partials/items/show.liquid'),
    ];
    // depends_on uses abs paths with the trailing-slash DIR
    const g = {
      'app/views/pages/show.html.liquid': {
        depends_on: ['/project/app/views/partials/items/show.liquid'],
      },
      'app/views/partials/items/show.liquid': { depends_on: [] },
    };

    const result = buildFixOrder(files, g, '/project/');
    const paths = result.map(r => r.path);
    expect(paths.indexOf('app/views/partials/items/show.liquid'))
      .toBeLessThan(paths.indexOf('app/views/pages/show.html.liquid'));
  });
});
