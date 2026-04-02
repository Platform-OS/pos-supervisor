import { describe, it, expect } from 'bun:test';
import { FiltersIndex } from '../../src/core/filters-index.js';
import { TagsIndex } from '../../src/core/tags-index.js';
import { ObjectsIndex, extractVarName } from '../../src/core/objects-index.js';
import { SchemaIndex, condenseArgs, parseRootFields } from '../../src/core/schema-index.js';

describe('FiltersIndex', () => {
  function makeIndex() {
    const idx = new FiltersIndex();
    idx._loaded = true;
    idx._byName.set('json', { name: 'json', category: 'string', syntax: '{{ obj | json }}', summary: 'JSON encode', platformOS: false, deprecated: false });
    idx._byName.set('pricify', { name: 'pricify', category: 'number', syntax: '{{ n | pricify }}', summary: 'Format price', platformOS: true, deprecated: false });
    idx._byName.set('old_filter', { name: 'old_filter', category: 'misc', syntax: '', summary: 'Old', platformOS: true, deprecated: true });
    return idx;
  }

  it('looks up filter by name', () => {
    const idx = makeIndex();
    expect(idx.lookup('json')).not.toBeNull();
    expect(idx.lookup('json').name).toBe('json');
    expect(idx.lookup('nonexistent')).toBeNull();
  });

  it('looks up multiple filters', () => {
    const idx = makeIndex();
    const results = idx.lookupMany(['json', 'pricify', 'nope']);
    expect(results).toHaveLength(2);
  });

  it('returns only non-deprecated platformOS filters', () => {
    const idx = makeIndex();
    const posFilters = idx.platformOSFilters();
    expect(posFilters).toHaveLength(1);
    expect(posFilters[0].name).toBe('pricify');
  });

  it('finds closest match by Levenshtein distance', () => {
    const idx = makeIndex();
    const match = idx.closestMatch('jsn');
    expect(match).not.toBeNull();
    expect(match.name).toBe('json');
  });

  it('returns null for no close match', () => {
    const idx = makeIndex();
    const match = idx.closestMatch('zzzzzzzzz');
    expect(match).toBeNull();
  });

  it('returns null when not loaded', () => {
    const idx = new FiltersIndex();
    expect(idx.lookup('json')).toBeNull();
    expect(idx.lookupMany(['json'])).toHaveLength(0);
    expect(idx.platformOSFilters()).toHaveLength(0);
    expect(idx.closestMatch('json')).toBeNull();
  });
});

describe('TagsIndex', () => {
  function makeIndex() {
    const idx = new TagsIndex();
    idx._loaded = true;
    idx._byName.set('render', { name: 'render', syntax: '{% render %}', summary: 'Render partial', platformOS: false, deprecated: false });
    idx._byName.set('graphql', { name: 'graphql', syntax: '{% graphql %}', summary: 'Execute GraphQL', platformOS: true, deprecated: false });
    idx._byName.set('background', { name: 'background', syntax: '{% background %}', summary: 'Background job', platformOS: true, deprecated: false });
    return idx;
  }

  it('looks up tag by name', () => {
    const idx = makeIndex();
    expect(idx.lookup('render')).not.toBeNull();
    expect(idx.lookup('nonexistent')).toBeNull();
  });

  it('checks if name is a tag', () => {
    const idx = makeIndex();
    expect(idx.isTag('render')).toBe(true);
    expect(idx.isTag('background')).toBe(true);
    expect(idx.isTag('notAtag')).toBe(false);
  });

  it('returns platformOS-specific tags', () => {
    const idx = makeIndex();
    const posTags = idx.platformOSTags();
    expect(posTags).toHaveLength(2);
    expect(posTags.map(t => t.name)).toContain('graphql');
    expect(posTags.map(t => t.name)).toContain('background');
  });
});

describe('ObjectsIndex', () => {
  function makeIndex() {
    const idx = new ObjectsIndex();
    idx._loaded = true;
    idx._byName.set('params', { name: 'params', handle: 'context.params', properties: ['slug', 'format', 'id'] });
    idx._byName.set('page', { name: 'page', handle: 'context.page', properties: ['slug', 'metadata'] });
    idx._byName.set('context', { name: 'context', handle: 'context', properties: ['params', 'session'] });
    return idx;
  }

  it('looks up object with different handle', () => {
    const idx = makeIndex();
    const obj = idx.lookup('params');
    expect(obj).not.toBeNull();
    expect(obj.handle).toBe('context.params');
  });

  it('returns null when handle matches name', () => {
    const idx = makeIndex();
    // context → context is not helpful
    expect(idx.lookup('context')).toBeNull();
  });

  it('returns null for unknown object', () => {
    const idx = makeIndex();
    expect(idx.lookup('nonexistent')).toBeNull();
  });

  it('returns context objects', () => {
    const idx = makeIndex();
    const objs = idx.contextObjects();
    expect(objs.length).toBeGreaterThan(0);
    // Sorted by property count descending
    for (let i = 1; i < objs.length; i++) {
      expect(objs[i - 1].properties.length).toBeGreaterThanOrEqual(objs[i].properties.length);
    }
  });
});

describe('extractVarName', () => {
  it('extracts double-quoted var', () => {
    expect(extractVarName('Unknown object "params" used.')).toBe('params');
  });

  it('extracts single-quoted var', () => {
    expect(extractVarName("Unknown object 'page' used.")).toBe('page');
  });

  it('returns null for no quotes', () => {
    expect(extractVarName('No quotes here')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractVarName(null)).toBeNull();
  });
});

describe('SchemaIndex helpers', () => {
  it('condenses args', () => {
    const result = condenseArgs('id: ID!, name: String, filters: [RecordFilter!]');
    expect(result).toContain('id: ID!');
    expect(result).toContain('name: String');
  });

  it('parseRootFields extracts simple fields', () => {
    const block = [
      '"""',
      'Get a record by ID',
      '"""',
      'records(id: ID!): Record @doc(category: "records")',
    ].join('\n');
    const fields = parseRootFields(block);
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('records');
    expect(fields[0].description).toBe('Get a record by ID');
    expect(fields[0].category).toBe('records');
  });
});
