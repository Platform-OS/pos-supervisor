import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { scanModule, listModules } from '../../src/core/module-scanner.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// ── Temp project with a realistic module structure ───────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'module-scanner-'));

function writeFile(relPath, content) {
  const abs = join(tmpDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

beforeAll(() => {
  // Core module
  writeFile('modules/core/template-values.json', JSON.stringify({
    name: 'Pos Module Core',
    machine_name: 'core',
    type: 'module',
    version: '1.5.5',
    dependencies: {},
  }));

  // Core commands
  writeFile('modules/core/public/lib/commands/build.liquid', `{% doc %}
  @param object {object} - data object to build
{% enddoc %}
{% liquid
  assign object = object | hash_merge: valid: true, errors: null
  return object
%}`);

  writeFile('modules/core/public/lib/commands/check.liquid', `{% doc %}
  @param object {object} - data object to validate
  @param validators {array} - list of validator definitions
{% enddoc %}
{% liquid
  return object
%}`);

  writeFile('modules/core/public/lib/commands/execute.liquid', `{% doc %}
  @param mutation_name {string} - GraphQL mutation path
  @param selection {string} - result selection key
  @param object {object} - data object to persist
{% enddoc %}
{% liquid
  graphql r = mutation_name, data: object
  return r[selection]
%}`);

  // Core helpers
  writeFile('modules/core/public/lib/helpers/redirect_to.liquid', `{% comment %}
  Redirects to the given URL.
  url: string
    the URL to redirect to
{% endcomment %}
{% liquid
  redirect_to url
%}`);

  // Core validations
  writeFile('modules/core/public/lib/validations/presence.liquid', `{% doc %}
  @param object {object} - object to check
  @param field_name {string} - property name to validate
  @param c {object} - contract/error accumulator
{% enddoc %}
{% liquid
  return c
%}`);

  writeFile('modules/core/public/lib/validations/email.liquid', `{% comment %}
  Validates email format.
  object: hash
  field_name: string
  c: hash
{% endcomment %}
{% liquid
  return c
%}`);

  writeFile('modules/core/public/lib/validations/numericality.liquid', '{% return c %}');

  // Core events
  writeFile('modules/core/public/lib/commands/events/publish.liquid', `{% doc %}
  @param type {string} - event type name
  @param object {object} - event payload
{% enddoc %}
{% return null %}`);

  // Core queries
  writeFile('modules/core/public/lib/queries/hook/search.liquid', '{% return null %}');

  // Core schemas
  writeFile('modules/core/public/schema/status.yml', `name: status
properties:
  - name: name
    type: string
  - name: timestamp
    type: datetime
  - name: reference_id
    type: string`);

  // Core graphql
  writeFile('modules/core/public/graphql/records/create.graphql', `mutation ($table: String!, $data: HashObject!) {
  record_create(
    record: {
      table: $table
      properties: $data
    }
  ) {
    id
  }
}`);

  writeFile('modules/core/public/graphql/session/get.graphql', `query ($key: String!) {
  session(key: $key)
}`);

  // Core translations
  writeFile('modules/core/public/translations/en.yml', `core:
  validation:
    presence: "can't be blank"
    email: "is not a valid email"
    numericality: "is not a number"`);

  // Core pages
  writeFile('modules/core/public/views/pages/health.liquid', `---
slug: _core/health
---
{ "status": "ok" }`);

  // ── User module ──────────────────────────────────────────────────────────
  writeFile('modules/user/template-values.json', JSON.stringify({
    name: 'User',
    machine_name: 'user',
    type: 'module',
    version: '5.1.2',
    dependencies: { core: '^1.5.0', 'common-styling': '^1.11.0' },
  }));

  writeFile('modules/user/public/lib/queries/user/current.liquid', `{% liquid
  graphql r = 'modules/user/user/current'
  return r.current_user
%}`);

  writeFile('modules/user/public/lib/queries/user/find.liquid', `{% doc %}
  @param id {string} - user ID to find
  @param email {string} - email to find
{% enddoc %}
{% liquid
  graphql r = 'modules/user/user/find', id: id, email: email
  return r.users.results.first
%}`);

  writeFile('modules/user/public/lib/helpers/can_do_or_unauthorized.liquid', `{% doc %}
  @param requester {object} - current user profile
  @param do {string} - permission string (e.g., 'products.create')
{% enddoc %}
{% liquid
  return null
%}`);

  writeFile('modules/user/public/lib/commands/user/create.liquid', `{% comment %}
  Creates a user.
  first_name: string
  last_name: string
  email: string
  password: string
{% endcomment %}
{% liquid
  function object = 'modules/user/commands/user/create/build', first_name: first_name
  function object = 'modules/user/commands/user/create/check', object: object
  if object.valid
    function user = 'modules/core/commands/execute', mutation_name: 'modules/user/user/create', object: object, selection: 'user'
    return user
  endif
  return object
%}`);

  writeFile('modules/user/public/graphql/user/find.graphql', `query ($id: ID, $email: String, $limit: Int = 1) {
  users(per_page: $limit, filter: { id: { value: $id }, email: { value: $email } }) {
    results { id email created_at }
  }
}`);

  writeFile('modules/user/public/schema/profile.yml', `name: profile
properties:
  - name: uuid
  - name: user_id
  - name: first_name
  - name: last_name
  - name: email
  - name: roles
    type: array`);

  // ── Empty module (no public dir) ─────────────────────────────────────────
  writeFile('modules/empty/template-values.json', JSON.stringify({
    name: 'Empty',
    machine_name: 'empty',
    type: 'module',
    version: '0.0.1',
    dependencies: {},
  }));
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('module-scanner', () => {
  describe('listModules', () => {
    it('lists all installed modules', async () => {
      const modules = await listModules(tmpDir);
      const names = modules.map(m => m.name);
      expect(names).toContain('core');
      expect(names).toContain('user');
      expect(names).toContain('empty');
    });

    it('includes version and dependencies', async () => {
      const modules = await listModules(tmpDir);
      const core = modules.find(m => m.name === 'core');
      expect(core.version).toBe('1.5.5');
      expect(core.dependencies).toEqual({});

      const user = modules.find(m => m.name === 'user');
      expect(user.version).toBe('5.1.2');
      expect(user.dependencies.core).toBe('^1.5.0');
    });

    it('returns empty for non-existent project', async () => {
      const modules = await listModules('/tmp/nonexistent-project');
      expect(modules).toEqual([]);
    });
  });

  describe('scanModule — core', () => {
    let scan;

    beforeAll(async () => {
      scan = await scanModule(tmpDir, 'core');
    });

    it('returns metadata', () => {
      expect(scan.name).toBe('core');
      expect(scan.display_name).toBe('Pos Module Core');
      expect(scan.version).toBe('1.5.5');
      expect(scan.installed).toBe(true);
    });

    it('discovers commands with doc block params', () => {
      expect(scan.commands.length).toBeGreaterThanOrEqual(3);
      const build = scan.commands.find(c => c.name === 'commands/build');
      expect(build).toBeDefined();
      expect(build.call_path).toBe('modules/core/commands/build');
      expect(build.params).toBeDefined();
      expect(build.params.length).toBe(1);
      expect(build.params[0].name).toBe('object');
    });

    it('discovers commands with execute param', () => {
      const execute = scan.commands.find(c => c.name === 'commands/execute');
      expect(execute).toBeDefined();
      expect(execute.params.length).toBe(3);
      expect(execute.params[0].name).toBe('mutation_name');
    });

    it('discovers helpers with comment-style params', () => {
      const redirect = scan.helpers.find(h => h.name === 'helpers/redirect_to');
      expect(redirect).toBeDefined();
      expect(redirect.call_path).toBe('modules/core/helpers/redirect_to');
      expect(redirect.params).toBeDefined();
      expect(redirect.params.some(p => p.name === 'url')).toBe(true);
    });

    it('discovers validations', () => {
      expect(scan.validations.length).toBeGreaterThanOrEqual(3);
      const names = scan.validations.map(v => v.name);
      expect(names).toContain('validations/presence');
      expect(names).toContain('validations/email');
      expect(names).toContain('validations/numericality');
    });

    it('discovers events', () => {
      const publish = scan.events.find(e => e.name.includes('events/publish'));
      // May be classified as command or event depending on path
      const inCommands = scan.commands.find(c => c.name.includes('events/publish'));
      expect(publish || inCommands).toBeDefined();
    });

    it('discovers queries', () => {
      expect(scan.queries.length).toBeGreaterThanOrEqual(1);
    });

    it('parses schemas with properties', () => {
      expect(scan.schemas.length).toBe(1);
      const status = scan.schemas[0];
      expect(status.name).toBe('status');
      expect(status.properties.length).toBe(3);
      expect(status.properties[0]).toEqual({ name: 'name', type: 'string' });
      expect(status.properties[1]).toEqual({ name: 'timestamp', type: 'datetime' });
    });

    it('parses GraphQL operations', () => {
      expect(scan.graphql.length).toBe(2);
      const create = scan.graphql.find(g => g.name === 'records/create');
      expect(create.type).toBe('mutation');
      expect(create.args.length).toBe(2);
      expect(create.args[0].name).toBe('table');

      const session = scan.graphql.find(g => g.name === 'session/get');
      expect(session.type).toBe('query');
      expect(session.args[0].name).toBe('key');
    });

    it('scans translations', () => {
      expect(scan.translations.en).toBeDefined();
      expect(scan.translations.en.key_count).toBeGreaterThanOrEqual(3);
    });

    it('scans pages with slugs', () => {
      expect(scan.pages.length).toBe(1);
      expect(scan.pages[0].slug).toBe('_core/health');
    });
  });

  describe('scanModule — user', () => {
    let scan;

    beforeAll(async () => {
      scan = await scanModule(tmpDir, 'user');
    });

    it('returns dependencies', () => {
      expect(scan.dependencies.core).toBe('^1.5.0');
      expect(scan.dependencies['common-styling']).toBe('^1.11.0');
    });

    it('discovers queries with doc block params', () => {
      const find = scan.queries.find(q => q.name.includes('user/find'));
      expect(find).toBeDefined();
      expect(find.params.length).toBe(2);
      expect(find.params[0].name).toBe('id');
    });

    it('discovers helpers', () => {
      const auth = scan.helpers.find(h => h.name.includes('can_do_or_unauthorized'));
      expect(auth).toBeDefined();
      expect(auth.params.some(p => p.name === 'requester')).toBe(true);
    });

    it('detects command pattern', () => {
      const create = scan.commands.find(c => c.name.includes('user/create'));
      expect(create).toBeDefined();
      expect(create.pattern).toBe('multi-file (build/check/execute)');
    });

    it('discovers comment-style params in commands', () => {
      const create = scan.commands.find(c => c.name.includes('user/create'));
      expect(create.params).toBeDefined();
      expect(create.params.some(p => p.name === 'first_name')).toBe(true);
    });

    it('parses user schemas', () => {
      expect(scan.schemas.length).toBe(1);
      const profile = scan.schemas[0];
      expect(profile.name).toBe('profile');
      const roles = profile.properties.find(p => p.name === 'roles');
      expect(roles.type).toBe('array');
    });

    it('parses user graphql', () => {
      const find = scan.graphql.find(g => g.name === 'user/find');
      expect(find).toBeDefined();
      expect(find.type).toBe('query');
      expect(find.args.some(a => a.name === 'id')).toBe(true);
      expect(find.args.some(a => a.name === 'email')).toBe(true);
    });
  });

  describe('scanModule — missing module', () => {
    it('returns error for non-existent module', async () => {
      const scan = await scanModule(tmpDir, 'nonexistent');
      expect(scan.error).toContain('not found');
    });
  });

  describe('scanModule — empty module', () => {
    it('returns empty API surface for module without public dir', async () => {
      const scan = await scanModule(tmpDir, 'empty');
      expect(scan.name).toBe('empty');
      expect(scan.version).toBe('0.0.1');
      expect(scan.commands).toEqual([]);
      expect(scan.queries).toEqual([]);
      expect(scan.schemas).toEqual([]);
    });
  });
});
