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

    describe('required properties guard', () => {
      for (const type of ['crud', 'api', 'command']) {
        it(`${type}: rejects missing properties array`, async () => {
          const err = await generateScaffold({ type, name: 'note' }).catch(e => e.message);
          expect(err).toMatch(/requires at least one non-auth property/);
          expect(err).toMatch(/missing or empty/);
          expect(err).toMatch(/Example:/);
        });

        it(`${type}: rejects empty properties array`, async () => {
          const err = await generateScaffold({ type, name: 'note', properties: [] }).catch(e => e.message);
          expect(err).toMatch(/requires at least one non-auth property/);
        });

        it(`${type}: rejects auth-only properties`, async () => {
          const err = await generateScaffold({
            type,
            name: 'note',
            properties: [{ name: 'user_id', type: 'string', role: 'auth' }],
          }).catch(e => e.message);
          expect(err).toMatch(/all properties are role:auth/);
        });

        it(`${type}: accepts mix of non-auth and auth properties`, async () => {
          const result = await generateScaffold({
            type,
            name: 'note',
            properties: [
              { name: 'title', type: 'string' },
              { name: 'user_id', type: 'string', role: 'auth' },
            ],
          });
          expect(result.files.length).toBeGreaterThan(0);
        });
      }

      it('query: accepts missing properties (GraphQL stays valid without them)', async () => {
        const result = await generateScaffold({ type: 'query', name: 'note' });
        expect(result.files.length).toBeGreaterThan(0);
      });

      it('partial: accepts missing properties', async () => {
        const result = await generateScaffold({ type: 'partial', name: 'widget' });
        expect(result.files.length).toBe(1);
      });

      it('page: accepts missing properties', async () => {
        const result = await generateScaffold({ type: 'page', name: 'home' });
        expect(result.files.length).toBe(1);
      });

      it('crud: rejected error message is actionable — includes concrete property example', async () => {
        const err = await generateScaffold({ type: 'crud', name: 'note' }).catch(e => e.message);
        expect(err).toContain('{ name: "title", type: "string" }');
      });
    });
  });

  describe('generated output is always valid', () => {
    it('crud: create.graphql never emits empty mutation args', async () => {
      const result = await generateScaffold(baseOpts);
      const create = result.files.find(f => f.path.endsWith('create.graphql'));
      expect(create.content).not.toMatch(/mutation create\(\)/);
      expect(create.content).toMatch(/mutation create\(\$\w+:/);
    });

    it('crud: schema.yml never emits empty property list', async () => {
      const result = await generateScaffold(baseOpts);
      const schema = result.files.find(f => f.path.endsWith('.yml') && f.path.includes('schema/'));
      const parsed = yaml.load(schema.content);
      expect(parsed.properties).toBeDefined();
      expect(parsed.properties.length).toBeGreaterThan(0);
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
      // Optional params use bracket notation so the LSP's MetadataParamsCheck
      // does not flag them as required on the caller.
      expect(search.content).toContain('@param [page]');
      expect(search.content).toContain('@param [limit]');
      expect(search.content).not.toMatch(/@param\s+page\s+\{/);
      expect(search.content).not.toMatch(/@param\s+limit\s+\{/);
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

    // The scaffold uses an inline `context.current_user.id == null` guard
    // instead of can_do_or_unauthorized. Reason: the user module ships a
    // role_permissions registry that does NOT include per-resource actions
    // like `blog_posts.create`, so can_do_or_unauthorized would return
    // false for every non-superadmin and 403 every authenticated request.
    // Seeding the registry is outside the scaffold's remit (projects carry
    // different permission maps), so the scaffold uses the narrower
    // always-correct check: "any logged-in user may mutate their own
    // records". Ownership is enforced separately via the authProp check
    // on update/delete pages.
    it('create page guards with inline current_user.id null check (not can_do_or_unauthorized)', async () => {
      const create = pages.find(f => f.path.includes('create.html.liquid'));
      expect(create.content).toContain('if context.current_user.id == null');
      expect(create.content).toContain('response_status 403');
      expect(create.content).toContain('break');
      // Must NOT use the role-permissions helper — see comment above.
      expect(create.content).not.toContain('can_do_or_unauthorized');
      expect(create.content).not.toContain('current_profile');
    });

    it('update page carries the same inline guard', async () => {
      const update = pages.find(f => f.path.includes('update.html.liquid'));
      expect(update.content).toContain('if context.current_user.id == null');
      expect(update.content).toContain('response_status 403');
      expect(update.content).not.toContain('can_do_or_unauthorized');
    });

    it('delete page carries the same inline guard', async () => {
      const del = pages.find(f => f.path.includes('delete.html.liquid'));
      expect(del.content).toContain('if context.current_user.id == null');
      expect(del.content).toContain('response_status 403');
      expect(del.content).not.toContain('can_do_or_unauthorized');
    });

    it('index page does not include authorization', async () => {
      const index = pages.find(f => f.path.includes('index.html.liquid'));
      expect(index.content).not.toContain('can_do_or_unauthorized');
      expect(index.content).not.toContain('context.current_user.id == null');
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

    it('index partial uses pos-table layout with real common-styling classes', async () => {
      const index = partials.find(f => f.path.endsWith('blog_posts/index.liquid'));
      expect(index.content).toContain('blog_posts.results.size');
      expect(index.content).toContain("render 'blog_posts/empty_state'");
      expect(index.content).toContain('for blog_post in blog_posts.results');
      expect(index.content).toContain('_method');
      expect(index.content).toContain('value="delete"');
      // pos-table layout from common-styling module (replaces phantom feature-grid/card)
      expect(index.content).toContain('class="pos-table"');
      expect(index.content).toContain('class="pos-table-content pos-card"');
      expect(index.content).toContain('pos-table-content-heading');
      // auth guard on New button
      expect(index.content).toContain('{% if context.current_user.id %}');
      // phantom classes MUST NOT appear
      expect(index.content).not.toContain('feature-grid');
      expect(index.content).not.toContain('"card"');
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

    it('show partial displays title field in heading', async () => {
      const show = partials.find(f => f.path.includes('show.liquid'));
      expect(show.content).toContain('object.title');
      expect(show.content).toContain('@param object');
      expect(show.content).toContain('class="pos-heading-1"');
      expect(show.content).toContain('<article>');
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

    it('uses the single-locale file path', async () => {
      expect(transFile.path).toBe('app/translations/en.yml');
    });

    it('flags the file as deep-merge so re-scaffolds do not conflict', async () => {
      expect(transFile.mergeStrategy).toBe('deep-merge');
    });

    it('reports existed:false when no on-disk file is present (no projectDir)', async () => {
      expect(transFile.existed).toBe(false);
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

    it('includes new, edit, list, save and cancel translations', () => {
      const parsed = yaml.load(transFile.content);
      expect(parsed.en.app.blog_posts.new.new).toBeDefined();
      expect(parsed.en.app.blog_posts.edit.edit).toBeDefined();
      expect(parsed.en.app.blog_posts.list.add).toBeDefined();
      expect(parsed.en.app.blog_posts.list.empty_state).toBeDefined();
      expect(parsed.en.app.blog_posts.list.edit).toBeDefined();
      expect(parsed.en.app.blog_posts.list.delete).toBeDefined();
      expect(parsed.en.app.blog_posts.save).toBeDefined();
      expect(parsed.en.app.blog_posts.cancel).toBeDefined();
    });
  });

  describe('translations deep-merge', () => {
    let tmpDir;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'scaffold-trans-'));
    });
    afterAll(() => {
      if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    async function runWithExisting(existingYaml, opts = baseOpts) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(tmpDir, 'app/translations'), { recursive: true });
      writeFileSync(join(tmpDir, 'app/translations/en.yml'), existingYaml, 'utf8');
      const result = await generateScaffold(opts, tmpDir);
      return result.files.find(f => f.domain === 'translations');
    }

    it('preserves existing keys for the same resource (existing wins on leaf conflicts)', async () => {
      const transFile = await runWithExisting(
        "en:\n  app:\n    blog_posts:\n      save: Guardar\n"
      );
      expect(transFile.existed).toBe(true);
      const parsed = yaml.load(transFile.content);
      expect(parsed.en.app.blog_posts.save).toBe('Guardar');
      // And still introduces scaffold-contributed keys the user doesn't have.
      expect(parsed.en.app.blog_posts.cancel).toBe('Cancel');
      expect(parsed.en.app.blog_posts.attr.title).toBe('Title');
    });

    it('adds the new resource when another resource already lives in the file', async () => {
      const transFile = await runWithExisting(
        "en:\n  app:\n    products:\n      save: Save\n"
      );
      const parsed = yaml.load(transFile.content);
      expect(parsed.en.app.products.save).toBe('Save');
      expect(parsed.en.app.blog_posts.save).toBe('Save');
    });

    it('leaves unrelated locales (pl, de, …) completely untouched', async () => {
      const transFile = await runWithExisting(
        "en:\n  app:\n    existing: Existing\npl:\n  app:\n    hello: Cześć\n"
      );
      const parsed = yaml.load(transFile.content);
      expect(parsed.pl.app.hello).toBe('Cześć');
      expect(parsed.en.app.existing).toBe('Existing');
      expect(parsed.en.app.blog_posts).toBeDefined();
    });

    it('overwrites nothing when the existing file is syntactically broken YAML', async () => {
      const transFile = await runWithExisting('en:\n  app:\n    blog_posts:\n      : : :');
      // The fallback keeps the scaffold tree rather than crashing.
      const parsed = yaml.load(transFile.content);
      expect(parsed.en.app.blog_posts.save).toBe('Save');
    });

    it('marks the translation file existed=true so normalizeScaffoldInput treats it as an update', async () => {
      const transFile = await runWithExisting("en:\n  app:\n    x: y\n");
      expect(transFile.existed).toBe(true);
    });

    it('never reports the translation file as a conflict even when it already exists', async () => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(tmpDir, 'app/translations'), { recursive: true });
      writeFileSync(join(tmpDir, 'app/translations/en.yml'), "en:\n  app:\n    x: y\n", 'utf8');
      const result = await generateScaffold(baseOpts, tmpDir);
      const trConflict = result.conflicts.find(c => c.path === 'app/translations/en.yml');
      expect(trConflict).toBeUndefined();
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
      // Second write should skip all conflicts. The single translation file is
      // deep-merged on re-scaffold (intentional), so it is always written and
      // never reported as a conflict.
      const result2 = await generateScaffold({ ...baseOpts, name: 'thing', write: true }, tmpDir);
      expect(result2.conflicts.length).toBeGreaterThan(0);
      expect(result2.conflicts.find(c => c.path === 'app/translations/en.yml')).toBeUndefined();
      expect(result2.skipped.length).toBe(result2.conflicts.length);
      expect(result2.written).toEqual(['app/translations/en.yml']);
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

    it('auto-enables authorization when auth fields present (inline guard, not can_do)', async () => {
      const result = await generateScaffold(authOpts);
      const createPage = result.files.find(f => f.path.includes('create.html.liquid'));
      expect(createPage.content).toContain('if context.current_user.id == null');
      expect(createPage.content).toContain('response_status 403');
      expect(createPage.content).not.toContain('can_do_or_unauthorized');
    });

    it('adds a note when authorization is auto-enabled', async () => {
      const result = await generateScaffold(authOpts);
      expect(result.notes).toBeDefined();
      expect(result.notes.some(n => /Authorization automatically enabled/.test(n))).toBe(true);
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

    // ── ownership filter in search query ─────────────────────────────────────
    //
    // Pins the fix for the original ghost bug: scaffolded CRUD with a role:auth
    // property used to return every user's records because the search query had
    // no ownership filter. The GraphQL side now takes a required user_id
    // variable and the Liquid wrapper supplies it from context.current_user.id.

    it('search GraphQL filters by the auth field (ownership)', async () => {
      const result = await generateScaffold(authOpts);
      const searchGql = result.files.find(f => f.path.endsWith('search.graphql'));
      expect(searchGql.content).toContain('$user_id: String!');
      expect(searchGql.content).toContain('properties: [{ name: "user_id", value: $user_id }]');
    });

    it('search Liquid wrapper passes current_user.id as user_id', async () => {
      const result = await generateScaffold(authOpts);
      const searchQuery = result.files.find(f => f.path.endsWith('queries/blog_posts/search.liquid'));
      expect(searchQuery.content).toContain('user_id: context.current_user.id');
      expect(searchQuery.content).toContain('if context.current_user.id');
    });

    it('search Liquid wrapper returns an empty result set for anonymous callers', async () => {
      // Anonymous visitors cannot be resolved to an owner, and a graphql call
      // with a null required variable errors. The wrapper short-circuits to an
      // empty records shape that the index partial can render safely.
      const result = await generateScaffold(authOpts);
      const searchQuery = result.files.find(f => f.path.endsWith('queries/blog_posts/search.liquid'));
      expect(searchQuery.content).toContain('parse_json');
      expect(searchQuery.content).toContain('empty_result');
    });

    // ── ownership guards on show / update / delete ───────────────────────────

    it('show page 404s when the record is not owned by the caller', async () => {
      const result = await generateScaffold(authOpts);
      const show = result.files.find(f => f.path.includes('show.html.liquid'));
      expect(show.content).toContain('object.user_id != context.current_user.id');
      expect(show.content).toContain('response_status 404');
    });

    it('update page re-fetches the record and aborts if not owned by the caller', async () => {
      const result = await generateScaffold(authOpts);
      const update = result.files.find(f => f.path.includes('update.html.liquid'));
      // Must use a fresh lookup (not trust form payload) to decide ownership.
      expect(update.content).toContain("function existing = 'queries/blog_posts/find', id: context.params.blog_post.id");
      expect(update.content).toContain('existing.user_id != context.current_user.id');
      expect(update.content).toContain('response_status 404');
    });

    it('delete page refuses to delete records the caller does not own', async () => {
      const result = await generateScaffold(authOpts);
      const del = result.files.find(f => f.path.includes('delete.html.liquid'));
      expect(del.content).toContain('object.user_id != context.current_user.id');
      expect(del.content).toContain('response_status 404');
    });

    // ── owner-field auto-upgrade ─────────────────────────────────────────────
    //
    // Agents (including humans) routinely pass `user_id` as a plain `string`
    // property. Without auto-upgrade the form exposes user_id as editable, the
    // build command copies it from the form payload, and any authenticated
    // visitor can spoof ownership. The scaffold silently promotes the canonical
    // owner field names and emits a note so the agent learns what happened.

    it('auto-upgrades user_id / owner_id / author_id / created_by to role:auth when include_authorization is set', async () => {
      for (const fieldName of ['user_id', 'owner_id', 'author_id', 'created_by']) {
        const result = await generateScaffold({
          type: 'crud',
          name: 'post',
          include_authorization: true,
          properties: [
            { name: 'title', type: 'string' },
            { name: fieldName, type: 'string' },
          ],
        });
        const form = result.files.find(f => f.path.endsWith('form.liquid'));
        expect(form.content, `form for ${fieldName}`).not.toContain(`name="post[${fieldName}]"`);
        const build = result.files.find(f => f.path.endsWith('create/build.liquid'));
        expect(build.content, `build for ${fieldName}`).toContain(`assign object['${fieldName}'] = context.current_user.id`);
        expect(result.notes.some(n => n.includes(fieldName) && /Auto-upgraded to role:auth/.test(n))).toBe(true);
      }
    });

    it('does NOT auto-upgrade owner fields when include_authorization is not set', async () => {
      const result = await generateScaffold({
        type: 'crud',
        name: 'post',
        properties: [
          { name: 'title', type: 'string' },
          { name: 'user_id', type: 'string' },
        ],
        // include_authorization omitted — agent opted out of ownership semantics
      });
      const form = result.files.find(f => f.path.endsWith('form.liquid'));
      expect(form.content).toContain('name="post[user_id]"');
      expect((result.notes ?? []).some(n => /Auto-upgraded to role:auth/.test(n))).toBe(false);
    });

    it('an explicit user_id without role:auth but with include_authorization flips include_authorization on via the upgrade', async () => {
      // Auto-upgrade runs BEFORE the "auth fields → include_authorization" check
      // so the upgrade itself is what triggers the guarded pages.
      const result = await generateScaffold({
        type: 'crud',
        name: 'post',
        include_authorization: true,
        properties: [
          { name: 'title', type: 'string' },
          { name: 'user_id', type: 'string' },
        ],
      });
      const createPage = result.files.find(f => f.path.includes('create.html.liquid'));
      expect(createPage.content).toContain('if context.current_user.id == null');
      expect(createPage.content).toContain('response_status 403');
    });
  });
});
