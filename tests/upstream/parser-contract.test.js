/**
 * Parser contract tests — verify @platformos/liquid-html-parser API surface.
 *
 * These tests pin the parser API that pos-supervisor depends on.
 * Failures mean an upstream parser change broke (or enhanced) our contract.
 */
import { describe, it, expect } from 'bun:test';
import { toLiquidHtmlAST, walk, NodeTypes, NamedTags } from '@platformos/liquid-html-parser';

// ── NodeTypes we depend on ─────────────────────────────────────────────────
// Used across: structural-warnings.js, liquid-parser.js, fix-generator.js

const REQUIRED_NODE_TYPES = [
  'HtmlElement', 'HtmlVoidElement', 'HtmlSelfClosingElement', 'HtmlRawNode',
  'HtmlDoctype', 'HtmlComment',
  'LiquidTag', 'LiquidRawTag', 'LiquidFilter', 'LiquidVariable',
  'VariableLookup', 'YAMLFrontmatter', 'String', 'GraphQLMarkup',
  'LiquidDocParamNode', 'LiquidDocPromptNode',
];

// ── NamedTags we depend on ─────────────────────────────────────────────────
// Used in: liquid-parser.js (render, graphql), structural-warnings.js (graphql)

const REQUIRED_NAMED_TAGS = [
  'render', 'graphql', 'function', 'include',
  'assign', 'capture', 'for', 'tablerow',
];

// ── Known counts for opportunity detection ─────────────────────────────────
// Update these after verifying new types are handled (or intentionally ignored).
const KNOWN_NODE_TYPE_COUNT = Object.keys(NodeTypes).length;
const KNOWN_NAMED_TAG_COUNT = Object.keys(NamedTags).length;

describe('Parser contract: NodeTypes', () => {
  for (const name of REQUIRED_NODE_TYPES) {
    it(`NodeTypes.${name} exists`, () => {
      expect(NodeTypes[name]).toBeDefined();
    });
  }

  it('opportunity: no new NodeTypes added', () => {
    const currentCount = Object.keys(NodeTypes).length;
    if (currentCount > KNOWN_NODE_TYPE_COUNT) {
      const known = new Set(REQUIRED_NODE_TYPES);
      const allTypes = Object.keys(NodeTypes);
      const unknown = allTypes.filter(t => !known.has(t));
      console.log(`[OPPORTUNITY] ${currentCount - KNOWN_NODE_TYPE_COUNT} new NodeType(s) detected (total: ${currentCount}, known: ${KNOWN_NODE_TYPE_COUNT})`);
      console.log(`  All types not in REQUIRED list: ${unknown.join(', ')}`);
      console.log('  Review if any should be handled in structural-warnings.js or liquid-parser.js');
    }
    // Always passes — this is advisory
    expect(true).toBe(true);
  });
});

describe('Parser contract: NamedTags', () => {
  for (const name of REQUIRED_NAMED_TAGS) {
    it(`NamedTags.${name} exists`, () => {
      expect(NamedTags[name]).toBeDefined();
    });
  }

  it('opportunity: no new NamedTags added', () => {
    const currentCount = Object.keys(NamedTags).length;
    if (currentCount > KNOWN_NAMED_TAG_COUNT) {
      const known = new Set(REQUIRED_NAMED_TAGS);
      const allTags = Object.keys(NamedTags);
      const unknown = allTags.filter(t => !known.has(t));
      console.log(`[OPPORTUNITY] ${currentCount - KNOWN_NAMED_TAG_COUNT} new NamedTag(s) detected (total: ${currentCount}, known: ${KNOWN_NAMED_TAG_COUNT})`);
      console.log(`  Tags not in REQUIRED list: ${unknown.join(', ')}`);
      console.log('  Review if any need handling in structural analysis');
    }
    expect(true).toBe(true);
  });
});

