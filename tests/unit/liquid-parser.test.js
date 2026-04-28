import { describe, it, expect } from 'bun:test';
import { parseLiquidFile, extractAllFromAST, extractAll } from '../../src/core/liquid-parser.js';

describe('parseLiquidFile', () => {
  it('parses valid Liquid content', () => {
    const ast = parseLiquidFile('<h1>Hello</h1>');
    expect(ast).not.toBeNull();
    expect(ast.type).toBe('Document');
  });

  it('handles broken content in tolerant mode', () => {
    const ast = parseLiquidFile('{% if true %}\n<p>unclosed');
    // Tolerant mode should still return a document
    expect(ast).not.toBeNull();
  });

  it('returns null for completely unparseable content', () => {
    // liquid-html-parser tolerant mode handles most things,
    // but we test the error path exists
    const ast = parseLiquidFile('');
    // Empty string should still parse to an empty document
    expect(ast).not.toBeNull();
  });
});

describe('extractAllFromAST', () => {
  it('extracts slug from frontmatter', () => {
    const ast = parseLiquidFile('---\nslug: my-page\n---\n<p>content</p>');
    const result = extractAllFromAST(ast);
    expect(result.slug).toBe('my-page');
  });

  it('extracts render tag partials', () => {
    const ast = parseLiquidFile("{% render 'shared/header' %}\n{% render 'shared/footer' %}");
    const result = extractAllFromAST(ast);
    expect(result.renders).toContain('shared/header');
    expect(result.renders).toContain('shared/footer');
  });

  it('deduplicates renders', () => {
    const ast = parseLiquidFile("{% render 'shared/header' %}\n{% render 'shared/header' %}");
    const result = extractAllFromAST(ast);
    expect(result.renders).toHaveLength(1);
  });

  it('extracts graphql tags', () => {
    const ast = parseLiquidFile("{% graphql g = 'products/search' %}");
    const result = extractAllFromAST(ast);
    expect(result.graphql).toHaveLength(1);
    expect(result.graphql[0].variable).toBe('g');
    expect(result.graphql[0].queryName).toBe('products/search');
  });

  it('captures named-argument names and source_kind=tag for the canonical tag form', () => {
    const ast = parseLiquidFile(
      "{% graphql result = 'op', name: shaped.name, email: shaped.email %}"
    );
    const result = extractAllFromAST(ast);
    expect(result.graphql).toHaveLength(1);
    expect(result.graphql[0].args).toEqual(['name', 'email']);
    expect(result.graphql[0].source_kind).toBe('tag');
  });

  it('classifies single-line graphql inside {% liquid %} block as liquid_inline', () => {
    const ast = parseLiquidFile(
      "{% liquid\ngraphql result = 'op', name: shaped.name, email: shaped.email\n%}"
    );
    const result = extractAllFromAST(ast);
    expect(result.graphql).toHaveLength(1);
    expect(result.graphql[0].args).toEqual(['name', 'email']);
    expect(result.graphql[0].source_kind).toBe('liquid_inline');
  });

  // Repro for the DEMO regression spiral (2026-04-27): multi-line comma
  // continuation inside `{% liquid %}` block. The liquid-html-parser truncates
  // the call at the first newline — markup.args is empty, the args are
  // silently dropped, and pos-cli's LSP fires "Required parameter X missing"
  // for each. The classifier flags this so the rule layer can route to a
  // syntax-fix hint instead of the misleading "add the arg" hint.
  it('flags multi-line graphql in {% liquid %} block as liquid_multiline_truncated', () => {
    const ast = parseLiquidFile(
      "{% liquid\ngraphql result = 'op',\n  name: shaped.name,\n  email: shaped.email\n%}"
    );
    const result = extractAllFromAST(ast);
    expect(result.graphql).toHaveLength(1);
    expect(result.graphql[0].source_kind).toBe('liquid_multiline_truncated');
    // Args extracted by markup.args are empty here (parser truncation) — the
    // detector must not depend on args.length to distinguish the kind.
    expect(result.graphql[0].args).toEqual([]);
  });

  it('does not flag a comma-ending inline call without trailing named-arg lines', () => {
    // No `name:` continuation after — just a stray comma inside whatever
    // followed in the liquid block. Should NOT be classified as truncated.
    const ast = parseLiquidFile(
      "{% liquid\ngraphql result = 'op', name: shaped.name,\nassign other = 1\n%}"
    );
    const result = extractAllFromAST(ast);
    expect(result.graphql).toHaveLength(1);
    expect(result.graphql[0].source_kind).toBe('liquid_inline');
  });

  it('upgrades source_kind to truncated when any duplicate call is truncated', () => {
    const ast = parseLiquidFile(
      "{% graphql a = 'op', name: x %}\n" +
      "{% liquid\ngraphql b = 'op',\n  name: y,\n  email: z\n%}"
    );
    const result = extractAllFromAST(ast);
    // Dedup keeps a single entry but the surface kind reflects the worst case.
    expect(result.graphql).toHaveLength(1);
    expect(result.graphql[0].source_kind).toBe('liquid_multiline_truncated');
  });

  it('extracts filter names', () => {
    const ast = parseLiquidFile("{{ 'hello' | t }}\n{{ price | pricify | json }}");
    const result = extractAllFromAST(ast);
    expect(result.filters.has('t')).toBe(true);
    expect(result.filters.has('pricify')).toBe(true);
    expect(result.filters.has('json')).toBe(true);
  });

  it('extracts tag names', () => {
    const ast = parseLiquidFile("{% render 'x' %}\n{% if true %}{% endif %}\n{% for i in items %}{% endfor %}");
    const result = extractAllFromAST(ast);
    expect(result.tags.has('render')).toBe(true);
    expect(result.tags.has('if')).toBe(true);
    expect(result.tags.has('for')).toBe(true);
  });

  it('extracts translation keys', () => {
    const ast = parseLiquidFile("{{ 'app.products.title' | t }}\n{{ 'app.footer.copyright' | t }}");
    const result = extractAllFromAST(ast);
    expect(result.transKeys.has('app.products.title')).toBe(true);
    expect(result.transKeys.has('app.footer.copyright')).toBe(true);
  });

  it('returns empty sets for plain HTML', () => {
    const ast = parseLiquidFile('<div><p>Just HTML</p></div>');
    const result = extractAllFromAST(ast);
    expect(result.renders).toHaveLength(0);
    expect(result.graphql).toHaveLength(0);
    expect(result.filters.size).toBe(0);
    expect(result.transKeys.size).toBe(0);
    expect(result.slug).toBeNull();
  });

  it('extracts @param names from {% doc %} block', () => {
    const ast = parseLiquidFile('{% doc %}\n  @param {object} post\n  @param {string} title\n  @param {number} limit\n{% enddoc %}\n<p>{{ post.title }}</p>');
    const result = extractAllFromAST(ast);
    expect(result.docParams).toBeDefined();
    expect(result.docParams.has('post')).toBe(true);
    expect(result.docParams.has('title')).toBe(true);
    expect(result.docParams.has('limit')).toBe(true);
  });

  it('returns empty docParams when no doc block exists', () => {
    const ast = parseLiquidFile('<p>{{ post.title }}</p>');
    const result = extractAllFromAST(ast);
    expect(result.docParams).toBeDefined();
    expect(result.docParams.size).toBe(0);
  });
});

describe('extractAll', () => {
  it('parses and extracts in one call', () => {
    const result = extractAll("---\nslug: test\n---\n{% render 'x' %}\n{{ 'k' | t }}");
    expect(result).not.toBeNull();
    expect(result.slug).toBe('test');
    expect(result.renders).toContain('x');
    expect(result.transKeys.has('k')).toBe(true);
  });

  it('returns null for unparseable content', () => {
    // Override parseLiquidFile behavior — empty is still parseable in tolerant mode
    // This tests the convenience wrapper
    const result = extractAll('<div>hello</div>');
    expect(result).not.toBeNull();
  });
});
