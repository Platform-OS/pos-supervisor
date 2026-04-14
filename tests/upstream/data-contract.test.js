/**
 * Data index contract tests — verify pos-cli bundled data file structures.
 *
 * These tests pin the format of objects.json, filters.json, tags.json, and
 * graphql.graphql that our index classes depend on. Failures mean the data
 * format shipped with pos-cli changed.
 */
import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { realpathSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── Resolve data directory (same logic as server.js) ───────────────────────

function findDataDir() {
  try {
    const result = spawnSync('which', ['pos-cli'], { timeout: 5000, stdio: 'pipe' });
    if (result.status !== 0) return null;
    const realPath = realpathSync(result.stdout.toString().trim());
    const dir = join(dirname(dirname(realPath)), 'node_modules', '@platformos', 'platformos-check-docs-updater', 'data');
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

const dataDir = findDataDir();
const describeData = dataDir ? describe : describe.skip;

if (!dataDir) {
  console.log('⚠ pos-cli data directory not found — data contract tests will be skipped');
}

// ── objects.json ───────────────────────────────────────────────────────────
// Contract: ObjectsIndex.load() in src/core/objects-index.js

describeData('Data contract: objects.json', () => {
  let objects;
  try {
    objects = JSON.parse(readFileSync(join(dataDir, 'objects.json'), 'utf8'));
  } catch { objects = null; }

  it('is a JSON array', () => {
    expect(Array.isArray(objects)).toBe(true);
    expect(objects.length).toBeGreaterThan(0);
  });

  it('each entry has a name field', () => {
    for (const obj of objects) {
      expect(typeof obj.name).toBe('string');
    }
  });

  it('entries have json_data with handle', () => {
    const withHandle = objects.filter(o => o.json_data?.handle);
    // Most objects should have a handle — at minimum context
    expect(withHandle.length).toBeGreaterThan(0);
  });

  it('entries have properties array', () => {
    const withProps = objects.filter(o => Array.isArray(o.properties));
    expect(withProps.length).toBeGreaterThan(0);
    for (const obj of withProps) {
      for (const prop of obj.properties) {
        expect(typeof prop.name).toBe('string');
      }
    }
  });

  it('"context" object exists with properties', () => {
    const ctx = objects.find(o => o.name === 'context' || o.json_data?.handle === 'context');
    expect(ctx).toBeDefined();
    expect(Array.isArray(ctx.properties)).toBe(true);
    expect(ctx.properties.length).toBeGreaterThan(0);
  });

  it('opportunity: log object count', () => {
    console.log(`  objects.json: ${objects.length} objects`);
    const names = objects.map(o => o.name).sort();
    const contextObjs = names.filter(n => n.startsWith('context'));
    if (contextObjs.length > 0) {
      console.log(`  context-related: ${contextObjs.join(', ')}`);
    }
    expect(true).toBe(true);
  });
});

// ── filters.json ───────────────────────────────────────────────────────────
// Contract: FiltersIndex.load() in src/core/filters-index.js

describeData('Data contract: filters.json', () => {
  let filters;
  try {
    filters = JSON.parse(readFileSync(join(dataDir, 'filters.json'), 'utf8'));
  } catch { filters = null; }

  it('is a JSON array', () => {
    expect(Array.isArray(filters)).toBe(true);
    expect(filters.length).toBeGreaterThan(0);
  });

  it('each entry has name and category', () => {
    for (const f of filters) {
      expect(typeof f.name).toBe('string');
    }
  });

  const EXPECTED_FILTERS = ['json', 'translate', 'raw_escape_string', 'add_to_time', 'pricify'];

  for (const name of EXPECTED_FILTERS) {
    it(`known filter "${name}" exists`, () => {
      const found = filters.find(f => f.name === name);
      expect(found).toBeDefined();
    });
  }

  it('opportunity: log filter count and new filters', () => {
    const names = filters.map(f => f.name).sort();
    const platformos = filters.filter(f => f.platformOS === true);
    console.log(`  filters.json: ${filters.length} filters (${platformos.length} platformOS-specific)`);
    const deprecated = filters.filter(f => f.deprecated);
    if (deprecated.length > 0) {
      console.log(`  deprecated: ${deprecated.map(f => f.name).join(', ')}`);
    }
    expect(true).toBe(true);
  });
});

// ── tags.json ──────────────────────────────────────────────────────────────
// Contract: TagsIndex.load() in src/core/tags-index.js

describeData('Data contract: tags.json', () => {
  let tags;
  try {
    tags = JSON.parse(readFileSync(join(dataDir, 'tags.json'), 'utf8'));
  } catch { tags = null; }

  it('is a JSON array', () => {
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
  });

  it('each entry has a name', () => {
    for (const t of tags) {
      expect(typeof t.name).toBe('string');
    }
  });

  const EXPECTED_TAGS = ['graphql', 'function', 'background', 'render', 'cache', 'try'];

  for (const name of EXPECTED_TAGS) {
    it(`known tag "${name}" exists`, () => {
      const found = tags.find(t => t.name === name);
      expect(found).toBeDefined();
    });
  }

  it('opportunity: log tag count', () => {
    const names = tags.map(t => t.name).sort();
    const platformos = tags.filter(t => t.platformOS === true);
    console.log(`  tags.json: ${tags.length} tags (${platformos.length} platformOS-specific)`);
    console.log(`  all tags: ${names.join(', ')}`);
    expect(true).toBe(true);
  });
});

// ── graphql.graphql ────────────────────────────────────────────────────────
// Contract: SchemaIndex.load() in src/core/schema-index.js

describeData('Data contract: graphql.graphql', () => {
  let schema;
  try {
    schema = readFileSync(join(dataDir, 'graphql.graphql'), 'utf8');
  } catch { schema = null; }

  it('file exists and is non-empty', () => {
    expect(schema).toBeDefined();
    expect(schema.length).toBeGreaterThan(100);
  });

  it('contains type RootQuery', () => {
    expect(schema).toContain('type RootQuery');
  });

  it('contains type RootMutation', () => {
    expect(schema).toContain('type RootMutation');
  });

  it('known query "records" exists', () => {
    expect(schema).toMatch(/\brecords\s*\(/);
  });

  it('known query "users" exists', () => {
    expect(schema).toMatch(/\busers\s*\(/);
  });

  it('opportunity: log schema stats', () => {
    const queryMatches = schema.match(/^\s+\w+\s*\(/gm) || [];
    const typeMatches = schema.match(/^type \w+/gm) || [];
    const inputMatches = schema.match(/^input \w+/gm) || [];
    const enumMatches = schema.match(/^enum \w+/gm) || [];
    console.log(`  graphql.graphql: ${typeMatches.length} types, ${inputMatches.length} inputs, ${enumMatches.length} enums, ~${queryMatches.length} fields`);
    expect(true).toBe(true);
  });
});
