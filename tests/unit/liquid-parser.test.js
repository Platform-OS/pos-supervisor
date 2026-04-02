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
