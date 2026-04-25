import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateStructuralWarnings } from '../../src/core/structural-warnings.js';
import { parseLiquidFile, extractAllFromAST } from '../../src/core/liquid-parser.js';

function getWarnings(content, filePath, existingChecks = new Set(), options = {}) {
  const ast = parseLiquidFile(content);
  if (!ast) return [];
  const structural = extractAllFromAST(ast);
  const structuralObj = {
    renders_used: structural.renders ?? [],
    tags_used: [...structural.tags],
    filters_used: [...structural.filters],
    doc_params: [...structural.docParams],
    slug: structural.slug,
    layout: structural.layout,
    method: structural.method,
    prompts: structural.prompts,
  };
  return generateStructuralWarnings(ast, content, filePath, structuralObj, existingChecks, options);
}

// ── HTML in pages ──────────────────────────────────────────────────────────

describe('structural-warnings: HTML in pages', () => {
  it('warns when page contains HTML elements', () => {
    const content = '---\nslug: test\n---\n<div>Hello</div>';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:HtmlInPage')).toBe(true);
  });

  it('warns on doctype in page', () => {
    const content = '<!DOCTYPE html>\n<html><body></body></html>';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:HtmlInPage')).toBe(true);
  });

  it('does not warn for partials with HTML', () => {
    const content = '<div class="card">{{ title }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:HtmlInPage')).toBe(false);
  });

  it('does not warn for pages with only Liquid', () => {
    const content = '---\nslug: test\n---\n{% liquid\nassign x = 1\n%}\n{% render "partial" %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:HtmlInPage')).toBe(false);
  });

  it('includes line/column for HTML warning', () => {
    const content = '---\nslug: test\n---\n\n<h1>Title</h1>';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:HtmlInPage');
    expect(w).toBeDefined();
    expect(w.line).toBeGreaterThanOrEqual(0);
    expect(w.severity).toBe('warning');
  });

  // B-tier guard (2026-04-24): composite landing pages legitimately mix HTML
  // wrappers with partial renders. Don't flag those — the check had 100%
  // regression on exactly this pattern in the 2026-04-23 DEMO report.
  it('does NOT warn for pages that render at least one partial (composite page)', () => {
    const content = '---\nslug: index\n---\n<section class="hero">{% render "landing/hero" %}</section>';
    const warnings = getWarnings(content, '/project/app/views/pages/index.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:HtmlInPage')).toBe(false);
  });

  it('still warns for pure-HTML pages that do not render any partials', () => {
    const content = '---\nslug: contact\n---\n<form><input name="email"/></form>';
    const warnings = getWarnings(content, '/project/app/views/pages/contact.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:HtmlInPage')).toBe(true);
  });
});

// ── GraphQL in partials ───────────────────────────────────────────────────

describe('structural-warnings: GraphQL in partials', () => {
  it('errors when partial contains {% graphql %} tag', () => {
    const content = '{% graphql g = "products/search" %}';
    const warnings = getWarnings(content, '/project/app/views/partials/products/card.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:GraphqlInPartial');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.message).toContain('Do NOT run');
    expect(w.message).toContain('render');
  });

  it('errors on graphql inside liquid block in partial', () => {
    const content = '{% liquid\n  graphql g = "products/search"\n  assign name = g.record.name\n%}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:GraphqlInPartial')).toBe(true);
  });

  it('does not warn for pages with graphql', () => {
    const content = '---\nslug: products\n---\n{% graphql g = "products/search" %}';
    const warnings = getWarnings(content, '/project/app/views/pages/products.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:GraphqlInPartial')).toBe(false);
  });

  it('does not warn for partials without graphql', () => {
    const content = '<div>{{ name }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:GraphqlInPartial')).toBe(false);
  });

  it('includes line/column for graphql warning', () => {
    const content = 'line1\n{% graphql g = "test" %}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:GraphqlInPartial');
    expect(w).toBeDefined();
    expect(w.line).toBe(1);
  });

  it('only reports first graphql occurrence', () => {
    const content = '{% graphql a = "first" %}\n{% graphql b = "second" %}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    const gqlWarnings = warnings.filter(w => w.check === 'pos-supervisor:GraphqlInPartial');
    expect(gqlWarnings.length).toBe(1);
  });
});

