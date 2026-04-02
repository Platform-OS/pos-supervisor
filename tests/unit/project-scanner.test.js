import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanProject, scanAround, parseGraphQLFile, extractFunctionCalls, pluralize } from '../../src/core/project-scanner.js';

const TEST_DIR = join(tmpdir(), `pos-supervisor-scanner-test-${Date.now()}`);

function setup() {
  const appDir = join(TEST_DIR, 'app');

  // Schema
  mkdirSync(join(appDir, 'schema'), { recursive: true });
  writeFileSync(join(appDir, 'schema', 'blog_post.yml'), `name: blog_post
properties:
  - name: title
    type: string
  - name: body
    type: text
  - name: published
    type: boolean
  - name: views
    type: integer
`);

  // GraphQL
  mkdirSync(join(appDir, 'graphql', 'blog_posts'), { recursive: true });
  writeFileSync(join(appDir, 'graphql', 'blog_posts', 'search.graphql'), `query search($page: Int = 1, $limit: Int = 20) {
  records(
    per_page: $limit
    page: $page
    filter: { table: { value: "blog_post" } }
  ) {
    total_entries
    results { id }
  }
}
`);
  writeFileSync(join(appDir, 'graphql', 'blog_posts', 'create.graphql'), `mutation create($title: String, $body: String) {
  record_create(
    record: { table: "blog_post", properties: [{ name: "title", value: $title }] }
  ) { id }
}
`);

  // Pages
  mkdirSync(join(appDir, 'views', 'pages', 'blog_posts'), { recursive: true });
  writeFileSync(join(appDir, 'views', 'pages', 'blog_posts', 'index.html.liquid'), `---
slug: blog_posts
---
{% liquid
  assign page = context.params.page | default: 1
  function items = 'lib/queries/blog_posts/search', page: page
  render 'blog_posts/list', items: items
%}
`);

  // Partials
  mkdirSync(join(appDir, 'views', 'partials', 'blog_posts'), { recursive: true });
  writeFileSync(join(appDir, 'views', 'partials', 'blog_posts', 'list.liquid'), `{% doc %}
  @param items {object} - items
{% enddoc %}

{% for item in items %}
  {% render 'blog_posts/card', item: item %}
{% endfor %}
`);
  writeFileSync(join(appDir, 'views', 'partials', 'blog_posts', 'card.liquid'), `{% doc %}
  @param item {object} - item
{% enddoc %}

<article>{{ item.title }}</article>
`);

  // Commands
  mkdirSync(join(appDir, 'lib', 'commands', 'blog_posts'), { recursive: true });
  writeFileSync(join(appDir, 'lib', 'commands', 'blog_posts', 'create.liquid'), `{% doc %}
  @param title {string} - title
{% enddoc %}

{% parse_json object %}
  { "title": {{ title | json }} }
{% endparse_json %}
{% function object = 'modules/core/commands/build', object: object %}
{% return object %}
`);

  // Queries
  mkdirSync(join(appDir, 'lib', 'queries', 'blog_posts'), { recursive: true });
  writeFileSync(join(appDir, 'lib', 'queries', 'blog_posts', 'search.liquid'), `{% doc %}
  @param page {Int} - page
{% enddoc %}

{% liquid
  graphql result = 'blog_posts/search', page: page
  return result.records
%}
`);

  // Translations
  mkdirSync(join(appDir, 'translations'), { recursive: true });
  writeFileSync(join(appDir, 'translations', 'en.yml'), `blog_posts:
  title: "Blog Posts"
  form:
    title: "Title"
`);

  // Layouts
  mkdirSync(join(appDir, 'views', 'layouts'), { recursive: true });
  writeFileSync(join(appDir, 'views', 'layouts', 'application.html.liquid'), `{{ content_for_layout }}`);

  // Config
  writeFileSync(join(appDir, 'config.yml'), '');

  // Modules
  mkdirSync(join(TEST_DIR, 'modules', 'core'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'modules', 'user'), { recursive: true });

  // .pos file
  writeFileSync(join(TEST_DIR, '.pos'), `staging:
  url: https://staging.example.com
  token: SECRET_TOKEN
production:
  url: https://prod.example.com
  token: SECRET_TOKEN
`);
}

