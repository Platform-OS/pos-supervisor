import { describe, it, expect } from 'bun:test';
import { enrichError, enrichAll } from '../../src/core/error-enricher.js';
import { FiltersIndex } from '../../src/core/filters-index.js';
import { ObjectsIndex } from '../../src/core/objects-index.js';
import { TagsIndex } from '../../src/core/tags-index.js';

describe('enrichError', () => {
  it('adds hint for known check name', async () => {
    const diagnostic = { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "params" used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid' });

    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('context');
  });

  it('returns null hint for unknown check name', async () => {
    const diagnostic = { check: 'NonExistentCheck', severity: 'error', message: 'Something went wrong' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid' });

    expect(result.hint).toBeNull();
  });

  it('adds variant hint for UndefinedObject in partials', async () => {
    const diagnostic = { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "product" used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///app/views/partials/card.liquid' });

    // Should try the 'partial' variant hint
    expect(result.hint).toBeDefined();
  });

  it('enriches UnknownFilter with closest match from index', async () => {
    const filtersIndex = new FiltersIndex();
    // Simulate loaded state with mock data
    filtersIndex._loaded = true;
    filtersIndex._byName.set('json', { name: 'json', syntax: '{{ obj | json }}', summary: 'Convert to JSON', platformOS: false, deprecated: false });
    filtersIndex._byName.set('jsonify', { name: 'jsonify', syntax: '{{ obj | jsonify }}', summary: 'JSON encode', platformOS: false, deprecated: false });

    const diagnostic = { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter `jsn` used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', filtersIndex });

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('json');
  });

  it('enriches UndefinedObject with context suggestion from index', async () => {
    const objectsIndex = new ObjectsIndex();
    objectsIndex._loaded = true;
    objectsIndex._byName.set('params', { name: 'params', handle: 'context.params', properties: ['slug', 'format', 'id'] });

    const diagnostic = { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "params" used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', objectsIndex });

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('context.params');
  });

  it('detects tag-used-as-filter mistake', async () => {
    const filtersIndex = new FiltersIndex();
    filtersIndex._loaded = true;

    const tagsIndex = new TagsIndex();
    tagsIndex._loaded = true;
    tagsIndex._byName.set('background', { name: 'background', syntax: '{% background %}', summary: 'Background job', platformOS: true });

    const diagnostic = { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter `background` used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', filtersIndex, tagsIndex });

    expect(result.suggestion).toContain('tag, not a filter');
    expect(result.suggestion).toContain('{% background');
  });
});

describe('MissingPartial hint template resolution', () => {
  it('resolves {{object}}, {{name}}, {{create_path}}, {{tag}} for a missing partial', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'blog_posts/indexa'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/index.html.liquid',
      content: "---\nslug: test\n---\n{% render 'blog_posts/indexa' %}",
    });

    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('partial');
    expect(result.hint).toContain('blog_posts/indexa');
    expect(result.hint).toContain('app/views/partials/blog_posts/indexa.liquid');
    expect(result.hint).toContain('render');
    // No unresolved template vars
    expect(result.hint).not.toContain('{{');
  });

  it('detects command type and resolves correct path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'commands/products/create'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content: "---\nslug: test\n---\n{% function result = 'commands/products/create', params: context.params %}",
    });

    expect(result.hint).toContain('command');
    expect(result.hint).toContain('app/lib/commands/products/create.liquid');
    expect(result.hint).toContain('function');
    expect(result.hint).not.toContain('{{');
  });

  it('detects query type and resolves correct path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'queries/products/search'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content: "---\nslug: test\n---\n{% function result = 'queries/products/search', query_params: context.params %}",
    });

    expect(result.hint).toContain('query');
    expect(result.hint).toContain('app/lib/queries/products/search.liquid');
    expect(result.hint).toContain('function');
    expect(result.hint).not.toContain('{{');
  });

  it('flags `lib/` prefix as invalid and points at the corrected path', async () => {
    // Regression: the `lib/commands/X` and `lib/queries/X` forms used to be
    // accepted as valid call forms in our hints/data — they aren't. The
    // upstream resolver searches `app/views/partials/` and `app/lib/`, so a
    // literal `lib/` prefix expands to `app/lib/lib/...` and never resolves.
    // The enricher must surface this distinctly, with the corrected path
    // (no phantom `app/lib/lib/...`) and a "drop the prefix" message —
    // never a "create the file" message.
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error',
      message: "'lib/commands/products/create' does not exist",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content: "---\nslug: test\n---\n{% function result = 'lib/commands/products/create', params: context.params %}",
    });

    expect(result.hint).toContain('lib/commands/products/create');
    expect(result.hint).toContain('commands/products/create');
    // Corrected disk path — the single-`lib/` resolution
    expect(result.hint).toContain('app/lib/commands/products/create.liquid');
    // Variant must not be the create-file template — the issue is the path
    // syntax, not a missing file
    expect(result.hint).not.toMatch(/STEP 2 — Create/);
    // Hint must call out the prefix as invalid (the fix is to drop it)
    expect(result.hint).toMatch(/lib\/[^\s]+ is not a valid path|drop the `lib\/` prefix/i);
    expect(result.hint).not.toContain('{{');
  });

  it('uses module variant hint for module paths — references project_map, no create path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error',
      message: "Missing partial 'modules/payments/helpers/format_price'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content: "---\nslug: test\n---\n{% render 'modules/payments/helpers/format_price' %}",
    });

    expect(result.hint).toContain('modules/payments/helpers/format_price');
    expect(result.hint).toContain('project_map');
    // Module hint must not suggest creating a file or prompt to install
    expect(result.hint).not.toContain('Create');
    expect(result.hint).not.toMatch(/install (the )?module/);
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('UndefinedObject hint template resolution', () => {
  it('resolves {{var_name}} in page context', async () => {
    const diagnostic = { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "product" used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///app/views/pages/index.html.liquid' });

    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('product');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('resolves {{var_name}} in partial variant', async () => {
    const diagnostic = { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "title" used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///app/views/partials/card.html.liquid' });

    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('title');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('TranslationKeyExists hint template resolution', () => {
  it('resolves {{key}}, {{yaml_snippet}}, {{yaml_path_comment}} for a scoped key', async () => {
    const diagnostic = {
      check: 'TranslationKeyExists',
      severity: 'error',
      message: "Translation key 'products.create.title' not found.",
    };
    const result = await enrichError(diagnostic, { uri: 'file:///app/views/pages/products.html.liquid' });

    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('products.create.title');
    expect(result.hint).toContain('products > create > title');
    expect(result.hint).toContain('en:');
    expect(result.hint).toContain('products:');
    expect(result.hint).toContain('create:');
    expect(result.hint).toContain('title:');
    // No unresolved {{template_vars}} (Liquid {{ 'key' | t }} examples are fine)
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('resolves {{key}} and generates flat yaml snippet for top-level key', async () => {
    const diagnostic = {
      check: 'TranslationKeyExists',
      severity: 'error',
      message: "Translation key 'welcome' not found.",
    };
    const result = await enrichError(diagnostic, { uri: 'file:///app/views/pages/index.html.liquid' });

    expect(result.hint).toContain('welcome');
    expect(result.hint).toContain('en:');
    expect(result.hint).not.toContain(' > ');  // flat key has no path separator
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('enrichAll', () => {
  it('enriches multiple diagnostics', async () => {
    const diagnostics = [
      { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "params" used.' },
      { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter "bad" used.' },
    ];
    const results = await enrichAll(diagnostics, { uri: 'file:///test.liquid' });

    expect(results).toHaveLength(2);
    expect(results[0].hint).toBeDefined();
    expect(results[1].hint).toBeDefined();
  });
});

describe('conditional hint rendering', () => {
  it('resolves {{#if has_suggestion}} conditional in UndefinedObject hint', async () => {
    const objectsIndex = new ObjectsIndex();
    objectsIndex._loaded = true;
    objectsIndex._byName.set('params', { name: 'params', handle: 'context.params', properties: ['slug', 'id'] });

    const diagnostic = { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "params" used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', objectsIndex });

    expect(result.hint).toContain('APPLY');  // has_suggestion branch
    expect(result.hint).not.toContain('NO suggestion');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('resolves {{filter_name}} in UnknownFilter hint', async () => {
    const filtersIndex = new FiltersIndex();
    filtersIndex._loaded = true;

    const diagnostic = { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter `badfilter` used.' };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', filtersIndex });

    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('badfilter');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});