// ── Shopify objects ────────────────────────────────────────────────────────

describe('structural-warnings: Shopify objects', () => {
  it('detects Shopify object in output', () => {
    const content = '{{ product.title }}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('product'))).toBe(true);
  });

  it('does NOT flag content_for_layout as Shopify (it is valid in platformOS)', () => {
    const content = '{{ content_for_layout }}';
    const warnings = getWarnings(content, '/project/app/views/layouts/default.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('content_for_layout'))).toBe(false);
  });

  it('suggests {% graphql %} for Shopify objects', () => {
    const content = '{{ product.title }}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:ShopifyObject');
    expect(w).toBeDefined();
    expect(w.message).toContain('{% graphql %}');
  });

  it('does not duplicate linter UndefinedObject for same variable', () => {
    const content = '{{ cart.items }}';
    const existingChecks = new Set(['UndefinedObject', 'UndefinedObject:cart']);
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid', existingChecks);
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('cart'))).toBe(false);
  });

  it('does not flag platformOS objects', () => {
    const content = '{{ context.params.id }}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject')).toBe(false);
  });

  it('deduplicates multiple uses of same Shopify object', () => {
    const content = '{{ product.title }} {{ product.price }}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const shopifyWarnings = warnings.filter(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('product'));
    expect(shopifyWarnings.length).toBe(1);
  });

  it('does NOT flag Shopify-named variable declared as @param', () => {
    const content = '{% doc %}\n  @param product {object} Product data\n{% enddoc %}\n{{ product.title }}';
    const warnings = getWarnings(content, '/project/app/views/partials/card.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('product'))).toBe(false);
  });

  it('still flags undeclared Shopify objects even when file has @param', () => {
    const content = '{% doc %}\n  @param product {object} Product data\n{% enddoc %}\n{{ product.title }}\n{{ cart.items }}';
    const warnings = getWarnings(content, '/project/app/views/partials/card.liquid');
    // product is declared — not flagged
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('product'))).toBe(false);
    // cart is NOT declared — still flagged
    expect(warnings.some(w => w.check === 'pos-supervisor:ShopifyObject' && w.message.includes('cart'))).toBe(true);
  });
});

// ── Deprecated tags ────────────────────────────────────────────────────────

describe('structural-warnings: deprecated tags', () => {
  it('warns about parse_json when linter did not flag it', () => {
    const content = '{% parse_json obj %}{}{% endparse_json %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:DeprecatedTag' && w.message.includes('parse_json'))).toBe(true);
  });

  it('warns about hash_assign when linter did not flag it', () => {
    const content = '{% assign obj = {} %}\n{% hash_assign obj["key"] = "value" %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:DeprecatedTag' && w.message.includes('hash_assign'))).toBe(true);
  });

  it('does not duplicate when linter already reported DeprecatedTag for specific tag', () => {
    const content = '{% parse_json obj %}{}{% endparse_json %}';
    const existingChecks = new Set(['DeprecatedTag', 'DeprecatedTag:parse_json']);
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid', existingChecks);
    expect(warnings.some(w => w.check === 'pos-supervisor:DeprecatedTag' && w.message.includes('parse_json'))).toBe(false);
  });

  it('does not warn for non-deprecated tags', () => {
    const content = '{% assign x = 1 %}\n{% render "partial" %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:DeprecatedTag')).toBe(false);
  });
});

// ── Filter argument misuse ─────────────────────────────────────────────────

