import { describe, it, expect } from 'bun:test';
import { generateFixes } from '../../src/core/fix-generator.js';
import { parseLiquidFile } from '../../src/core/liquid-parser.js';
import { ObjectsIndex } from '../../src/core/objects-index.js';
import { FiltersIndex } from '../../src/core/filters-index.js';
import { TagsIndex } from '../../src/core/tags-index.js';

function makeCtx() {
  const objectsIndex = new ObjectsIndex();
  objectsIndex._loaded = true;
  objectsIndex._byName.set('params', { name: 'params', handle: 'context.params', properties: ['slug', 'id'] });
  const filtersIndex = new FiltersIndex();
  filtersIndex._loaded = true;
  filtersIndex._byName.set('json', { name: 'json', syntax: '{{ obj | json }}', summary: 'JSON encode' });
  const tagsIndex = new TagsIndex();
  tagsIndex._loaded = true;
  return { objectsIndex, filtersIndex, tagsIndex, schemaIndex: null };
}

// ── InvalidHashAssignTarget ──────────────────────────────────────────────────

describe('fix-generator: InvalidHashAssignTarget', () => {
  it('generates guidance to initialize hash', () => {
    const diagnostics = [{
      check: 'InvalidHashAssignTarget',
      severity: 'error',
      message: 'Target "my_obj" is not initialized',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('assign my_obj = {}');
  });

  it('falls back to generic var name when not extractable', () => {
    const diagnostics = [{
      check: 'InvalidHashAssignTarget',
      severity: 'error',
      message: 'Target is not initialized',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].description).toContain('assign my_hash = {}');
  });
});

// ── MissingAsset ─────────────────────────────────────────────────────────────

describe('fix-generator: MissingAsset', () => {
  it('generates create_file for missing asset', () => {
    const diagnostics = [{
      check: 'MissingAsset',
      severity: 'warning',
      message: "Missing asset 'styles/main.css'",
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('create_file');
    expect(proposedFixes[0].path).toBe('app/assets/styles/main.css');
  });

  it('returns guidance when path not extractable', () => {
    const diagnostics = [{
      check: 'MissingAsset',
      severity: 'warning',
      message: 'Asset file not found',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('app/assets/');
  });
});

// ── MetadataParamsCheck ──────────────────────────────────────────────────────

describe('fix-generator: MetadataParamsCheck', () => {
  it('generates guidance with specific param and partial', () => {
    const diagnostics = [{
      check: 'MetadataParamsCheck',
      severity: 'error',
      message: "Missing required argument 'title' for partial 'products/card'",
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('title');
    expect(proposedFixes[0].description).toContain('products/card');
  });

  it('returns generic guidance when message unparseable', () => {
    const diagnostics = [{
      check: 'MetadataParamsCheck',
      severity: 'error',
      message: 'Parameter check failed',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].description).toContain('{% doc %}');
  });

  it('includes variables in scope when AST is available', () => {
    const content = `{% assign user = context.current_user %}
{% render 'profile/header' %}`;
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MetadataParamsCheck',
      severity: 'error',
      message: "Missing required argument 'name' for partial 'profile/header'",
      line: 1,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].description).toContain('Variables in scope:');
    expect(proposedFixes[0].description).toContain('user ({% assign %})');
  });

  it('includes graphql result in scope for MetadataParamsCheck', () => {
    const content = `{% graphql products = 'get_products' %}
{% render 'products/list' %}`;
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'MetadataParamsCheck',
      severity: 'error',
      message: "Missing required argument 'items' for partial 'products/list'",
      line: 1,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].description).toContain('Variables in scope:');
    expect(proposedFixes[0].description).toContain('products ({% graphql %})');
  });
});

// ── UnknownProperty ──────────────────────────────────────────────────────────

describe('fix-generator: UnknownProperty', () => {
  it('suggests records.results for GraphQL traversal', () => {
    const diagnostics = [{
      check: 'UnknownProperty',
      severity: 'warning',
      message: 'Unknown property "results" on object',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].description).toContain('records.results');
  });

  it('returns generic guidance for non-graphql property', () => {
    const diagnostics = [{
      check: 'UnknownProperty',
      severity: 'warning',
      message: 'Unknown property "foo" on object',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].description).toContain('platformos_hover');
  });
});

// ── LiquidHTMLSyntaxError ────────────────────────────────────────────────────

describe('fix-generator: LiquidHTMLSyntaxError', () => {
  it('fixes missing = in graphql tag', () => {
    const content = '{% graphql result "products/search" %}';
    const diagnostics = [{
      check: 'LiquidHTMLSyntaxError',
      severity: 'error',
      message: 'Syntax error',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('= "products/search"');
  });

  it('fixes missing = in function tag', () => {
    const content = "{% function result 'lib/commands/create' %}";
    const diagnostics = [{
      check: 'LiquidHTMLSyntaxError',
      severity: 'error',
      message: 'Syntax error',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain("= 'lib/commands/create'");
  });

  it('returns guidance for unclosed block', () => {
    const diagnostics = [{
      check: 'LiquidHTMLSyntaxError',
      severity: 'error',
      message: 'Unclosed block: missing endif',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '{% if x %}', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('endif');
  });

  it('returns guidance for mismatched quotes', () => {
    const diagnostics = [{
      check: 'LiquidHTMLSyntaxError',
      severity: 'error',
      message: 'Unexpected quote character',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '{{ "hello }}', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('quotes');
  });
});

// ── pos-supervisor structural check fixes ───────────────────────────────────────────

describe('fix-generator: pos-supervisor:InvalidMethod', () => {
  it('generates text_edit to lowercase method', () => {
    const content = '---\nslug: test\nmethod: POST\n---';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:InvalidMethod',
      severity: 'error',
      message: 'Method `POST` must be lowercase: `post`.',
      line: 2,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe('post');
  });
});

describe('fix-generator: pos-supervisor:InvalidSlug', () => {
  it('generates text_edit to fix bracket syntax', () => {
    const content = '---\nslug: products/[id]\n---';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: 'Slug uses `[id]` bracket syntax. platformOS uses `:id`: `products/:id`.',
      line: 1,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe('products/:id');
  });
});

describe('fix-generator: pos-supervisor:MissingContentForLayout', () => {
  it('inserts content_for_layout after body tag', () => {
    const content = '<html>\n<body>\n  <h1>Site</h1>\n</body>\n</html>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:MissingContentForLayout',
      severity: 'error',
      message: 'Layout missing {{ content_for_layout }}',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/layouts/app.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'insert');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('content_for_layout');
  });

  it('inserts content_for_layout at start if no body tag', () => {
    const content = '{% yield "header" %}\nsome content';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:MissingContentForLayout',
      severity: 'error',
      message: 'Layout missing {{ content_for_layout }}',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/layouts/app.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'insert');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('content_for_layout');
  });
});

describe('fix-generator: pos-supervisor:MissingReturn', () => {
  it('inserts return before closing liquid block', () => {
    const content = '{% liquid\n  assign x = 1\n%}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:MissingReturn',
      severity: 'warning',
      message: 'Command missing {% return %}',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/lib/commands/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'insert');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('return');
  });
});

describe('fix-generator: pos-supervisor:MissingDocBlock', () => {
  it('inserts doc block at start of file', () => {
    const content = '<div>{{ title }}</div>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:MissingDocBlock',
      severity: 'warning',
      message: 'Partial missing {% doc %} block',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/partials/card.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'insert');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('{% doc %}');
    expect(fix.new_text).toContain('@param');
    expect(fix.new_text).toContain('{% enddoc %}');
  });
});

describe('fix-generator: pos-supervisor:MissingSlug', () => {
  it('inserts slug into existing front matter', () => {
    const content = '---\nlayout: application\n---\n{% assign x = 1 %}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:MissingSlug',
      severity: 'warning',
      message: 'Page missing slug',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'insert');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('slug:');
  });

  it('creates front matter when none exists', () => {
    const content = '{% assign x = 1 %}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:MissingSlug',
      severity: 'warning',
      message: 'Page has no front matter',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'insert');
    expect(fix).toBeDefined();
    expect(fix.new_text).toContain('---');
    expect(fix.new_text).toContain('slug:');
  });
});

describe('fix-generator: pos-supervisor:GraphqlInPartial', () => {
  it('generates guidance to move query', () => {
    const content = '{% graphql g = "products/search" %}';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:GraphqlInPartial',
      severity: 'error',
      message: 'Do NOT run {% graphql %} in partials',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/partials/card.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('page or command');
  });
});

describe('fix-generator: pos-supervisor:HtmlInPage', () => {
  it('generates guidance to extract HTML', () => {
    const content = '---\nslug: test\n---\n<div>Hello</div>';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:HtmlInPage',
      severity: 'warning',
      message: 'Pages should be controller-only',
      line: 3,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes).toHaveLength(1);
    expect(proposedFixes[0].type).toBe('guidance');
    expect(proposedFixes[0].description).toContain('partial');
  });
});

describe('fix-generator: pos-supervisor:ShopifyObject', () => {
  it('suggests graphql/context for Shopify objects', () => {
    const diagnostics = [{
      check: 'pos-supervisor:ShopifyObject',
      severity: 'warning',
      message: '`product` is a Shopify theme object',
      line: 0,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '{{ product.title }}', 'app/views/pages/test.liquid', makeCtx());
    expect(proposedFixes[0].description).toContain('graphql');
  });
});

describe('fix-generator: pos-supervisor:SchemaPropertyType', () => {
  it('fixes type alias int → integer', () => {
    const content = 'name: product\nproperties:\n  - name: count\n    type: int';
    const diagnostics = [{
      check: 'pos-supervisor:SchemaPropertyType',
      severity: 'error',
      message: 'Invalid type `int`. Did you mean `integer`?',
      line: 3,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, content, 'app/schema/product.yml', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe('integer');
  });

  it('fixes type alias bool → boolean', () => {
    const content = 'name: product\nproperties:\n  - name: active\n    type: bool';
    const diagnostics = [{
      check: 'pos-supervisor:SchemaPropertyType',
      severity: 'error',
      message: 'Invalid type `bool`. Did you mean `boolean`?',
      line: 3,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, content, 'app/schema/product.yml', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe('boolean');
  });
});

describe('fix-generator: pos-supervisor:InvalidFrontMatter', () => {
  it('generates text_edit to remove misleading key', () => {
    const content = '---\nslug: test\ncache: true\n---';
    const ast = parseLiquidFile(content);
    const diagnostics = [{
      check: 'pos-supervisor:InvalidFrontMatter',
      severity: 'error',
      message: '`cache` is not a front matter option.',
      line: 2,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, ast, content, 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'text_edit');
    expect(fix).toBeDefined();
    expect(fix.new_text).toBe(''); // Remove the line
    expect(fix.description).toContain('cache');
  });
});

describe('fix-generator: pos-supervisor:InvalidLayout', () => {
  it('generates create_file for missing layout', () => {
    const diagnostics = [{
      check: 'pos-supervisor:InvalidLayout',
      severity: 'warning',
      message: 'Layout `custom` not found.',
      line: 1,
      column: 0,
    }];

    const { proposedFixes } = generateFixes(diagnostics, null, '---\nlayout: custom\n---', 'app/views/pages/test.liquid', makeCtx());
    const fix = proposedFixes.find(f => f.type === 'create_file');
    expect(fix).toBeDefined();
    expect(fix.path).toContain('layouts/custom');
  });
});
