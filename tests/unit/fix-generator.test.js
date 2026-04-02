import { describe, it, expect } from 'bun:test';
import { generateFixes } from '../../src/core/fix-generator.js';
import { parseLiquidFile } from '../../src/core/liquid-parser.js';
import { ObjectsIndex } from '../../src/core/objects-index.js';
import { FiltersIndex } from '../../src/core/filters-index.js';
import { TagsIndex } from '../../src/core/tags-index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeObjectsIndex() {
  const idx = new ObjectsIndex();
  idx._loaded = true;
  idx._byName.set('params', { name: 'params', handle: 'context.params', properties: ['slug', 'id'] });
  idx._byName.set('page', { name: 'page', handle: 'context.page', properties: ['slug', 'metadata'] });
  idx._byName.set('current_user', { name: 'current_user', handle: 'context.current_user', properties: ['id', 'email'] });
  idx._byName.set('context', { name: 'context', handle: 'context', properties: ['params', 'page'] });
  return idx;
}

function makeFiltersIndex() {
  const idx = new FiltersIndex();
  idx._loaded = true;
  idx._byName.set('json', { name: 'json', category: 'string', syntax: '{{ obj | json }}', summary: 'JSON encode' });
  idx._byName.set('downcase', { name: 'downcase', category: 'string', syntax: '{{ s | downcase }}', summary: 'Lowercase' });
  idx._byName.set('pricify', { name: 'pricify', category: 'number', syntax: '{{ n | pricify }}', summary: 'Format price' });
  idx._byName.set('upcase', { name: 'upcase', category: 'string', syntax: '{{ s | upcase }}', summary: 'Uppercase' });
  return idx;
}

function makeTagsIndex() {
  const idx = new TagsIndex();
  idx._loaded = true;
  idx._byName.set('render', { name: 'render', syntax: '{% render %}', summary: 'Render partial' });
  idx._byName.set('graphql', { name: 'graphql', syntax: '{% graphql %}', summary: 'Execute GraphQL' });
  idx._byName.set('background', { name: 'background', syntax: '{% background %}', summary: 'Background job' });
  return idx;
}

function makeCtx(overrides = {}) {
  return {
    objectsIndex: makeObjectsIndex(),
    filtersIndex: makeFiltersIndex(),
    tagsIndex: makeTagsIndex(),
    schemaIndex: null,
    ...overrides,
  };
}

// ── UndefinedObject fixes ─────────────────────────────────────────────────────

describe('fix-generator: UndefinedObject', () => {
  it('generates context.X replacement for known object in a page', () => {
    const content = '---\nslug: test\n---\n{{ params.id }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "params"',
      line: 3,
      column: 3,
    }];

    const { proposedFixes, diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('text_edit');
    expect(fix.new_text).toBe('context.params');
    expect(fix.description).toContain('context.params');
  });

  it('generates {% doc %} param for undefined var in a partial', () => {
    const content = '<p>{{ post.title }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "post"',
      line: 0,
      column: 4,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/blog/card.liquid',
      makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('insert');
    expect(fix.new_text).toContain('{% doc %}');
    expect(fix.new_text).toContain('@param {object} post');
    expect(fix.new_text).toContain('{% enddoc %}');
  });

  it('merges multiple doc params into one {% doc %} block', () => {
    const content = '<p>{{ post.title }}</p>\n<p>{{ author.name }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "post"', line: 0, column: 4 },
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "author"', line: 1, column: 4 },
    ];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/blog/card.liquid',
      makeCtx()
    );

    // Should produce exactly one merged insert (not two separate ones)
    const inserts = proposedFixes.filter(f => f.type === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].new_text).toContain('@param {object} post');
    expect(inserts[0].new_text).toContain('@param {object} author');
    expect(inserts[0].resolves_params).toContain('post');
    expect(inserts[0].resolves_params).toContain('author');
  });

  it('inserts {% doc %} after front matter when present', () => {
    const content = '---\nslug: test\n---\n<p>{{ post.title }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "post"',
      line: 3,
      column: 4,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/blog/card.liquid',
      makeCtx()
    );

    const insert = proposedFixes.find(f => f.type === 'insert');
    expect(insert).toBeDefined();
    // Should insert after front matter (line 3 = after '---\nslug: test\n---\n')
    expect(insert.range.start.line).toBeGreaterThan(0);
  });

  it('appends to existing {% doc %} block', () => {
    const content = '{% doc %}\n  @param {object} existing_param\n{% enddoc %}\n<p>{{ post.title }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "post"',
      line: 3,
      column: 4,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/blog/card.liquid',
      makeCtx()
    );

    const insert = proposedFixes.find(f => f.type === 'insert');
    expect(insert).toBeDefined();
    expect(insert.new_text).toContain('@param {object} post');
    expect(insert.description).toContain('existing');
  });

  it('skips already-declared params in existing {% doc %}', () => {
    const content = '{% doc %}\n  @param {object} post\n{% enddoc %}\n<p>{{ post.title }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "post"',
      line: 3,
      column: 4,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/blog/card.liquid',
      makeCtx()
    );

    // Should produce guidance (already declared), not an insert
    const insert = proposedFixes.find(f => f.type === 'insert');
    expect(insert).toBeUndefined();
    const guidance = proposedFixes.find(f => f.type === 'guidance');
    expect(guidance).toBeDefined();
    expect(guidance.description).toContain('already declared');
  });

  it('does not generate fix for unknown var in a page (not a context object)', () => {
    const content = '---\nslug: test\n---\n{{ some_local_var.name }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "some_local_var"',
      line: 3,
      column: 3,
    }];

    const { proposedFixes, diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    // No fix for an unknown var in a page — it's likely a local from graphql/assign
    expect(proposedFixes).toHaveLength(0);
    expect(diagnosticFixes.size).toBe(0);
  });

  it('generates context.X fix even in partials for known context objects', () => {
    const content = '<p>{{ params.slug }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "params"',
      line: 0,
      column: 4,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/header.liquid',
      makeCtx()
    );

    // Known context object → replace with context.params, even in a partial
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe('context.params');
  });

  it('deduplicates identical text_edit fixes', () => {
    const content = '{{ params.id }}\n{{ params.slug }}';
    const ast = parseLiquidFile(content);
    // Two errors for same var at different positions → two separate text_edits
    const diagnostics = [
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "params"', line: 0, column: 3 },
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "params"', line: 1, column: 3 },
    ];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    // Both are text_edit for params→context.params but at different positions → both kept
    const textEdits = proposedFixes.filter(f => f.type === 'text_edit');
    expect(textEdits.length).toBe(2);
  });
});