describe('structural-warnings: filter argument misuse', () => {
  it('warns when map has named arguments', () => {
    const content = '{{ items | map: "times", factor: 2 }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse' && w.message.includes('map'))).toBe(true);
  });

  it('does not warn when map has correct single argument', () => {
    const content = '{{ items | map: "price" }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse')).toBe(false);
  });

  it('warns when sort has named arguments', () => {
    const content = '{{ items | sort: "name", order: "desc" }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse' && w.message.includes('sort'))).toBe(true);
  });

  it('does not warn when sort has correct usage', () => {
    const content = '{{ items | sort: "name" }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse')).toBe(false);
  });

  it('allows named arguments for t filter', () => {
    const content = '{{ "greeting" | t: name: "John" }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse' && w.message.includes('t'))).toBe(false);
  });

  it('allows named arguments for default filter', () => {
    const content = '{{ var | default: "fallback", allow_false: true }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse')).toBe(false);
  });

  it('warns when where has named arguments', () => {
    const content = '{{ items | where: "status", value: "active" }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse' && w.message.includes('where'))).toBe(true);
  });

  it('does not warn for unknown filters', () => {
    const content = '{{ items | custom_filter: "arg", named: "val" }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:FilterArgMisuse')).toBe(false);
  });

  it('includes line/column in warning', () => {
    const content = 'line1\n{{ items | map: "x", bad: 1 }}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:FilterArgMisuse');
    expect(w).toBeDefined();
    expect(w.line).toBe(1);
    expect(w.severity).toBe('warning');
  });
});

// ── Slug validation ────────────────────────────────────────────────────────

describe('structural-warnings: slug validation', () => {
  it('warns on [param] bracket syntax', () => {
    const content = '---\nslug: products/[id]\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(w).toBeDefined();
    expect(w.message).toContain(':id');
    expect(w.message).toContain('products/:id');
  });

  it('warns on {param} brace syntax', () => {
    const content = '---\nslug: users/{userId}/orders\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(w).toBeDefined();
    expect(w.message).toContain(':userId');
  });

  it('warns on <param> angle bracket syntax', () => {
    const content = '---\nslug: items/<item_id>\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(w).toBeDefined();
    expect(w.message).toContain(':item_id');
  });

  it('warns on leading slash', () => {
    const content = '---\nslug: /api/products\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(w).toBeDefined();
    expect(w.message).toContain('remove the leading slash');
    expect(w.message).toContain('api/products');
  });

  it('does not warn for valid :param slug', () => {
    const content = '---\nslug: products/:id\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidSlug')).toBe(false);
  });

  it('does not warn for simple static slug', () => {
    const content = '---\nslug: products/list\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidSlug')).toBe(false);
  });

  it('does not run slug checks on partials', () => {
    const content = '---\nslug: /bad/[id]\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidSlug')).toBe(false);
  });

  it('points to the slug line number', () => {
    const content = '---\nlayout: app\nslug: products/[id]\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(w).toBeDefined();
    expect(w.line).toBe(2);
  });

  it('can report both bracket syntax and leading slash', () => {
    const content = '---\nslug: /products/[id]\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const slugWarnings = warnings.filter(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(slugWarnings.length).toBe(2);
  });

  it('provides root page guidance when slug is just /', () => {
    const content = '---\nslug: /\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/index.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidSlug');
    expect(w).toBeDefined();
    expect(w.message).toContain('omit the slug line entirely');
    expect(w.message).toContain('index.liquid');
  });
});

// ── Layout validation ─────────────────────────────────────────────────────

