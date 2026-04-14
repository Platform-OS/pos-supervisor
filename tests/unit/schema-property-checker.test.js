import { describe, it, expect } from 'bun:test';
import {
  checkSchemaProperties,
  extractTableNames,
  resolveTableFromPath,
  loadSchemas,
} from '../../src/core/schema-property-checker.js';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'project');

// ── extractTableNames ────────────────────────────────────────────────────────

describe('extractTableNames', () => {
  it('extracts table from mutation (table: "X")', () => {
    const content = `mutation create($title: String!) {
      record_create(record: { table: "blog_post" properties: [] }) { id }
    }`;
    expect(extractTableNames(content, '')).toEqual(['blog_post']);
  });

  it('extracts table from query filter (table: { value: "X" })', () => {
    const content = `query search {
      records(filter: { table: { value: "blog_post" } }) { results { id } }
    }`;
    expect(extractTableNames(content, '')).toEqual(['blog_post']);
  });

  it('extracts multiple tables from a single file', () => {
    const content = `mutation {
      a: record_create(record: { table: "blog_post" properties: [] }) { id }
      b: record_create(record: { table: "comment" properties: [] }) { id }
    }`;
    const names = extractTableNames(content, '');
    expect(names).toContain('blog_post');
    expect(names).toContain('comment');
  });

  it('deduplicates table names', () => {
    const content = `mutation {
      a: record_create(record: { table: "blog_post" properties: [] }) { id }
      b: record_update(record: { table: "blog_post" properties: [] }) { id }
    }`;
    expect(extractTableNames(content, '')).toEqual(['blog_post']);
  });

  it('skips modules/ prefixed table names', () => {
    const content = `mutation { record_create(record: { table: "modules/user/profile" properties: [] }) { id } }`;
    expect(extractTableNames(content, '')).toEqual([]);
  });

  it('falls back to path-based resolution when no table in content', () => {
    const content = `query { records { results { id } } }`;
    const names = extractTableNames(content, 'app/graphql/blog_posts/search.graphql');
    expect(names).toEqual(['blog_post']);
  });

  it('returns empty for non-graphql paths with no table', () => {
    const content = `query { records { results { id } } }`;
    expect(extractTableNames(content, 'app/views/pages/index.html.liquid')).toEqual([]);
  });
});

// ── resolveTableFromPath ─────────────────────────────────────────────────────

describe('resolveTableFromPath', () => {
  it('singularizes standard plural (blog_posts → blog_post)', () => {
    expect(resolveTableFromPath('app/graphql/blog_posts/create.graphql')).toBe('blog_post');
  });

  it('singularizes -ies plural (categories → category)', () => {
    expect(resolveTableFromPath('app/graphql/categories/search.graphql')).toBe('category');
  });

  it('singularizes -ses plural (statuses → status)', () => {
    expect(resolveTableFromPath('app/graphql/statuses/find.graphql')).toBe('status');
  });

  it('singularizes -ches plural (watches → watch)', () => {
    expect(resolveTableFromPath('app/graphql/watches/find.graphql')).toBe('watch');
  });

  it('handles already-singular names', () => {
    expect(resolveTableFromPath('app/graphql/post/create.graphql')).toBe('post');
  });

  it('returns null for non-graphql paths', () => {
    expect(resolveTableFromPath('app/views/pages/index.html.liquid')).toBeNull();
  });

  it('handles nested graphql paths', () => {
    expect(resolveTableFromPath('app/graphql/blog_posts/admin/create.graphql')).toBe('blog_post');
  });
});

// ── loadSchemas ──────────────────────────────────────────────────────────────

