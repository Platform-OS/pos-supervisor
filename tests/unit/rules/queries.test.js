import { describe, test, expect } from 'bun:test';
import {
  nearestByLevenshtein, partialNames, commandPaths, queryPaths,
  partialsReachableFrom, dependentsOf, translationKeysForLocale,
  schemaNames, fileExists, classifyPath, stripLocalePrefix,
} from '../../../src/core/rules/queries.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

const FIXTURE_MAP = {
  pages: {
    'blog_posts:get': { path: 'app/views/pages/blog_posts/index.html.liquid', slug: 'blog_posts', method: 'get', renders: ['blog_posts/list'], function_calls: [] },
  },
  partials: {
    'blog_posts/list': { path: 'app/views/partials/blog_posts/list.liquid', params: [], renders: ['blog_posts/card'], function_calls: [], rendered_by: [] },
    'blog_posts/card': { path: 'app/views/partials/blog_posts/card.liquid', params: [], renders: [], function_calls: [], rendered_by: [] },
    'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid', params: [], renders: [], function_calls: [], rendered_by: [] },
  },
  commands: {
    'app/lib/commands/blog_posts/create.liquid': { params: [], phases: ['main'], graphql_calls: [{ queryName: 'blog_posts/create' }], function_calls: [] },
  },
  queries: {
    'app/lib/queries/blog_posts/find.liquid': { params: [], graphql_calls: [{ queryName: 'blog_posts/find' }], function_calls: [] },
  },
  graphql: {
    'blog_posts/create': { operation: 'mutation', name: 'CreateBlogPost', args: [], table: 'blog_post' },
    'blog_posts/find': { operation: 'query', name: 'FindBlogPost', args: [], table: 'blog_post' },
  },
  schema: {
    'blog_post': { path: 'app/schema/blog_post.yml', properties: [{ name: 'title', type: 'string' }] },
  },
  layouts: {},
  translations: { en: { 'app.title': 'Blog' } },
  assets: ['styles/app.css'],
};

const graph = buildFactGraph(FIXTURE_MAP);