describe('structural-warnings: layout validation', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pos-supervisor-layout-test-'));
    mkdirSync(join(tmpDir, 'app/views/layouts'), { recursive: true });
    writeFileSync(join(tmpDir, 'app/views/layouts/application.html.liquid'), '{{ content_for_layout }}');
    writeFileSync(join(tmpDir, 'app/views/layouts/admin.liquid'), '{{ content_for_layout }}');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warns when layout does not exist', () => {
    const content = '---\nlayout: fake_layout_that_does_not_exist\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidLayout');
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');
    expect(w.message).toContain('fake_layout_that_does_not_exist');
    expect(w.message).toContain('not found');
  });

  it('does not warn when layout exists (.html.liquid)', () => {
    const content = '---\nlayout: application\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('does not warn when layout exists (.liquid)', () => {
    const content = '---\nlayout: admin\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('does not check layout without projectDir', () => {
    const content = '---\nlayout: nonexistent\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('does not check layout on partials', () => {
    const content = '---\nlayout: nonexistent\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/partials/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('points to the layout line number', () => {
    const content = '---\nslug: test\nlayout: missing_layout\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidLayout');
    expect(w).toBeDefined();
    expect(w.line).toBe(2);
  });

  it('does not warn when no layout specified', () => {
    const content = '---\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('does not warn when layout is empty double-quoted string', () => {
    const content = '---\nlayout: ""\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('does not warn when layout is empty single-quoted string', () => {
    const content = "---\nlayout: ''\nslug: test\n---\n{% assign x = 1 %}";
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('resolves module layout path', () => {
    // Create a module layout file
    mkdirSync(join(tmpDir, 'modules/my-module/public/views/layouts'), { recursive: true });
    writeFileSync(join(tmpDir, 'modules/my-module/public/views/layouts/init.html.liquid'), '{{ content_for_layout }}');

    const content = '---\nlayout: modules/my-module/init\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidLayout')).toBe(false);
  });

  it('warns for missing module layout', () => {
    const content = '---\nlayout: modules/nonexistent-module/init\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, `${tmpDir}/app/views/pages/test.html.liquid`, new Set(), { projectDir: tmpDir });
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidLayout');
    expect(w).toBeDefined();
    expect(w.message).toContain('modules/nonexistent-module');
  });
});

// ── Missing doc block ─────────────────────────────────────────────────────

describe('structural-warnings: missing doc block', () => {
  it('warns when partial has no doc block', () => {
    const content = '<div class="card">{{ title }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:MissingDocBlock');
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');
    expect(w.message).toContain('{% doc %}');
  });

  it('does not warn when partial has {% doc %} block', () => {
    const content = '{% doc %}\n  @param title {string} Card title\n{% enddoc %}\n<div>{{ title }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });

  it('does not warn when partial has @prompt comment', () => {
    const content = '{% comment %}\n  @prompt: Renders a product card\n  Required params: title\n{% endcomment %}\n<div>{{ title }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });

  it('does not warn for pages without doc block', () => {
    const content = '---\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });

  it('does not warn for layouts without doc block', () => {
    const content = '{{ content_for_layout }}';
    const warnings = getWarnings(content, '/project/app/views/layouts/default.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });
});

// ── Method validation ─────────────────────────────────────────────────────

describe('structural-warnings: non-GET rendering page', () => {
  // Landing-page mistake pattern the DEMO agent keeps repeating:
  // `method: post` + HTML body → page 404s on browser GET.
  it('warns when page has method: post and renders HTML content', () => {
    const content = '---\nslug: contact\nmethod: post\nlayout: application\n---\n<h1>Contact</h1>\n<form>{{ foo }}</form>';
    const warnings = getWarnings(content, '/project/app/views/pages/contact.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(true);
  });

  it('warns when page has method: post and renders partials (composite landing)', () => {
    const content = '---\nslug: index\nmethod: post\n---\n{% render "landing/hero" %}';
    const warnings = getWarnings(content, '/project/app/views/pages/index.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(true);
  });

  it('warns for put/delete/patch too', () => {
    for (const method of ['put', 'delete', 'patch']) {
      const content = `---\nslug: widget\nmethod: ${method}\n---\n<div>{{ x }}</div>`;
      const warnings = getWarnings(content, '/project/app/views/pages/widget.liquid');
      expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(true);
    }
  });

  it('does NOT warn for API pages (slug under /api/)', () => {
    const content = '---\nslug: api/contacts/create\nmethod: post\nformat: json\n---\n{{ r | json }}';
    const warnings = getWarnings(content, '/project/app/views/pages/api/contacts/create.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(false);
  });

  it('does NOT warn for JSON-only endpoints (no HTML, no layout, no partials, no output)', () => {
    const content = '---\nslug: webhooks/stripe\nmethod: post\n---\n';
    const warnings = getWarnings(content, '/project/app/views/pages/webhooks/stripe.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(false);
  });

  it('does NOT warn for method: get', () => {
    const content = '---\nslug: contact\nmethod: get\n---\n<h1>Contact</h1>';
    const warnings = getWarnings(content, '/project/app/views/pages/contact.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(false);
  });

  it('does NOT warn when method field is absent (default is get)', () => {
    const content = '---\nslug: contact\n---\n<h1>Contact</h1>';
    const warnings = getWarnings(content, '/project/app/views/pages/contact.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:NonGetRenderingPage')).toBe(false);
  });
});

describe('structural-warnings: method validation', () => {
  it('errors on uppercase POST', () => {
    const content = '---\nslug: test\nmethod: POST\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidMethod');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.message).toContain('post');
    expect(w.message).toContain('lowercase');
  });

  it('errors on uppercase GET', () => {
    const content = '---\nslug: test\nmethod: GET\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidMethod')).toBe(true);
  });

  it('errors on mixed case Delete', () => {
    const content = '---\nslug: test\nmethod: Delete\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidMethod');
    expect(w).toBeDefined();
    expect(w.message).toContain('delete');
  });

  it('errors on completely invalid method', () => {
    const content = '---\nslug: test\nmethod: TRACE\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidMethod');
    expect(w).toBeDefined();
    expect(w.message).toContain('Invalid method');
    expect(w.message).toContain('Valid values');
  });

  it('does not warn for valid lowercase post', () => {
    const content = '---\nslug: test\nmethod: post\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidMethod')).toBe(false);
  });

  it('does not warn for valid lowercase get', () => {
    const content = '---\nslug: test\nmethod: get\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidMethod')).toBe(false);
  });

  it('does not warn for valid lowercase put', () => {
    const content = '---\nslug: test\nmethod: put\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidMethod')).toBe(false);
  });

  it('does not warn when no method specified', () => {
    const content = '---\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidMethod')).toBe(false);
  });

  it('points to the method line number', () => {
    const content = '---\nslug: test\nmethod: PUT\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidMethod');
    expect(w).toBeDefined();
    expect(w.line).toBe(2);
  });

  it('does not check method on partials', () => {
    const content = '---\nmethod: POST\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidMethod')).toBe(false);
  });
});