// ── UnknownFilter fixes ──────────────────────────────────────────────────────

describe('fix-generator: UnknownFilter', () => {
  it('suggests closest filter match', () => {
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

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('text_edit');
    expect(fix.new_text).toBe('downcase');
  });

  it('detects tag used as filter', () => {
    const content = '{{ "hello" | render }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UnknownFilter',
      severity: 'error',
      message: 'Unknown filter `render`',
      line: 0,
      column: 14,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('guidance');
    expect(fix.description).toContain('tag, not a filter');
    expect(fix.description).toContain('{% render');
  });

  it('returns no fix for completely unknown filter with no close match', () => {
    const content = '{{ "hello" | zzzznotafilter }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UnknownFilter',
      severity: 'error',
      message: 'Unknown filter `zzzznotafilter`',
      line: 0,
      column: 14,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(0);
  });
});

// ── ConvertIncludeToRender fixes ─────────────────────────────────────────────

describe('fix-generator: ConvertIncludeToRender', () => {
  it('replaces include with render', () => {
    const content = "{% include 'shared/header' %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'ConvertIncludeToRender',
      severity: 'warning',
      message: 'Use render instead of include',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('text_edit');
    expect(fix.new_text).toBe('render');
    expect(fix.range.start.line).toBe(0);
    expect(fix.range.end.character).toBe(fix.range.start.character + 'include'.length);
  });
});

// ── DeprecatedTag fixes ──────────────────────────────────────────────────────

describe('fix-generator: DeprecatedTag', () => {
  it('replaces hash_assign with assign', () => {
    const content = '{% hash_assign x = "val" %}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'DeprecatedTag',
      severity: 'warning',
      message: 'Deprecated tag: hash_assign',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('text_edit');
    expect(fix.new_text).toBe('assign');
    expect(fix.description).toContain('hash_assign');
  });

  it('returns no fix for non-hash_assign deprecated tag', () => {
    const content = '{% some_other_deprecated_tag %}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'DeprecatedTag',
      severity: 'warning',
      message: 'Deprecated tag: some_other_deprecated_tag',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(0);
  });
});

// ── MissingPartial fixes ─────────────────────────────────────────────────────