describe('nearestByLevenshtein', () => {
  test('finds closest matches', () => {
    const result = nearestByLevenshtein('blog_posts/lst', ['blog_posts/list', 'blog_posts/card', 'blog_posts/form']);
    expect(result[0].name).toBe('blog_posts/list');
    expect(result[0].distance).toBe(1);
  });

  test('returns empty for no candidates', () => {
    expect(nearestByLevenshtein('test', [])).toEqual([]);
  });

  test('filters by max distance', () => {
    const result = nearestByLevenshtein('x', ['abcdefghij']);
    expect(result).toEqual([]);
  });

  test('returns up to k results', () => {
    const candidates = ['aa', 'ab', 'ac', 'ad', 'ae', 'af'];
    const result = nearestByLevenshtein('aa', candidates, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe('node queries', () => {
  test('partialNames returns all partial keys', () => {
    const names = partialNames(graph);
    expect(names).toContain('blog_posts/list');
    expect(names).toContain('blog_posts/card');
    expect(names).toContain('blog_posts/form');
  });

  test('commandPaths returns command keys', () => {
    const paths = commandPaths(graph);
    expect(paths).toContain('app/lib/commands/blog_posts/create.liquid');
  });

  test('queryPaths returns query keys', () => {
    const paths = queryPaths(graph);
    expect(paths).toContain('app/lib/queries/blog_posts/find.liquid');
  });

  test('schemaNames returns schema keys', () => {
    expect(schemaNames(graph)).toContain('blog_post');
  });

  test('translationKeysForLocale returns keys', () => {
    expect(translationKeysForLocale(graph, 'en')).toContain('app.title');
  });

  test('translationKeysForLocale strips the leading `<locale>.` prefix', () => {
    // Realistic shape: `flattenYaml` over a properly-rooted en.yml emits
    // keys prefixed with `en.` because the YAML root is the locale name.
    const realistic = buildFactGraph({
      pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {},
      translations: { en: { 'en.app.user.title': 'X', 'en.app.user.name': 'Y' } },
      assets: [],
    });
    const keys = translationKeysForLocale(realistic, 'en');
    expect(keys).toContain('app.user.title');
    expect(keys).toContain('app.user.name');
    expect(keys.every(k => !k.startsWith('en.'))).toBe(true);
  });

  test('translationKeysForLocale leaves bare keys untouched', () => {
    // Mis-shaped YAML (no locale wrapper) flattens to bare `app.title`.
    // The helper should NOT invent a prefix to strip.
    const bare = buildFactGraph({
      pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {},
      translations: { en: { 'app.title': 'X' } },
      assets: [],
    });
    expect(translationKeysForLocale(bare, 'en')).toEqual(['app.title']);
  });
});

describe('stripLocalePrefix', () => {
  test('strips matching `<locale>.` prefix', () => {
    expect(stripLocalePrefix('en.app.foo', 'en')).toBe('app.foo');
  });

  test('leaves a bare key unchanged', () => {
    expect(stripLocalePrefix('app.foo', 'en')).toBe('app.foo');
  });

  test('does not strip a different locale', () => {
    expect(stripLocalePrefix('pl.app.foo', 'en')).toBe('pl.app.foo');
  });

  test('handles edge inputs without throwing', () => {
    expect(stripLocalePrefix('', 'en')).toBe('');
    expect(stripLocalePrefix(null, 'en')).toBe(null);
    expect(stripLocalePrefix(undefined, 'en')).toBe(undefined);
  });

  test('default locale is `en`', () => {
    expect(stripLocalePrefix('en.app.foo')).toBe('app.foo');
  });
});

describe('partialsReachableFrom', () => {
  test('follows render edges transitively', () => {
    const reachable = partialsReachableFrom(graph, 'app/views/pages/blog_posts/index.html.liquid');
    expect(reachable).toContain('blog_posts/list');
    expect(reachable).toContain('blog_posts/card');
  });

  test('returns empty for leaf node', () => {
    expect(partialsReachableFrom(graph, 'app/views/partials/blog_posts/card.liquid')).toEqual([]);
  });
});

describe('dependentsOf', () => {
  test('returns callers of a partial', () => {
    const deps = dependentsOf(graph, 'app/views/partials/blog_posts/list.liquid');
    expect(deps).toContain('app/views/pages/blog_posts/index.html.liquid');
  });
});

describe('fileExists', () => {
  test('returns true for known path', () => {
    expect(fileExists(graph, 'app/views/partials/blog_posts/card.liquid')).toBe(true);
  });

  test('returns false for unknown path', () => {
    expect(fileExists(graph, 'app/views/partials/nope.liquid')).toBe(false);
  });
});

describe('classifyPath', () => {
  test('classifies partial', () => {
    expect(classifyPath('blog_posts/card')).toEqual({ type: 'partial', path: 'app/views/partials/blog_posts/card.liquid' });
  });

  test('classifies command', () => {
    expect(classifyPath('commands/blog_posts/create')).toEqual({ type: 'command', path: 'app/lib/commands/blog_posts/create.liquid' });
  });

  test('classifies lib/commands prefix', () => {
    expect(classifyPath('lib/commands/blog_posts/create')).toEqual({ type: 'command', path: 'app/lib/commands/blog_posts/create.liquid' });
  });

  test('classifies query', () => {
    expect(classifyPath('queries/blog_posts/find')).toEqual({ type: 'query', path: 'app/lib/queries/blog_posts/find.liquid' });
  });

  test('classifies module', () => {
    expect(classifyPath('modules/user/helpers/auth')).toEqual({ type: 'module', path: null });
  });

  test('handles null', () => {
    expect(classifyPath(null)).toEqual({ type: 'unknown', path: null });
  });
});