// ── Missing return in commands ────────────────────────────────────────────

describe('structural-warnings: missing return in commands', () => {
  it('warns when command has no return', () => {
    const content = '{% liquid\n  graphql g = "orders/create", title: object.title\n  assign object["id"] = g.id\n%}';
    const warnings = getWarnings(content, '/project/app/lib/commands/orders/create.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:MissingReturn');
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');
    expect(w.message).toContain('return');
  });

  it('does not warn when command has return', () => {
    const content = '{% liquid\n  graphql g = "orders/create", title: object.title\n  assign object["id"] = g.id\n  return object\n%}';
    const warnings = getWarnings(content, '/project/app/lib/commands/orders/create.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingReturn')).toBe(false);
  });

  it('does not check return on pages', () => {
    const content = '---\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingReturn')).toBe(false);
  });

  it('does not check return on partials', () => {
    const content = '<div>{{ title }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingReturn')).toBe(false);
  });
});

// ── Missing doc block in commands ─────────────────────────────────────────

describe('structural-warnings: missing doc block in commands (B1.5 scope-out)', () => {
  // Commands were dropped from MissingDocBlock after plan B1.5 — the check
  // was 10% resolution / 40% regression on command files in production.
  // Only partials still fire this warning.
  it('does NOT warn when command has no doc block', () => {
    const content = '{% liquid\n  assign object["id"] = 1\n  return object\n%}';
    const warnings = getWarnings(content, '/project/app/lib/commands/test/create.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });

  it('does not warn when command has doc block either', () => {
    const content = '{% doc %}\n  @param object {Hash}\n{% enddoc %}\n{% liquid\n  return object\n%}';
    const warnings = getWarnings(content, '/project/app/lib/commands/test/create.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });

  it('still warns for partials without doc block (regression guard)', () => {
    const content = '<div>{{ x }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/widget.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(true);
  });

  it('does not warn for queries without doc block', () => {
    const content = '{% graphql res = "list_posts" %}{{ res | json }}';
    const warnings = getWarnings(content, '/project/app/lib/queries/list_posts.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingDocBlock')).toBe(false);
  });
});

// ── Front matter key validation ───────────────────────────────────────────

describe('structural-warnings: front matter key validation', () => {
  it('warns on missing slug', () => {
    const content = '---\nlayout: application\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:MissingSlug');
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');
  });

  it('warns on no front matter at all', () => {
    const content = '{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingSlug')).toBe(true);
  });

  it('does not warn when slug is present', () => {
    const content = '---\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingSlug')).toBe(false);
  });

  it('errors on misleading key: cache', () => {
    const content = '---\nslug: test\ncache: true\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidFrontMatter' && w.message.includes('cache'));
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.message).toContain('{% cache');
  });

  it('errors on misleading key: title', () => {
    const content = '---\nslug: test\ntitle: "Test"\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidFrontMatter' && w.message.includes('title'));
    expect(w).toBeDefined();
    expect(w.message).toContain('metadata.title');
  });

  it('errors on misleading key: default_layout', () => {
    const content = '---\nslug: test\ndefault_layout: true\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidFrontMatter');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
  });

  it('errors on misleading key: authorization_policies', () => {
    const content = '---\nslug: test\nauthorization_policies: [check_admin]\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidFrontMatter');
    expect(w).toBeDefined();
    expect(w.message).toContain('modules/user/helpers/can_do');
  });

  it('warns on unknown key', () => {
    const content = '---\nslug: test\ncustom_key: value\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidFrontMatter');
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');
    expect(w.message).toContain('custom_key');
  });

  it('allows all valid keys without warnings', () => {
    const content = '---\nslug: test\nmethod: post\nlayout: application\nmetadata:\n  title: Test\nresponse_headers:\n  X-Custom: value\nmax_deep_level: 5\nredirect_to: /other\nredirect_code: 301\nsearchable: true\nformat: json\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidFrontMatter')).toBe(false);
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingSlug')).toBe(false);
  });

  it('does not check front matter on partials', () => {
    const content = '---\ncache: true\ncustom: value\n---\n<div>{{ x }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:InvalidFrontMatter')).toBe(false);
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingSlug')).toBe(false);
  });

  it('points to correct line for unknown key', () => {
    const content = '---\nslug: test\nlayout: app\nmax_items: 100\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:InvalidFrontMatter');
    expect(w).toBeDefined();
    expect(w.line).toBe(3);
  });
});