describe('loadSchemas', () => {
  it('loads blog_post schema from fixture project', () => {
    const result = loadSchemas(FIXTURE_DIR, ['blog_post']);
    expect(result.blog_post).toBeDefined();
    expect(result.blog_post.get('title')).toBe('string');
    expect(result.blog_post.get('body')).toBe('text');
    expect(result.blog_post.get('author_id')).toBe('string');
  });

  it('returns empty for non-existent schema', () => {
    const result = loadSchemas(FIXTURE_DIR, ['nonexistent_table']);
    expect(result.nonexistent_table).toBeUndefined();
  });

  it('returns empty for non-existent projectDir', () => {
    const result = loadSchemas('/tmp/no-such-dir-12345', ['blog_post']);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── checkSchemaProperties — accessor checks ──────────────────────────────────

describe('checkSchemaProperties — accessor checks', () => {
  it('reports unknown property in accessor', () => {
    const content = `query {
      records(filter: { table: { value: "blog_post" } properties: [{ name: "nonexistent" contains: $q }] }) {
        results { id property(name: "nonexistent") }
      }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/search.graphql', FIXTURE_DIR);
    const unknown = warnings.filter(w => w.check === 'pos-supervisor:UnknownSchemaProperty');
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown[0].message).toContain('nonexistent');
    expect(unknown[0].message).toContain('blog_post');
  });

  it('does not report known properties with correct accessor', () => {
    const content = `query {
      records(filter: { table: { value: "blog_post" } }) {
        results { id property(name: "title") }
      }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/search.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('reports type mismatch: property_int for string field', () => {
    const content = `query {
      records(filter: { table: { value: "blog_post" } }) {
        results { id property_int(name: "title") }
      }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/search.graphql', FIXTURE_DIR);
    const mismatch = warnings.filter(w => w.check === 'pos-supervisor:SchemaPropertyTypeMismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].message).toContain('title');
    expect(mismatch[0].message).toContain('string');
    expect(mismatch[0].message).toContain('property');
  });

  it('skips built-in fields (id, created_at, etc.)', () => {
    const content = `query {
      records(filter: { table: { value: "blog_post" } }) {
        results { property(name: "id") property(name: "created_at") property(name: "updated_at") }
      }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/search.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('includes line number in warnings', () => {
    const content = `query {\n  records(filter: { table: { value: "blog_post" } }) {\n    results { property(name: "nonexistent") }\n  }\n}`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/search.graphql', FIXTURE_DIR);
    expect(warnings.length).toBeGreaterThan(0);
    expect(typeof warnings[0].line).toBe('number');
    expect(warnings[0].line).toBe(2);
  });
});

// ── checkSchemaProperties — mutation value key checks ────────────────────────

describe('checkSchemaProperties — mutation checks', () => {
  it('valid mutation properties produce no warnings', () => {
    const content = `mutation create($title: String!) {
      record_create(record: {
        table: "blog_post"
        properties: [
          { name: "title", value: $title }
          { name: "body", value: $body }
        ]
      }) { id }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/create.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('reports unknown property in mutation', () => {
    const content = `mutation create($foo: String!) {
      record_create(record: {
        table: "blog_post"
        properties: [
          { name: "foo_bar", value: $foo }
        ]
      }) { id }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/create.graphql', FIXTURE_DIR);
    const unknown = warnings.filter(w => w.check === 'pos-supervisor:UnknownSchemaProperty');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain('foo_bar');
  });

  it('reports value key mismatch in mutation (value_int for string)', () => {
    const content = `mutation create($title: Int!) {
      record_create(record: {
        table: "blog_post"
        properties: [
          { name: "title", value_int: $title }
        ]
      }) { id }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/create.graphql', FIXTURE_DIR);
    const mismatch = warnings.filter(w => w.check === 'pos-supervisor:SchemaPropertyTypeMismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].message).toContain('title');
    expect(mismatch[0].message).toContain('value');
  });

  it('skips built-in fields in mutations', () => {
    const content = `mutation {
      record_create(record: {
        table: "blog_post"
        properties: [{ name: "id", value: "123" }]
      }) { id }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/create.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });
});

// ── checkSchemaProperties — path-based table resolution ──────────────────────

describe('checkSchemaProperties — path-based table resolution', () => {
  it('resolves table from path when content has no table declaration', () => {
    const content = `query { records { results { id property(name: "nonexistent_field") } } }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/custom.graphql', FIXTURE_DIR);
    const unknown = warnings.filter(w => w.check === 'pos-supervisor:UnknownSchemaProperty');
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown[0].message).toContain('blog_post');
  });
});

// ── checkSchemaProperties — edge cases ───────────────────────────────────────

describe('checkSchemaProperties — edge cases', () => {
  it('returns empty for null projectDir', () => {
    const { warnings } = checkSchemaProperties('query { x }', 'test.graphql', null);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty for empty content', () => {
    const { warnings } = checkSchemaProperties('', 'test.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty when no table can be determined', () => {
    const content = `query { records { results { id property(name: "title") } } }`;
    const { warnings } = checkSchemaProperties(content, 'app/lib/something.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty when schema file does not exist for resolved table', () => {
    const content = `mutation { record_create(record: { table: "nonexistent_table" properties: [{ name: "x", value: $x }] }) { id } }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/test/create.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('handles multiple accessor types for different properties', () => {
    const content = `query {
      records(filter: { table: { value: "blog_post" } }) {
        results {
          property(name: "title")
          property(name: "body")
          property(name: "author_id")
        }
      }
    }`;
    const { warnings } = checkSchemaProperties(content, 'app/graphql/blog_posts/search.graphql', FIXTURE_DIR);
    expect(warnings).toHaveLength(0);
  });

  it('lists defined properties in unknown-property message', () => {
    const content = `query {
      records(filter: { table: { value: "blog_post" } }) {
        results { property(name: "nope") }
      }
    }`;
    const { warnings } = checkSchemaProperties(content, 'test.graphql', FIXTURE_DIR);
    expect(warnings[0].message).toContain('title');
    expect(warnings[0].message).toContain('body');
    expect(warnings[0].message).toContain('author_id');
  });
});

// ── checkSchemaProperties — fixture file validation ──────────────────────────

describe('checkSchemaProperties — fixture files produce no false positives', () => {
  const fixtureGraphqlDir = join(FIXTURE_DIR, 'app', 'graphql', 'blog_posts');

  for (const file of ['create.graphql', 'search.graphql', 'find.graphql', 'delete.graphql']) {
    it(`${file} has zero warnings`, () => {
      const content = readFileSync(join(fixtureGraphqlDir, file), 'utf8');
      const { warnings } = checkSchemaProperties(content, `app/graphql/blog_posts/${file}`, FIXTURE_DIR);
      expect(warnings).toHaveLength(0);
    });
  }
});
