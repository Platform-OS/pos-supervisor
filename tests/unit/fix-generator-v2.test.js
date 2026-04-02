import { describe, it, expect } from 'bun:test';
import { generateFixes, clusterDiagnostics, generateScorecard } from '../../src/core/fix-generator.js';
import { parseLiquidFile } from '../../src/core/liquid-parser.js';
import { ObjectsIndex } from '../../src/core/objects-index.js';
import { FiltersIndex } from '../../src/core/filters-index.js';
import { TagsIndex } from '../../src/core/tags-index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeCtx() {
  const objectsIndex = new ObjectsIndex();
  objectsIndex._loaded = true;
  objectsIndex._byName.set('params', { name: 'params', handle: 'context.params', properties: ['slug', 'id'] });
  objectsIndex._byName.set('session', { name: 'session', handle: 'context.session', properties: ['cart', 'token'] });
  objectsIndex._byName.set('current_user', { name: 'current_user', handle: 'context.current_user', properties: ['id', 'email'] });

  const filtersIndex = new FiltersIndex();
  filtersIndex._loaded = true;
  filtersIndex._byName.set('json', { name: 'json', syntax: '{{ obj | json }}', summary: 'JSON encode' });
  filtersIndex._byName.set('downcase', { name: 'downcase', syntax: '{{ s | downcase }}', summary: 'Lowercase' });

  const tagsIndex = new TagsIndex();
  tagsIndex._loaded = true;
  tagsIndex._byName.set('render', { name: 'render', syntax: '{% render %}', summary: 'Render partial' });

  return { objectsIndex, filtersIndex, tagsIndex, schemaIndex: null };
}

// ── Contextual fix examples ──────────────────────────────────────────────────

describe('fix-generator-v2: contextual fix examples', () => {
  it('includes before/after context for text_edit fixes', () => {
    const content = '---\nslug: test\n---\n{{ params.id }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "params"',
      line: 3,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.context).toBeDefined();
    expect(fix.context.before).toContain('params');
    expect(fix.context.after).toContain('context.params');
    expect(fix.context.line).toBe(3);
  });

  it('includes before/after for filter rename', () => {
    const content = '{{ "hello" | donwcase }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UnknownFilter',
      severity: 'error',
      message: 'Unknown filter `donwcase`',
      line: 0,
      column: 14,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.context).toBeDefined();
    expect(fix.context.before).toContain('donwcase');
    expect(fix.context.after).toContain('downcase');
  });

  it('does not include context for guidance fixes', () => {
    const content = "{% for item in items %}\n  {% graphql result = 'get_item', id: item.id %}\n{% endfor %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'NestedGraphQLQuery',
      severity: 'warning',
      message: 'Nested graphql query',
      line: 1,
      column: 2,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix.type).toBe('guidance');
    expect(fix.context).toBeUndefined();
  });
});

// ── ImgLazyLoading fixes ─────────────────────────────────────────────────────