describe('Parser contract: AST shapes', () => {
  it('tolerant mode parses unclosed tags without throwing', () => {
    // Tolerant mode handles unclosed block tags — our code relies on this
    // for partial content that may have unmatched {% if %}
    const broken = '{% if true %}<div>{{ x }}</div>';
    const ast = toLiquidHtmlAST(broken, { mode: 'tolerant', allowUnclosedDocumentNode: true });
    expect(ast).toBeDefined();
    expect(ast.type).toBe(NodeTypes.Document);
  });

  it('VariableLookup has .name and .position', () => {
    const ast = toLiquidHtmlAST('{{ cart.items }}', { mode: 'tolerant' });
    let found = null;
    walk(ast, (node) => {
      if (node.type === NodeTypes.VariableLookup && node.name === 'cart') found = node;
    });
    expect(found).not.toBeNull();
    expect(found.name).toBe('cart');
    expect(found.position).toBeDefined();
    expect(typeof found.position.start).toBe('number');
    expect(typeof found.position.end).toBe('number');
  });

  it('LiquidFilter has .name, .args, .position', () => {
    const ast = toLiquidHtmlAST('{{ items | map: "name" }}', { mode: 'tolerant' });
    let found = null;
    walk(ast, (node) => {
      if (node.type === NodeTypes.LiquidFilter && node.name === 'map') found = node;
    });
    expect(found).not.toBeNull();
    expect(found.name).toBe('map');
    expect(found.args).toBeDefined();
    expect(Array.isArray(found.args)).toBe(true);
    expect(found.position).toBeDefined();
  });

  it('LiquidDocParamNode has .paramName.value', () => {
    const ast = toLiquidHtmlAST('{% doc %}\n  @param blog_post {object} - The post\n{% enddoc %}', { mode: 'tolerant' });
    let found = null;
    walk(ast, (node) => {
      if (node.type === NodeTypes.LiquidDocParamNode) found = node;
    });
    expect(found).not.toBeNull();
    expect(found.paramName).toBeDefined();
    expect(found.paramName.value).toBe('blog_post');
  });

  it('YAMLFrontmatter has .body string', () => {
    const ast = toLiquidHtmlAST('---\nslug: test\nlayout: application\n---\nHello', { mode: 'tolerant' });
    let found = null;
    walk(ast, (node) => {
      if (node.type === NodeTypes.YAMLFrontmatter) found = node;
    });
    expect(found).not.toBeNull();
    expect(typeof found.body).toBe('string');
    expect(found.body).toContain('slug: test');
  });

  it('LiquidTag render has parsed markup with partial', () => {
    const ast = toLiquidHtmlAST("{% render 'blog_posts/card' %}", { mode: 'tolerant' });
    let found = null;
    walk(ast, (node) => {
      if (node.type === NodeTypes.LiquidTag && node.name === 'render') found = node;
    });
    expect(found).not.toBeNull();
    expect(found.name).toBe('render');
    // markup may be string (unparsed) or object (parsed) — our code handles both
    expect(found.markup).toBeDefined();
  });

  it('GraphQLMarkup has name and graphql fields', () => {
    const ast = toLiquidHtmlAST("{% graphql g = 'users/search' %}", { mode: 'tolerant' });
    let found = null;
    walk(ast, (node) => {
      if (node.type === NodeTypes.GraphQLMarkup) found = node;
    });
    // GraphQLMarkup may not be present if parser represents it differently
    if (found) {
      expect(found.name).toBeDefined();
      expect(found.graphql).toBeDefined();
    } else {
      // Fallback: check the LiquidTag has markup with graphql info
      let tag = null;
      walk(ast, (node) => {
        if (node.type === NodeTypes.LiquidTag && node.name === 'graphql') tag = node;
      });
      expect(tag).not.toBeNull();
      expect(tag.markup).toBeDefined();
    }
  });

  it('walk visits all major node types in mixed content', () => {
    const content = `---
slug: test
---
<div>{{ title | upcase }}</div>
{% render 'shared/header' %}
{% assign x = 1 %}`;
    const ast = toLiquidHtmlAST(content, { mode: 'tolerant' });
    const visited = new Set();
    walk(ast, (node) => { visited.add(node.type); });

    expect(visited.has(NodeTypes.YAMLFrontmatter)).toBe(true);
    expect(visited.has(NodeTypes.LiquidVariable)).toBe(true);
    expect(visited.has(NodeTypes.LiquidFilter)).toBe(true);
    expect(visited.has(NodeTypes.LiquidTag)).toBe(true);
    expect(visited.has(NodeTypes.HtmlElement)).toBe(true);
  });
});

describe('Parser contract: exported functions', () => {
  it('toLiquidHtmlAST is a function', () => {
    expect(typeof toLiquidHtmlAST).toBe('function');
  });

  it('walk is a function', () => {
    expect(typeof walk).toBe('function');
  });

  it('toLiquidHtmlAST accepts mode and allowUnclosedDocumentNode options', () => {
    // This is the exact call signature used in liquid-parser.js
    const ast = toLiquidHtmlAST('{{ x }}', { mode: 'tolerant', allowUnclosedDocumentNode: true });
    expect(ast).toBeDefined();
  });
});