// ── Missing content_for_layout in layouts ────────────────────────────────

describe('structural-warnings: missing content_for_layout in layouts', () => {
  it('errors when layout has no {{ content_for_layout }}', () => {
    const content = '<html><body>{% yield "head" %}</body></html>';
    const warnings = getWarnings(content, '/project/app/views/layouts/application.html.liquid');
    const w = warnings.find(w => w.check === 'pos-supervisor:MissingContentForLayout');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.message).toContain('content_for_layout');
    expect(w.message).toContain('page body');
  });

  it('does not error when layout has {{ content_for_layout }}', () => {
    const content = '<html><body>{{ content_for_layout }}</body></html>';
    const warnings = getWarnings(content, '/project/app/views/layouts/application.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingContentForLayout')).toBe(false);
  });

  it('does not error when layout has content_for_layout with extra spaces', () => {
    const content = '<html><body>{{  content_for_layout  }}</body></html>';
    const warnings = getWarnings(content, '/project/app/views/layouts/application.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingContentForLayout')).toBe(false);
  });

  it('does not check content_for_layout on pages', () => {
    const content = '---\nslug: test\n---\n{% assign x = 1 %}';
    const warnings = getWarnings(content, '/project/app/views/pages/test.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingContentForLayout')).toBe(false);
  });

  it('does not check content_for_layout on partials', () => {
    const content = '<div>{{ title }}</div>';
    const warnings = getWarnings(content, '/project/app/views/partials/card.html.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingContentForLayout')).toBe(false);
  });

  it('does not check content_for_layout on commands', () => {
    const content = '{% liquid\n  assign x = 1\n  return x\n%}';
    const warnings = getWarnings(content, '/project/app/lib/commands/test/create.liquid');
    expect(warnings.some(w => w.check === 'pos-supervisor:MissingContentForLayout')).toBe(false);
  });
});