describe('fix-generator-v2: ImgLazyLoading', () => {
  it('inserts loading="lazy" into img tag', () => {
    const content = '<img src="photo.jpg">';
    const diagnostics = [{
      check: 'ImgLazyLoading',
      severity: 'warning',
      message: 'Image tag missing loading="lazy"',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, content,
      'app/views/partials/card.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe(' loading="lazy"');
    expect(fix.description).toContain('loading="lazy"');
  });

  it('inserts before self-closing />', () => {
    const content = '<img src="photo.jpg" />';
    const diagnostics = [{
      check: 'ImgLazyLoading',
      severity: 'warning',
      message: 'Image tag missing loading="lazy"',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, content,
      'app/views/partials/card.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe(' loading="lazy"');
  });

  it('does not insert if loading= already exists', () => {
    const content = '<img src="photo.jpg" loading="eager">';
    const diagnostics = [{
      check: 'ImgLazyLoading',
      severity: 'warning',
      message: 'Image tag missing loading="lazy"',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, content,
      'app/views/partials/card.liquid',
      makeCtx()
    );

    // Should not produce a text_edit since loading= already exists
    expect(proposedFixes.filter(f => f.type === 'text_edit')).toHaveLength(0);
  });
});

// ── ImgWidthAndHeight fixes ──────────────────────────────────────────────────

describe('fix-generator-v2: ImgWidthAndHeight', () => {
  it('inserts width="" and height="" into img tag', () => {
    const content = '<img src="photo.jpg">';
    const diagnostics = [{
      check: 'ImgWidthAndHeight',
      severity: 'warning',
      message: 'Image tag missing width/height',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, content,
      'app/views/partials/card.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('width=""');
    expect(fix.new_text).toContain('height=""');
  });

  it('only inserts missing attribute when one exists', () => {
    const content = '<img src="photo.jpg" width="100">';
    const diagnostics = [{
      check: 'ImgWidthAndHeight',
      severity: 'warning',
      message: 'Image tag missing height',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, content,
      'app/views/partials/card.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('height=""');
    expect(fix.new_text).not.toContain('width=""');
  });
});

// ── HardcodedRoutes fixes ────────────────────────────────────────────────────

describe('fix-generator-v2: HardcodedRoutes', () => {
  it('suggests route_url for hardcoded path', () => {
    const content = '<a href="/products/123">Link</a>';
    const diagnostics = [{
      check: 'HardcodedRoutes',
      severity: 'warning',
      message: 'Hardcoded route "/products/123"',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, content,
      'app/views/partials/nav.liquid',
      makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix).toBeDefined();
    expect(fix.type).toBe('guidance');
    expect(fix.description).toContain('dynamically');
    expect(fix.description).toContain('append');
  });

  it('returns generic guidance when path not extractable', () => {
    const diagnostics = [{
      check: 'HardcodedRoutes',
      severity: 'warning',
      message: 'Hardcoded route detected',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '<a href="/x">',
      'app/views/partials/nav.liquid',
      makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix).toBeDefined();
    expect(fix.description).toContain('dynamically');
  });
});

// ── MissingPartial scaffolds ─────────────────────────────────────────────────

describe('fix-generator-v2: MissingPartial scaffolds', () => {
  it('generates scaffold with params from render tag', () => {
    const content = "{% render 'products/card', title: product.title, image: product.image %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'products/card'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/products.html.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'create_file');
    expect(fix).toBeDefined();
    expect(fix.scaffold).toBeTruthy();
    expect(fix.scaffold).toContain('{% doc %}');
    expect(fix.scaffold).toContain('@param {object} title');
    expect(fix.scaffold).toContain('@param {object} image');
    expect(fix.scaffold).toContain('{{ title }}');
    expect(fix.scaffold).toContain('{{ image }}');
  });

  it('generates scaffold for command with function tag', () => {
    const content = "{% function result = 'commands/orders/create', order: order_data, user_id: context.current_user.id %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'commands/orders/create'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/orders.html.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'create_file');
    expect(fix).toBeDefined();
    expect(fix.path).toBe('app/lib/commands/orders/create.liquid');
    if (fix.scaffold) {
      expect(fix.scaffold).toContain('{% doc %}');
      expect(fix.scaffold).toContain('return');
    }
  });

  it('returns null scaffold when no args found', () => {
    const content = "{% render 'simple/partial' %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'simple/partial'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    const fix = proposedFixes.find(f => f.type === 'create_file');
    expect(fix).toBeDefined();
    expect(fix.scaffold).toBeNull();
  });
});

// ── Error clustering ─────────────────────────────────────────────────────────

describe('fix-generator-v2: error clustering', () => {
  it('clusters multiple UndefinedObject errors for context properties', () => {
    const errors = [
      { check: 'UndefinedObject', message: 'Undefined object "params"', line: 3, column: 3, fix: { type: 'text_edit', new_text: 'context.params' } },
      { check: 'UndefinedObject', message: 'Undefined object "session"', line: 5, column: 3, fix: { type: 'text_edit', new_text: 'context.session' } },
      { check: 'UndefinedObject', message: 'Undefined object "current_user"', line: 7, column: 3, fix: { type: 'text_edit', new_text: 'context.current_user' } },
    ];

    const clusters = clusterDiagnostics(errors, []);
    expect(clusters.length).toBe(1);
    expect(clusters[0].check).toBe('UndefinedObject');
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].pattern).toBe('context_properties');
    expect(clusters[0].unified_fix).toContain('context.params');
    expect(clusters[0].unified_fix).toContain('context.session');
    expect(clusters[0].unified_fix).toContain('context.current_user');
    expect(clusters[0].items).toHaveLength(3);
  });

  it('clusters multiple UnknownFilter errors', () => {
    const errors = [
      { check: 'UnknownFilter', message: 'Unknown filter `monei`', line: 1 },
      { check: 'UnknownFilter', message: 'Unknown filter `img_tg`', line: 3 },
    ];

    const clusters = clusterDiagnostics(errors, []);
    expect(clusters.length).toBe(1);
    expect(clusters[0].check).toBe('UnknownFilter');
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].unified_fix).toContain('monei');
    expect(clusters[0].unified_fix).toContain('img_tg');
  });

  it('does not cluster single occurrences', () => {
    const errors = [
      { check: 'UndefinedObject', message: 'Undefined object "params"', line: 3 },
    ];

    const clusters = clusterDiagnostics(errors, []);
    expect(clusters).toHaveLength(0);
  });

  it('clusters across errors and warnings', () => {
    const errors = [
      { check: 'UndefinedObject', message: 'Undefined object "params"', line: 3 },
    ];
    const warnings = [
      { check: 'UndefinedObject', message: 'Undefined object "session"', line: 5 },
    ];

    const clusters = clusterDiagnostics(errors, warnings);
    expect(clusters.length).toBe(1);
    expect(clusters[0].count).toBe(2);
  });

  it('handles empty arrays', () => {
    const clusters = clusterDiagnostics([], []);
    expect(clusters).toHaveLength(0);
  });
});

// ── Architecture scorecard ───────────────────────────────────────────────────

describe('fix-generator-v2: architecture scorecard', () => {
  it('flags pages with 3+ queries', () => {
    const structural = {
      graphql_queries: [
        { variable: 'a', queryName: 'q1' },
        { variable: 'b', queryName: 'q2' },
        { variable: 'c', queryName: 'q3' },
      ],
      renders: ['card'],
      filters_used: ['json'],
      tags_used: ['graphql', 'render'],
      translation_keys: [],
      prompts: [],
    };

    const notes = generateScorecard(structural, 'pages', [], []);
    expect(notes.some(n => n.message.includes('3 GraphQL queries'))).toBe(true);
    expect(notes[0].level).toBe('advisory');
  });

  it('flags pages with 0 renders but many tags', () => {
    const structural = {
      graphql_queries: [],
      renders: [],
      filters_used: ['json', 'upcase'],
      tags_used: ['assign', 'if', 'for', 'graphql'],
      translation_keys: [],
      prompts: [],
    };

    const notes = generateScorecard(structural, 'pages', [], []);
    expect(notes.some(n => n.message.includes('renders 0 partials'))).toBe(true);
  });

  it('flags commands without try/catch for graphql', () => {
    const structural = {
      graphql_queries: [{ variable: 'g', queryName: 'create' }],
      renders: [],
      filters_used: [],
      tags_used: ['graphql', 'assign'],
      translation_keys: [],
      prompts: [],
    };

    const notes = generateScorecard(structural, 'commands', [], []);
    expect(notes.some(n => n.message.includes('{% try %}'))).toBe(true);
  });

  it('does not flag commands with try/catch', () => {
    const structural = {
      graphql_queries: [{ variable: 'g', queryName: 'create' }],
      renders: [],
      filters_used: [],
      tags_used: ['graphql', 'try', 'assign'],
      translation_keys: [],
      prompts: [],
    };

    const notes = generateScorecard(structural, 'commands', [], []);
    expect(notes.some(n => n.message.includes('{% try %}'))).toBe(false);
  });

  it('flags high translation key count', () => {
    const structural = {
      graphql_queries: [],
      renders: [],
      filters_used: ['t'],
      tags_used: [],
      translation_keys: Array.from({ length: 12 }, (_, i) => `key_${i}`),
      prompts: [],
    };

    const notes = generateScorecard(structural, 'partials', [], []);
    expect(notes.some(n => n.message.includes('12 translation keys'))).toBe(true);
  });

  it('flags excessive renders', () => {
    const structural = {
      graphql_queries: [],
      renders: Array.from({ length: 9 }, (_, i) => `partial_${i}`),
      filters_used: [],
      tags_used: ['render'],
      translation_keys: [],
      prompts: [],
    };

    const notes = generateScorecard(structural, 'pages', [], []);
    expect(notes.some(n => n.message.includes('9 partials'))).toBe(true);
  });

  it('returns empty for simple well-structured code', () => {
    const structural = {
      graphql_queries: [{ variable: 'g', queryName: 'search' }],
      renders: ['card', 'pagination'],
      filters_used: ['json', 't'],
      tags_used: ['graphql', 'render', 'assign'],
      translation_keys: ['app.title'],
      prompts: [],
    };

    const notes = generateScorecard(structural, 'pages', [], []);
    expect(notes).toHaveLength(0);
  });

  it('returns empty for null structural', () => {
    const notes = generateScorecard(null, 'pages', [], []);
    expect(notes).toHaveLength(0);
  });
});