describe('fix-generator: MissingPartial', () => {
  it('generates create_file for missing partial', () => {
    const content = "{% render 'products/card' %}";
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
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('create_file');
    expect(fix.path).toBe('app/views/partials/products/card.liquid');
  });

  it('generates correct path for missing command', () => {
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'commands/users/create'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '', 'app/views/pages/test.html.liquid', makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix.type).toBe('create_file');
    expect(fix.path).toBe('app/lib/commands/users/create.liquid');
  });

  it('generates correct path for missing query', () => {
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'queries/products/search'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '', 'app/views/pages/test.html.liquid', makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix.type).toBe('create_file');
    expect(fix.path).toBe('app/lib/queries/products/search.liquid');
  });

  it('returns guidance (not create_file) for module paths', () => {
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'modules/user/queries/user/current'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '', 'app/views/pages/test.html.liquid', makeCtx()
    );

    expect(proposedFixes.length).toBeGreaterThan(0);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('guidance');
    expect(fix.type).not.toBe('create_file');
  });

  it('references suggestion in guidance when module has completions', () => {
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'modules/user/queries/user/current'",
      line: 0,
      column: 3,
      suggestion: "'modules/user/queries/user/current' not found in module. Available: modules/user/queries/user/find",
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '', 'app/views/pages/test.html.liquid', makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix.type).toBe('guidance');
    expect(fix.description).toContain('suggestion field');
  });
});

// ── Scaffold generation ──────────────────────────────────────────────────────

describe('fix-generator: scaffold collection params', () => {
  it('generates for-loop scaffold for collection params', () => {
    const content = "{% render 'products/list', products: products %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'products/list'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content, 'app/views/pages/test.html.liquid', makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix.scaffold).toContain('for product in products');
    expect(fix.scaffold).not.toContain('{{ products }}');
  });

  it('generates simple output for singular params', () => {
    const content = "{% render 'blog_posts/card', post: post %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'blog_posts/card'",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content, 'app/views/pages/test.html.liquid', makeCtx()
    );

    const fix = proposedFixes[0];
    expect(fix.scaffold).toContain('{{ post }}');
    expect(fix.scaffold).not.toContain('for');
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('fix-generator: edge cases', () => {
  it('handles null AST gracefully', () => {
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "params"',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '{{ params.id }}',
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    // Should still work — falls back to diagnostic position
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe('context.params');
  });

  it('handles empty diagnostics array', () => {
    const { proposedFixes, diagnosticFixes } = generateFixes(
      [], null, '', 'app/views/pages/test.html.liquid', makeCtx()
    );

    expect(proposedFixes).toHaveLength(0);
    expect(diagnosticFixes.size).toBe(0);
  });

  it('handles unknown check type gracefully', () => {
    const diagnostics = [{
      check: 'SomeNewCheckWeHaveNeverSeen',
      severity: 'warning',
      message: 'Something happened',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '<p>test</p>',
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(0);
  });

  it('handles missing indexes gracefully', () => {
    const content = '{{ params.id }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "params"',
      line: 0,
      column: 3,
    }];

    // No indexes loaded
    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      { objectsIndex: null, filtersIndex: null, tagsIndex: null, schemaIndex: null }
    );

    // No context object match without index → no fix for page
    expect(proposedFixes).toHaveLength(0);
  });

  it('detects commands/ path as partial-like', () => {
    const content = '{{ item.name }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "item"',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/lib/commands/orders/create.liquid',
      makeCtx()
    );

    // commands/ is partial-like → should suggest {% doc %} param
    const insert = proposedFixes.find(f => f.type === 'insert');
    expect(insert).toBeDefined();
    expect(insert.new_text).toContain('@param {object} item');
  });

  it('detects queries/ path as partial-like', () => {
    const content = '{{ filter.name }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'UndefinedObject',
      severity: 'error',
      message: 'Undefined object "filter"',
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/lib/queries/products/search.liquid',
      makeCtx()
    );

    const insert = proposedFixes.find(f => f.type === 'insert');
    expect(insert).toBeDefined();
    expect(insert.new_text).toContain('@param {object} filter');
  });
});

// ── diagnosticFixes map correctness ──────────────────────────────────────────

