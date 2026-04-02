import { describe, it, expect } from 'bun:test';
import { collectScopeAtOffset } from '../../src/core/fix-generator.js';
import { parseLiquidFile } from '../../src/core/liquid-parser.js';

/** Helper: find byte offset of a substring in content */
function offsetOf(content, substr) {
  const idx = content.indexOf(substr);
  if (idx === -1) throw new Error(`"${substr}" not found in content`);
  return idx;
}

describe('collectScopeAtOffset', () => {

  it('returns empty array for null AST', () => {
    expect(collectScopeAtOffset(null, 0)).toEqual([]);
  });

  it('returns empty array for undefined AST', () => {
    expect(collectScopeAtOffset(undefined, 0)).toEqual([]);
  });

  it('doc params always in scope', () => {
    const content = `{% doc %}
  @param title {string}
  @param items {array}
{% enddoc %}
{{ title }}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, '{{ title }}');
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(2);
    expect(scope[0]).toEqual({ name: 'title', source: '@param' });
    expect(scope[1]).toEqual({ name: 'items', source: '@param' });
  });

  it('for loop iterator in scope inside body', () => {
    const content = `{% for item in items %}
  {% render 'card' %}
{% endfor %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'item', source: '{% for item in items %}' });
  });

  it('for loop iterator NOT in scope after endfor', () => {
    const content = `{% for item in items %}
  {{ item }}
{% endfor %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toEqual([]);
  });

  it('tablerow iterator in scope inside body', () => {
    const content = `{% tablerow item in items %}
  {% render 'card' %}
{% endtablerow %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'item', source: '{% tablerow item in items %}' });
  });

  it('assign in scope after the tag', () => {
    const content = `{% assign x = 'hello' %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'x', source: '{% assign %}' });
  });

  it('assign NOT in scope before the tag', () => {
    const content = `{% render 'card' %}
{% assign x = 'hello' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toEqual([]);
  });

  it('capture in scope after endcapture', () => {
    const content = `{% capture greeting %}Hello{% endcapture %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'greeting', source: '{% capture %}' });
  });

  it('graphql result in scope after tag', () => {
    const content = `{% graphql result = 'get_products' %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'result', source: '{% graphql %}' });
  });

  it('function result in scope after tag', () => {
    const content = `{% function res = 'commands/process' %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'res', source: '{% function %}' });
  });

  it('parse_json result in scope after tag', () => {
    const content = `{% parse_json data %}{"key": "val"}{% endparse_json %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    expect(scope).toHaveLength(1);
    expect(scope[0]).toEqual({ name: 'data', source: '{% parse_json %}' });
  });

  it('nested for loops — both iterators in scope', () => {
    const content = `{% for category in categories %}
  {% for product in category.products %}
    {% render 'card' %}
  {% endfor %}
{% endfor %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    const names = scope.map(v => v.name);
    expect(names).toContain('category');
    expect(names).toContain('product');
  });

  it('mixed scope: doc params + for + assign', () => {
    const content = `{% doc %}
  @param items {array}
{% enddoc %}
{% assign total = 0 %}
{% for item in items %}
  {% render 'products/card' %}
{% endfor %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'products/card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    const names = scope.map(v => v.name);
    expect(names).toContain('items');
    expect(names).toContain('total');
    expect(names).toContain('item');

    const itemsVar = scope.find(v => v.name === 'items');
    expect(itemsVar.source).toBe('@param');

    const totalVar = scope.find(v => v.name === 'total');
    expect(totalVar.source).toBe('{% assign %}');

    const itemVar = scope.find(v => v.name === 'item');
    expect(itemVar.source).toBe('{% for item in items %}');
  });

  it('empty scope — no variable definitions', () => {
    const content = `<h1>Hello</h1>`;
    const ast = parseLiquidFile(content);
    const scope = collectScopeAtOffset(ast, 0);

    expect(scope).toEqual([]);
  });

  it('deduplication — same name assigned twice', () => {
    const content = `{% assign x = 1 %}
{% assign x = 2 %}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    const xVars = scope.filter(v => v.name === 'x');
    expect(xVars).toHaveLength(1);
  });

  it('variables inside {% liquid %} block', () => {
    const content = `{% liquid
  assign x = 'hello'
  for item in items
    echo item
  endfor
%}
{% render 'card' %}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "{% render 'card' %}");
    const scope = collectScopeAtOffset(ast, offset);

    const names = scope.map(v => v.name);
    expect(names).toContain('x');
    // for loop iterator should NOT be in scope after the liquid block ends
    expect(names).not.toContain('item');
  });

  it('for iterator inside {% liquid %} block is in scope within the loop', () => {
    const content = `{% liquid
  for item in items
    render 'card'
  endfor
%}`;
    const ast = parseLiquidFile(content);
    const offset = offsetOf(content, "render 'card'");
    const scope = collectScopeAtOffset(ast, offset);

    const names = scope.map(v => v.name);
    expect(names).toContain('item');
  });
});
