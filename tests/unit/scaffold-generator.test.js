import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { generateScaffold } from '../../src/core/scaffold-generator.js';
import { parseLiquidFile, extractAllFromAST } from '../../src/core/liquid-parser.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

describe('scaffold-generator', () => {
  const baseOpts = {
    type: 'crud',
    name: 'blog_post',
    properties: [
      { name: 'title', type: 'string' },
      { name: 'body', type: 'text' },
    ],
  };

  describe('input validation', () => {
    it('rejects invalid name', async () => {
      expect(await generateScaffold({ ...baseOpts, name: 'BlogPost' }).catch(e => e.message)).toMatch(/snake_case/);
    });

    it('rejects invalid property type', async () => {
      expect(await generateScaffold({
        ...baseOpts,
        properties: [{ name: 'x', type: 'invalid' }],
      }).catch(e => e.message)).toMatch(/Invalid property type/);
    });

    it('rejects invalid scaffold type', async () => {
      expect(await generateScaffold({ ...baseOpts, type: 'unknown' }).catch(e => e.message)).toMatch(/Invalid scaffold type/);
    });
  });

  describe('crud scaffold', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); });

    it('generates expected number of files', async () => {
      // config(1) + layout(1) + schema(1) + graphql(5) + queries(2) + commands(8) + partials(6) + pages(7) + translations(1) = 32
      expect(result.files.length).toBe(32);
    });

    it('returns correct creation_order', async () => {
      expect(result.creation_order).toEqual([
        'config', 'schema', 'graphql', 'queries', 'commands', 'partials', 'pages', 'translations',
      ]);
    });

    it('includes summary', async () => {
      expect(result.summary).toContain('blog_posts');
      expect(result.summary).toContain('crud');
    });

    it('includes _instructions for agent trust', async () => {
      expect(result._instructions).toBeDefined();
      expect(result._instructions).toContain('WRITE EACH FILE EXACTLY AS-IS');
      expect(result._instructions).toContain('Do NOT modify');
    });

    it('detects no conflicts without projectDir', async () => {
      expect(result.conflicts).toEqual([]);
    });
  });

  describe('layout file', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); layoutFile = result.files.find(f => f.path.includes('layouts/application.liquid')) });
    let layoutFile;

    it('generates layout with common-styling init', async () => {
      expect(layoutFile).toBeDefined();
      expect(layoutFile.content).toContain('class="pos-app"');
      expect(layoutFile.content).toContain("render 'modules/common-styling/init'");
      expect(layoutFile.content).toContain('content_for_layout');
      expect(layoutFile.content).toContain("theme_render_rc 'modules/common-styling/toasts'");
    });
  });

  describe('config file', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); configFile = result.files.find(f => f.path === 'app/config.yml') });
    let configFile;

    it('generates config.yml with recommended settings', async () => {
      const parsed = yaml.load(configFile.content);
      expect(parsed.require_table_for_record_delete_mutation).toBe(true);
      expect(parsed.string_interpolation).toBe(true);
      expect(parsed.slug_exact_match).toBe(true);
      expect(parsed.liquid_raise_mode).toBe(true);
      expect(parsed.high_performance_sql_filtering).toBe(true);
    });
  });

  describe('schema file', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); schemaFile = result.files.find(f => f.path.includes('schema/')) });
    let schemaFile;

    it('generates valid YAML', async () => {
      const parsed = yaml.load(schemaFile.content);
      expect(parsed.name).toBe('blog_post');
      expect(parsed.properties).toHaveLength(2);
      expect(parsed.properties[0]).toEqual({ name: 'title', type: 'string' });
      expect(parsed.properties[1]).toEqual({ name: 'body', type: 'text' });
    });

    it('uses correct path', async () => {
      expect(schemaFile.path).toBe('app/schema/blog_post.yml');
    });
  });

  describe('graphql files', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); gqlFiles = result.files.filter(f => f.domain === 'graphql') });
    let gqlFiles;

    it('generates 5 graphql files', async () => {
      expect(gqlFiles).toHaveLength(5);
    });

    it('search query uses correct table and accessors', async () => {
      const search = gqlFiles.find(f => f.path.includes('search.graphql'));
      expect(search.content).toContain('table: { value: "blog_post" }');
      expect(search.content).toContain('title: property(name: "title")');
      expect(search.content).toContain('body: property(name: "body")');
      expect(search.content).toContain('query search(');
      expect(search.content).toContain('total_entries');
      expect(search.content).toContain('total_pages');
    });

    it('create mutation uses record: alias and correct value keys', async () => {
      const create = gqlFiles.find(f => f.path.includes('create.graphql'));
      expect(create.content).toContain('mutation create(');
      expect(create.content).toContain('$title: String');
      expect(create.content).toContain('record: record_create(');
      expect(create.content).toContain('name: "title", value: $title');
      expect(create.content).toContain('name: "body", value: $body');
    });

    it('update mutation uses record: alias and includes id', async () => {
      const update = gqlFiles.find(f => f.path.includes('update.graphql'));
      expect(update.content).toContain('$id: ID!');
      expect(update.content).toContain('record: record_update(');
      expect(update.content).toContain('id: $id');
    });

    it('delete mutation uses record: alias and includes table', async () => {
      const del = gqlFiles.find(f => f.path.includes('delete.graphql'));
      expect(del.content).toContain('mutation delete($id: ID!)');
      expect(del.content).toContain('record: record_delete(');
      expect(del.content).toContain('table: "blog_post"');
    });
  });

  describe('graphql with typed properties', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold({
      type: 'crud',
      name: 'product',
      properties: [
        { name: 'title', type: 'string' },
        { name: 'price', type: 'float' },
        { name: 'quantity', type: 'integer' },
        { name: 'active', type: 'boolean' },
      ],
    }); });

    it('uses typed value keys in create mutation', async () => {
      const create = result.files.find(f => f.path.includes('create.graphql'));
      expect(create.content).toContain('$price: Float');
      expect(create.content).toContain('$quantity: Int');
      expect(create.content).toContain('$active: Boolean');
      expect(create.content).toContain('value_float: $price');
      expect(create.content).toContain('value_int: $quantity');
      expect(create.content).toContain('value_boolean: $active');
    });

    it('uses typed accessors in search query', async () => {
      const search = result.files.find(f => f.path.includes('search.graphql'));
      expect(search.content).toContain('price: property_float(name: "price")');
      expect(search.content).toContain('quantity: property_int(name: "quantity")');
      expect(search.content).toContain('active: property_boolean(name: "active")');
    });
  });

  describe('command files', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); cmds = result.files.filter(f => f.domain === 'commands') });
    let cmds;

    it('generates 8 command files (3 mains + 2 builds + 3 checks)', async () => {
      expect(cmds).toHaveLength(8);
    });

    it('create main orchestrates build → check → execute', async () => {
      const create = cmds.find(f => f.path.endsWith('create.liquid'));
      expect(create.content).toContain("commands/blog_posts/create/build");
      expect(create.content).toContain("commands/blog_posts/create/check");
      expect(create.content).toContain("if object.valid");
      expect(create.content).toContain("modules/core/commands/execute");
      expect(create.content).toContain("mutation_name: 'blog_posts/create'");
      expect(create.content).toContain("selection: 'record'");
      expect(create.content).toContain("return object");
      expect(create.content).toContain("@param object {object}");
    });

    it('create build reshapes object fields', async () => {
      const build = cmds.find(f => f.path.includes('create/build.liquid'));
      expect(build.content).toContain("object['title'] = object.title");
      expect(build.content).toContain("object['body'] = object.body");
      expect(build.content).toContain("return object");
    });

    it('create check validates with modules/core/validations/presence', async () => {
      const check = cmds.find(f => f.path.includes('create/check.liquid'));
      expect(check.content).toContain("modules/core/validations/presence");
      expect(check.content).toContain("field_name: 'title'");
      expect(check.content).toContain("field_name: 'body'");
      expect(check.content).toContain("hash_merge: valid: c.valid, errors: c.errors");
    });

    it('update main uses execute with mutation_name and selection', async () => {
      const update = cmds.find(f => f.path.endsWith('update.liquid'));
      expect(update.content).toContain("mutation_name: 'blog_posts/update'");
      expect(update.content).toContain("selection: 'record'");
      expect(update.content).toContain("@param object {object}");
    });

    it('update check validates id and all fields', async () => {
      const check = cmds.find(f => f.path.includes('update/check.liquid'));
      expect(check.content).toContain("field_name: 'id'");
      expect(check.content).toContain("field_name: 'title'");
    });

    it('delete main has no build step', async () => {
      const del = cmds.find(f => f.path.endsWith('delete.liquid'));
      expect(del.content).toContain("commands/blog_posts/delete/check");
      expect(del.content).not.toContain('build');
      expect(del.content).toContain("mutation_name: 'blog_posts/delete'");
    });

    it('delete check validates only id', async () => {
      const check = cmds.find(f => f.path.includes('delete/check.liquid'));
      expect(check.content).toContain("field_name: 'id'");
      expect(check.content).not.toContain("field_name: 'title'");
    });
  });

  describe('command files parse as valid Liquid', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); cmds = result.files.filter(f => f.domain === 'commands') });
    let cmds;

    it('all command files parse as valid Liquid', async () => {
      for (const cmd of cmds) {
        const ast = parseLiquidFile(cmd.content);
        expect(ast).not.toBeNull();
      }
    });
  });

  describe('query files', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); queries = result.files.filter(f => f.domain === 'queries') });
    let queries;

    it('generates 2 query files', async () => {
      expect(queries).toHaveLength(2);
    });

    it('search query wraps graphql call', async () => {
      const search = queries.find(f => f.path.includes('search.liquid'));
      expect(search.content).toContain("graphql result = 'blog_posts/search'");
      expect(search.content).toContain('return result.records');
      expect(search.content).toContain('@param page');
    });

    it('find query returns single item', async () => {
      const find = queries.find(f => f.path.includes('find.liquid'));
      expect(find.content).toContain("graphql result = 'blog_posts/find'");
      expect(find.content).toContain('result.records.results.first');
      expect(find.content).toContain('@param id');
    });

    it('all query files parse as valid Liquid', async () => {
      for (const q of queries) {
        const ast = parseLiquidFile(q.content);
        expect(ast).not.toBeNull();
      }
    });
  });

  describe('page files', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); pages = result.files.filter(f => f.domain === 'pages') });
    let pages;

    it('generates 7 page files', async () => {
      expect(pages).toHaveLength(7);
    });

    it('index page has correct frontmatter and renders index partial', async () => {
      const index = pages.find(f => f.path.includes('index.html.liquid'));
      expect(index.content).toContain('slug: blog_posts');
      expect(index.content).toContain('layout: application');
      expect(index.content).toContain("render 'blog_posts/index'");
      expect(index.content).toContain("function blog_posts = 'queries/blog_posts/search'");
    });

    it('show page queries by id with 404 handling', async () => {
      const show = pages.find(f => f.path.includes('show.html.liquid'));
      expect(show.content).toContain('slug: blog_posts/:id');
      expect(show.content).toContain('context.params.id');
      expect(show.content).toContain("function object = 'queries/blog_posts/find'");
      expect(show.content).toContain('if object.id');
      expect(show.content).toContain('response_status 404');
    });

    it('create page uses POST method and renders new on error', async () => {
      const create = pages.find(f => f.path.includes('create.html.liquid'));
      expect(create.content).toContain('method: post');
      expect(create.content).toContain("function object = 'commands/blog_posts/create'");
      expect(create.content).toContain('context.params.blog_post');
      expect(create.content).toContain('redirect_to');
      expect(create.content).toContain("render 'blog_posts/new'");
    });

    it('update page uses PUT method', async () => {
      const update = pages.find(f => f.path.includes('update.html.liquid'));
      expect(update.content).toContain('method: put');
      expect(update.content).toContain("function object = 'commands/blog_posts/update'");
      expect(update.content).toContain("render 'blog_posts/edit'");
    });

    it('delete page uses DELETE method and redirects', async () => {
      const del = pages.find(f => f.path.includes('delete.html.liquid'));
      expect(del.content).toContain('method: delete');
      expect(del.content).toContain("redirect_to '/blog_posts'");
      expect(del.content).toContain("function object = 'commands/blog_posts/delete'");
    });

    it('all page files parse as valid Liquid', async () => {
      for (const p of pages) {
        const ast = parseLiquidFile(p.content);
        expect(ast).not.toBeNull();
      }
    });
  });

  describe('page files with authorization', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold({ ...baseOpts, include_authorization: true }); pages = result.files.filter(f => f.domain === 'pages'); });
    let pages;

    it('create page includes authorization via function (not deprecated include)', async () => {
      const create = pages.find(f => f.path.includes('create.html.liquid'));
      expect(create.content).toContain("modules/user/queries/user/current");
      expect(create.content).toContain("function _ = 'modules/user/helpers/can_do_or_unauthorized'");
      expect(create.content).not.toContain("include ");
    });

    it('index page does not include authorization', async () => {
      const index = pages.find(f => f.path.includes('index.html.liquid'));
      expect(index.content).not.toContain('can_do_or_unauthorized');
    });
  });

  describe('partial files', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); partials = result.files.filter(f => f.domain === 'partials') });
    let partials;

    it('generates 6 partial files', async () => {
      // index, show, new, edit, form, empty_state
      expect(partials).toHaveLength(6);
    });

    it('index partial uses common-styling pos-table structure', async () => {
      const index = partials.find(f => f.path.endsWith('blog_posts/index.liquid'));
      expect(index.content).toContain('blog_posts.results.size');
      expect(index.content).toContain("render 'blog_posts/empty_state'");
      expect(index.content).toContain('for blog_post in blog_posts.results');
      expect(index.content).toContain('_method');
      expect(index.content).toContain('value="delete"');
      // common-styling pos-table structure
      expect(index.content).toContain('<section class="pos-table">');
      expect(index.content).toContain('<header>');
      expect(index.content).toContain('class="pos-table-content pos-card"');
      expect(index.content).toContain('pos-table-content-heading');
      // delete form has no pos-form class
      expect(index.content).not.toContain('class="pos-form"');
    });

    it('form partial uses fieldset and common-styling error partials', async () => {
      const form = partials.find(f => f.path.includes('form.liquid'));
      expect(form.content).toContain('authenticity_token');
      expect(form.content).toContain('name="blog_post[title]"');
      expect(form.content).toContain('name="blog_post[body]"');
      expect(form.content).toContain('<textarea');
      expect(form.content).toContain('_method');
      expect(form.content).toContain('class="pos-form pos-form-simple"');
      // fieldset wrappers
      expect(form.content).toContain('<fieldset>');
      expect(form.content).toContain('<fieldset class="pos-form-actions">');
      // common-styling error partials
      expect(form.content).toContain("render 'modules/common-styling/forms/error_input_handler'");
      expect(form.content).toContain("render 'modules/common-styling/forms/error_list'");
      expect(form.content).not.toContain('<small>');
    });

    it('form partial includes hidden id for edit mode', async () => {
      const form = partials.find(f => f.path.includes('form.liquid'));
      expect(form.content).toContain('{% if object.id %}');
      expect(form.content).toContain('name="blog_post[id]"');
    });

    it('show partial displays fields with pos-card class', async () => {
      const show = partials.find(f => f.path.includes('show.liquid'));
      expect(show.content).toContain('object.id');
      expect(show.content).toContain('object.title');
      expect(show.content).toContain('@param object');
      expect(show.content).toContain('class="pos-card"');
    });

    it('new partial wraps form', async () => {
      const newP = partials.find(f => f.path.endsWith('blog_posts/new.liquid'));
      expect(newP.content).toContain("render 'blog_posts/form', object: object");
    });

    it('edit partial wraps form', async () => {
      const editP = partials.find(f => f.path.endsWith('blog_posts/edit.liquid'));
      expect(editP.content).toContain("render 'blog_posts/form', object: object");
    });

    it('form partial uses common-styling error handling per field', async () => {
      const form = partials.find(f => f.path.includes('form.liquid'));
      expect(form.content).toContain("errors: object.errors.title");
      expect(form.content).toContain("errors: object.errors.body");
      expect(form.content).not.toContain("theme/simple");
    });

    it('all partial files parse as valid Liquid', async () => {
      for (const p of partials) {
        const ast = parseLiquidFile(p.content);
        expect(ast).not.toBeNull();
      }
    });
  });

  describe('partial files with doc blocks', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); partials = result.files.filter(f => f.domain === 'partials') });
    let partials;

    it('index partial has doc block', async () => {
      const index = partials.find(f => f.path.endsWith('blog_posts/index.liquid'));
      const ast = parseLiquidFile(index.content);
      const extracted = extractAllFromAST(ast);
      expect(extracted.docParams.has('blog_posts')).toBe(true);
    });

    it('form partial has doc block with object param', async () => {
      const form = partials.find(f => f.path.includes('form.liquid'));
      const ast = parseLiquidFile(form.content);
      const extracted = extractAllFromAST(ast);
      expect(extracted.docParams.has('object')).toBe(true);
    });
  });

  describe('translations file', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold(baseOpts); transFile = result.files.find(f => f.domain === 'translations') });
    let transFile;

    it('uses per-model file path', async () => {
      expect(transFile.path).toBe('app/translations/en/blog_posts.yml');
    });

    it('generates valid YAML with en: app: hierarchy', async () => {
      const parsed = yaml.load(transFile.content);
      expect(parsed.en).toBeDefined();
      expect(parsed.en.app).toBeDefined();
      expect(parsed.en.app.blog_posts).toBeDefined();
    });

    it('includes attr translations', async () => {
      const parsed = yaml.load(transFile.content);
      expect(parsed.en.app.blog_posts.attr.title).toBe('Title');
      expect(parsed.en.app.blog_posts.attr.body).toBe('Body');
    });

    it('includes new, edit, and list translations', () => {
      const parsed = yaml.load(transFile.content);
      expect(parsed.en.app.blog_posts.new.new).toContain('blog_post');
      expect(parsed.en.app.blog_posts.edit.edit).toContain('blog_post');
      expect(parsed.en.app.blog_posts.list.add).toContain('blog_post');
      expect(parsed.en.app.blog_posts.list.empty_state).toBeDefined();
    });
  });

  describe('without translations', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold({ ...baseOpts, include_translations: false }); });

    it('does not generate translations file', async () => {
      expect(result.files.find(f => f.domain === 'translations')).toBeUndefined();
    });

    it('form uses plain text labels', async () => {
      const form = result.files.find(f => f.path.includes('form.liquid'));
      expect(form.content).toContain('>Title<');
      expect(form.content).not.toContain("'app.blog_posts.attr.title' | t");
    });
  });

  describe('api scaffold', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold({ ...baseOpts, type: 'api' }); });

    it('generates schema + graphql + queries + commands only', async () => {
      const domains = new Set(result.files.map(f => f.domain));
      expect(domains.has('schema')).toBe(true);
      expect(domains.has('graphql')).toBe(true);
      expect(domains.has('commands')).toBe(true);
      expect(domains.has('queries')).toBe(true);
      expect(domains.has('pages')).toBe(false);
      expect(domains.has('partials')).toBe(false);
    });
  });

  describe('command scaffold', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold({ ...baseOpts, type: 'command' }); });

    it('generates graphql + command (main + build + check)', async () => {
      expect(result.files).toHaveLength(4);
      expect(result.files[0].domain).toBe('graphql');
      expect(result.files.filter(f => f.domain === 'commands')).toHaveLength(3);
    });
  });

  describe('query scaffold', () => {
    let result;
    beforeAll(async () => { result = await generateScaffold({ ...baseOpts, type: 'query' }); });

    it('generates graphql + query', async () => {
      expect(result.files).toHaveLength(2);
      expect(result.files[0].domain).toBe('graphql');
      expect(result.files[1].domain).toBe('queries');
    });
  });

  describe('write mode', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'scaffold-write-'));

    afterAll(() => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });

    it('writes files to disk when write=true', async () => {
      const result = await generateScaffold({ ...baseOpts, write: true }, tmpDir);
      expect(result.written.length).toBeGreaterThan(0);
      expect(result.skipped).toEqual([]);

      // Verify files exist on disk
      for (const filePath of result.written) {
        const abs = join(tmpDir, filePath);
        expect(existsSync(abs)).toBe(true);
      }

      // Verify content was written correctly
      const schemaPath = join(tmpDir, 'app/schema/blog_post.yml');
      const content = readFileSync(schemaPath, 'utf8');
      expect(content).toContain('name: blog_post');
    });

    it('includes file content in response even when write=true', async () => {
      const result = await generateScaffold({ ...baseOpts, name: 'widget', write: true }, tmpDir);
      for (const f of result.files) {
        expect(f.content).toBeDefined();
        expect(f.path).toBeDefined();
        expect(f.domain).toBeDefined();
      }
    });

    it('skips existing files and reports them', async () => {
      // First write creates files
      await generateScaffold({ ...baseOpts, name: 'thing', write: true }, tmpDir);
      // Second write should skip all
      const result2 = await generateScaffold({ ...baseOpts, name: 'thing', write: true }, tmpDir);
      expect(result2.conflicts.length).toBeGreaterThan(0);
      expect(result2.skipped.length).toBe(result2.conflicts.length);
      expect(result2.written).toEqual([]);
    });

    it('does not include _instructions when write=true', async () => {
      const result = await generateScaffold({ ...baseOpts, name: 'gadget', write: true }, tmpDir);
      expect(result._instructions).toBeUndefined();
    });

    it('summary mentions written count', async () => {
      const result = await generateScaffold({ ...baseOpts, name: 'item', write: true }, tmpDir);
      expect(result.summary).toContain('Wrote');
    });
  });

  describe('pluralization', () => {
    it('pluralizes standard names', async () => {
      const result = await generateScaffold({ ...baseOpts, name: 'product' });
      expect(result.files.some(f => f.path.includes('products/'))).toBe(true);
    });

    it('pluralizes names ending in y', async () => {
      const result = await generateScaffold({ ...baseOpts, name: 'category' });
      expect(result.files.some(f => f.path.includes('categories/'))).toBe(true);
    });

    it('pluralizes names ending in s', async () => {
      const result = await generateScaffold({ ...baseOpts, name: 'address' });
      expect(result.files.some(f => f.path.includes('addresses/'))).toBe(true);
    });
  });

  describe('auth-role properties', () => {
    const authOpts = {
      type: 'crud',
      name: 'blog_post',
      properties: [
        { name: 'title', type: 'string' },
        { name: 'user_id', type: 'string', role: 'auth' },
      ],
    };

    it('rejects invalid role value', async () => {
      expect(await generateScaffold({
        ...baseOpts,
        properties: [{ name: 'x', type: 'string', role: 'invalid' }],
      }).catch(e => e.message)).toMatch(/Invalid property role/);
    });

    it('auto-enables authorization when auth fields present', async () => {
      const result = await generateScaffold(authOpts);
      const createPage = result.files.find(f => f.path.includes('create.html.liquid'));
      expect(createPage.content).toContain("modules/user/helpers/can_do_or_unauthorized");
    });

    it('adds a note when authorization is auto-enabled', async () => {
      const result = await generateScaffold(authOpts);
      expect(result.notes).toBeDefined();
      expect(result.notes[0]).toMatch(/Authorization automatically enabled/);
    });

    it('does not add note when include_authorization already true', async () => {
      const result = await generateScaffold({ ...authOpts, include_authorization: true });
      expect(result.notes).toBeUndefined();
    });

    it('create build command assigns auth field from current_user.id', async () => {
      const result = await generateScaffold(authOpts);
      const createBuild = result.files.find(f => f.path.includes('create/build.liquid'));
      expect(createBuild.content).toContain("assign object['user_id'] = context.current_user.id");
      expect(createBuild.content).not.toContain("assign object['user_id'] = object.user_id");
    });

    it('update build command skips auth field entirely', async () => {
      const result = await generateScaffold(authOpts);
      const updateBuild = result.files.find(f => f.path.includes('update/build.liquid'));
      expect(updateBuild.content).not.toContain('user_id');
    });

    it('create check command skips validation for auth field', async () => {
      const result = await generateScaffold(authOpts);
      const createCheck = result.files.find(f => f.path.includes('create/check.liquid'));
      expect(createCheck.content).not.toContain("field_name: 'user_id'");
      expect(createCheck.content).toContain("field_name: 'title'");
    });

    it('update check command skips validation for auth field', async () => {
      const result = await generateScaffold(authOpts);
      const updateCheck = result.files.find(f => f.path.includes('update/check.liquid'));
      expect(updateCheck.content).not.toContain("field_name: 'user_id'");
    });

    it('form partial excludes auth field input', async () => {
      const result = await generateScaffold(authOpts);
      const form = result.files.find(f => f.path.includes('form.liquid'));
      expect(form.content).not.toContain('name="blog_post[user_id]"');
      expect(form.content).toContain('name="blog_post[title]"');
    });

    it('update mutation excludes auth field from params and props', async () => {
      const result = await generateScaffold(authOpts);
      const updateGql = result.files.find(f => f.path.includes('update.graphql'));
      expect(updateGql.content).not.toContain('$user_id');
      // But still readable in return fields
      expect(updateGql.content).toContain('user_id: property');
    });

    it('create mutation still includes auth field as param (build sets it)', async () => {
      const result = await generateScaffold(authOpts);
      const createGql = result.files.find(f => f.path.includes('create.graphql'));
      expect(createGql.content).toContain('$user_id: String');
    });

    it('schema still includes auth field as stored property', async () => {
      const result = await generateScaffold(authOpts);
      const schema = result.files.find(f => f.path.endsWith('.yml') && f.domain === 'schema');
      expect(schema.content).toContain('name: user_id');
    });
  });
});