describe('fix-generator: diagnosticFixes map', () => {
  it('maps each diagnostic index to its fix', () => {
    const content = '---\nslug: test\n---\n{{ params.id }}\n{{ "hello" | donwcase }}';
    const ast = parseLiquidFile(content);
    const diagnostics = [
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "params"', line: 3, column: 3 },
      { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter `donwcase`', line: 4, column: 14 },
    ];

    const { diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    // Index 0 = UndefinedObject → text_edit (context.params)
    expect(diagnosticFixes.has(0)).toBe(true);
    expect(diagnosticFixes.get(0).new_text).toBe('context.params');

    // Index 1 = UnknownFilter → text_edit (downcase)
    expect(diagnosticFixes.has(1)).toBe(true);
    expect(diagnosticFixes.get(1).new_text).toBe('downcase');
  });

  it('generates guidance fix for MissingRenderPartialArguments', () => {
    const content = "{% render 'products/card' %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: "Missing required argument 'title' for partial 'products/card' (@param {string} title)",
      line: 0,
      column: 0,
    }];

    const { proposedFixes, diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/products.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('guidance');
    expect(fix.description).toContain('title');
    expect(fix.description).toContain('products/card');
    expect(diagnosticFixes.has(0)).toBe(true);
  });

  it('generates guidance fix for MissingRenderPartialArguments without parseable message', () => {
    const diagnostics = [{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: 'Some unexpected message format',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '',
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('{% render %}');
  });

  it('includes variables in scope for MissingRenderPartialArguments inside for loop', () => {
    const content = `{% doc %}
  @param items {array}
{% enddoc %}
{% for item in items %}
  {% render 'products/card' %}
{% endfor %}`;
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: "Missing required argument 'product_id' for partial 'products/card'",
      line: 4,
      column: 2,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/caller.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].description).toContain('Variables in scope:');
    expect(proposedFixes[0].description).toContain('items (@param)');
    expect(proposedFixes[0].description).toContain('item ({% for item in items %})');
  });

  it('includes assign variables in scope for MissingRenderPartialArguments', () => {
    const content = `{% assign product_id = context.params.id %}
{% render 'products/card' %}`;
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: "Missing required argument 'title' for partial 'products/card'",
      line: 1,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].description).toContain('Variables in scope:');
    expect(proposedFixes[0].description).toContain('product_id ({% assign %})');
  });

  it('does not include scope info when AST is null', () => {
    const diagnostics = [{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: "Missing required argument 'title' for partial 'products/card'",
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, '',
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].description).not.toContain('Variables in scope');
  });

  it('generates guidance fix for NestedGraphQLQuery', () => {
    const content = "{% for item in items %}\n  {% graphql result = 'get_item', id: item.id %}\n{% endfor %}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'NestedGraphQLQuery',
      severity: 'warning',
      message: 'Nested graphql query detected inside a loop',
      line: 1,
      column: 2,
    }];

    const { proposedFixes, diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('guidance');
    expect(fix.description).toContain('BEFORE the loop');
    expect(fix.description).toContain('N+1');
    expect(diagnosticFixes.has(0)).toBe(true);
  });

  it('generates text_edit fix for TranslationKeyExists with Levenshtein suggestion', () => {
    const content = "{{ 'app.produts.title' | t }}";
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'TranslationKeyExists',
      severity: 'warning',
      message: "Translation key 'app.produts.title' does not exist. Did you mean 'app.products.title'?",
      line: 0,
      column: 3,
    }];

    const { proposedFixes, diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    const fix = proposedFixes[0];
    expect(fix.type).toBe('text_edit');
    expect(fix.new_text).toBe("'app.products.title'");
    expect(diagnosticFixes.has(0)).toBe(true);
  });

  it('generates guidance fix for TranslationKeyExists without suggestion', () => {
    const diagnostics = [{
      check: 'TranslationKeyExists',
      severity: 'warning',
      message: "Translation key 'app.custom.key' does not exist",
      line: 0,
      column: 3,
    }];

    const { proposedFixes } = generateFixes(
      diagnostics, null, "{{ 'app.custom.key' | t }}",
      'app/views/pages/test.html.liquid',
      makeCtx()
    );

    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('Translation key');
  });

  it('updates doc param fixes to reference merged insert', () => {
    const content = '<p>{{ post.title }}</p>\n<p>{{ author.name }}</p>';
    const ast = parseLiquidFile(content);
    const diagnostics = [
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "post"', line: 0, column: 4 },
      { check: 'UndefinedObject', severity: 'error', message: 'Undefined object "author"', line: 1, column: 4 },
    ];

    const { diagnosticFixes } = generateFixes(
      diagnostics, ast, content,
      'app/views/partials/blog/card.liquid',
      makeCtx()
    );

    // Both should reference the merged insert's description
    expect(diagnosticFixes.has(0)).toBe(true);
    expect(diagnosticFixes.has(1)).toBe(true);
    expect(diagnosticFixes.get(0).type).toBe('insert');
    expect(diagnosticFixes.get(1).type).toBe('insert');
    expect(diagnosticFixes.get(0).param_name).toBe('post');
    expect(diagnosticFixes.get(1).param_name).toBe('author');
  });
});