beforeAll(() => setup());
afterAll(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe('project-scanner', () => {
  describe('scanProject', () => {
    it('returns project metadata', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.project.directory).toBe(TEST_DIR);
      expect(result.project.has_config).toBe(true);
      expect(result.project.modules).toContain('core');
      expect(result.project.modules).toContain('user');
    });

    it('strips tokens from environments', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.project.environments).toContain('staging');
      expect(result.project.environments).toContain('production');
      expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
    });

    it('parses schema with properties', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.schema.blog_post).toBeDefined();
      expect(result.schema.blog_post.properties).toHaveLength(4);
      expect(result.schema.blog_post.properties[0]).toEqual({ name: 'title', type: 'string' });
      expect(result.schema.blog_post.properties[3]).toEqual({ name: 'views', type: 'integer' });
    });

    it('parses graphql operations', async () => {
      const result = await scanProject(TEST_DIR);
      const search = result.graphql['blog_posts/search'];
      expect(search).toBeDefined();
      expect(search.operation).toBe('query');
      expect(search.name).toBe('search');
      expect(search.args).toHaveLength(2);
      expect(search.table).toBe('blog_post');

      const create = result.graphql['blog_posts/create'];
      expect(create.operation).toBe('mutation');
      expect(create.name).toBe('create');
    });

    it('indexes pages by slug', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.pages['blog_posts']).toBeDefined();
      expect(result.pages['blog_posts'].method).toBe('get');
      expect(result.pages['blog_posts'].renders).toContain('blog_posts/list');
    });

    it('indexes partials with params', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.partials['blog_posts/list']).toBeDefined();
      expect(result.partials['blog_posts/list'].params).toContain('items');
      expect(result.partials['blog_posts/list'].renders).toContain('blog_posts/card');
    });

    it('builds reverse index (rendered_by)', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.partials['blog_posts/card'].rendered_by).toContain(
        'app/views/partials/blog_posts/list.liquid'
      );
      expect(result.partials['blog_posts/list'].rendered_by).toContain(
        'app/views/pages/blog_posts/index.html.liquid'
      );
    });

    it('indexes commands', async () => {
      const result = await scanProject(TEST_DIR);
      const cmdPath = 'app/lib/commands/blog_posts/create.liquid';
      expect(result.commands[cmdPath]).toBeDefined();
      expect(result.commands[cmdPath].params).toContain('title');
    });

    it('indexes queries', async () => {
      const result = await scanProject(TEST_DIR);
      const qPath = 'app/lib/queries/blog_posts/search.liquid';
      expect(result.queries[qPath]).toBeDefined();
      expect(result.queries[qPath].params).toContain('page');
    });

    it('flattens translations', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.translations.en).toBeDefined();
      expect(result.translations.en['blog_posts.title']).toBe('Blog Posts');
      expect(result.translations.en['blog_posts.form.title']).toBe('Title');
    });

    it('returns file counts', async () => {
      const result = await scanProject(TEST_DIR);
      expect(result.summary.file_counts.schema).toBe(1);
      expect(result.summary.file_counts.graphql).toBe(2);
      expect(result.summary.file_counts.pages).toBe(1);
      expect(result.summary.file_counts.partials).toBe(2);
      expect(result.summary.file_counts.commands).toBe(1);
      expect(result.summary.file_counts.queries).toBe(1);
    });

    it('detects resource completeness', async () => {
      const result = await scanProject(TEST_DIR);
      const bp = result.summary.resources.blog_post;
      expect(bp).toBeDefined();
      expect(bp.schema).toBe('app/schema/blog_post.yml');
      expect(bp.graphql).toContain('blog_posts/search');
      expect(bp.graphql).toContain('blog_posts/create');
      // Missing operations
      expect(bp.missing).toContain('find query');
      expect(bp.missing).toContain('update mutation');
      expect(bp.missing).toContain('delete mutation');
    });
  });

  describe('scanAround', () => {
    it('returns connected files for a page', async () => {
      const pagePath = join(TEST_DIR, 'app', 'views', 'pages', 'blog_posts', 'index.html.liquid');
      const result = await scanAround(TEST_DIR, pagePath);
      expect(result).not.toBeNull();
      expect(Object.keys(result.files).length).toBeGreaterThan(0);
    });

    it('returns null for missing file', async () => {
      const result = await scanAround(TEST_DIR, join(TEST_DIR, 'app', 'missing.liquid'));
      expect(result).toBeNull();
    });
  });

  describe('parseGraphQLFile', () => {
    it('parses query with args', () => {
      const result = parseGraphQLFile(`query search($page: Int = 1, $limit: Int = 20) {
  records(filter: { table: { value: "product" } }) { id }
}`);
      expect(result.operation).toBe('query');
      expect(result.name).toBe('search');
      expect(result.args).toHaveLength(2);
      expect(result.args[0]).toEqual({ name: 'page', type: 'Int' });
      expect(result.table).toBe('product');
    });

    it('parses mutation', () => {
      const result = parseGraphQLFile(`mutation create($title: String!) {
  record_create(record: { table: "blog_post" }) { id }
}`);
      expect(result.operation).toBe('mutation');
      expect(result.name).toBe('create');
      expect(result.table).toBe('blog_post');
    });
  });

  describe('extractFunctionCalls', () => {
    it('extracts from traditional tags', () => {
      const calls = extractFunctionCalls(`{% function result = 'lib/commands/products/create', title: title %}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ variable: 'result', path: 'lib/commands/products/create' });
    });

    it('extracts from liquid blocks', () => {
      const calls = extractFunctionCalls(`{% liquid
  function items = 'lib/queries/products/search', page: page
  function item = 'lib/queries/products/find', id: id
%}`);
      expect(calls).toHaveLength(2);
    });

    it('deduplicates calls', () => {
      const calls = extractFunctionCalls(`{% function r = 'lib/test' %}
{% function r = 'lib/test' %}`);
      expect(calls).toHaveLength(1);
    });
  });

  describe('pluralize', () => {
    it('adds s to regular words', () => {
      expect(pluralize('product')).toBe('products');
    });

    it('handles words ending in y', () => {
      expect(pluralize('category')).toBe('categories');
    });

    it('handles words ending in vowel+y', () => {
      expect(pluralize('key')).toBe('keys');
    });

    it('handles words ending in s', () => {
      expect(pluralize('address')).toBe('addresses');
    });

    it('handles words ending in ch', () => {
      expect(pluralize('match')).toBe('matches');
    });
  });
});
