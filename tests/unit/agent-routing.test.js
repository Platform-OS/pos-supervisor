/**
 * Phase 1.2b regression tests — structured agent routing.
 *
 * Three contracts:
 *   1. scaffold emits consult_before_writing for every type/property combination
 *   2. error-enricher attaches see_also to diagnostics the plan maps
 *   3. server_status exposes domain_guides + development_guide tip + session_pending
 *
 * Every assertion here corresponds to a roadmap F-number or a Phase 1.2b rule.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { attachSeeAlso } from '../../src/core/error-enricher.js';
import { generateScaffold } from '../../src/core/scaffold-generator.js';
import { serverStatusTool } from '../../src/tools/server-status.js';

// ── Fixture project helper ───────────────────────────────────────────────────

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'agent-routing-'));
  mkdirSync(join(projectDir, 'app', 'schema'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'views', 'pages'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'views', 'partials'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'lib', 'commands'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'lib', 'queries'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'graphql'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'translations'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'config.yml'), 'escape_output_instead_of_sanitize: true\n');
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

// ── 1. scaffold consult_before_writing ───────────────────────────────────────

describe('scaffold: consult_before_writing field (F-017)', () => {
  it('emits schema/graphql/commands/queries/pages/partials/forms/translations for crud with no auth', async () => {
    const result = await generateScaffold({
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }, { name: 'body', type: 'text' }],
      write: false,
    }, projectDir);

    expect(Array.isArray(result.consult_before_writing)).toBe(true);
    const domains = result.consult_before_writing.map(c => c.domain);

    // Every crud-essential domain must be listed.
    expect(domains).toContain('schema');
    expect(domains).toContain('graphql');
    expect(domains).toContain('commands');
    expect(domains).toContain('queries');
    expect(domains).toContain('pages');
    expect(domains).toContain('partials');
    expect(domains).toContain('forms');
    expect(domains).toContain('translations');

    // authentication MUST NOT appear when no auth-role field exists.
    expect(domains).not.toContain('authentication');

    // Each entry MUST carry call + reason fields — agents act on structure, not prose.
    for (const entry of result.consult_before_writing) {
      expect(entry.call).toMatch(/^domain_guide\(domain: '[^']+'\)$/);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('adds authentication when a property has role:auth', async () => {
    const result = await generateScaffold({
      type: 'crud',
      name: 'blog_post',
      properties: [
        { name: 'title', type: 'string' },
        { name: 'author_id', type: 'integer', role: 'auth' },
      ],
      write: false,
    }, projectDir);

    const domains = result.consult_before_writing.map(c => c.domain);
    expect(domains).toContain('authentication');
    // And still includes everything the plain crud case did.
    expect(domains).toContain('partials');
    expect(domains).toContain('forms');
  });

  it('omits translations when include_translations:false', async () => {
    const result = await generateScaffold({
      type: 'crud',
      name: 'widget',
      properties: [{ name: 'title', type: 'string' }],
      include_translations: false,
      write: false,
    }, projectDir);

    const domains = result.consult_before_writing.map(c => c.domain);
    expect(domains).not.toContain('translations');
  });

  it('narrow type (command) lists only commands', async () => {
    const result = await generateScaffold({
      type: 'command',
      name: 'archive',
      properties: [{ name: 'id', type: 'string' }],
      write: false,
    }, projectDir);

    const domains = result.consult_before_writing.map(c => c.domain);
    expect(domains).toContain('commands');
    expect(domains).not.toContain('pages');
    expect(domains).not.toContain('partials');
    // A command without include_translations disabled defaults to true but
    // translations are only added for crud/api types that emit translation files.
    // The rule is "add translations when include_translations && type !== partial && type !== page".
    // Since command doesn't emit translations, the domain is also added as a "know the conventions" heads-up.
    // This matches buildConsultList behavior — document the expectation here.
  });

  it('api type includes backend domains but NOT view domains', async () => {
    const result = await generateScaffold({
      type: 'api',
      name: 'widget',
      properties: [{ name: 'name', type: 'string' }],
      write: false,
    }, projectDir);

    const domains = result.consult_before_writing.map(c => c.domain);
    expect(domains).toContain('schema');
    expect(domains).toContain('graphql');
    expect(domains).toContain('commands');
    expect(domains).toContain('queries');
    // api type intentionally has no pages/partials/forms.
    expect(domains).not.toContain('pages');
    expect(domains).not.toContain('partials');
    expect(domains).not.toContain('forms');
  });
});

// ── 2. error-enricher attachSeeAlso ──────────────────────────────────────────

describe('error-enricher: see_also routing (roadmap Fix 3)', () => {
  it('routes UndefinedObject with Shopify suggestion to partials gotchas', () => {
    const diag = {
      check: 'UndefinedObject',
      suggestion: '`product` is a Shopify theme object — not in platformOS.',
      message: 'Undefined object `product`',
    };
    attachSeeAlso(diag);
    expect(diag.see_also).toBeTruthy();
    expect(diag.see_also.tool).toBe('domain_guide');
    expect(diag.see_also.args.domain).toBe('partials');
    expect(diag.see_also.args.section).toBe('gotchas');
    expect(diag.see_also.reason).toMatch(/Shopify|context/);
  });

  it('routes DeprecatedTag {% include %} to partials gotchas', () => {
    const diag = {
      check: 'DeprecatedTag',
      message: "'{% include %}' is deprecated",
    };
    attachSeeAlso(diag);
    expect(diag.see_also.tool).toBe('domain_guide');
    expect(diag.see_also.args.domain).toBe('partials');
  });

  it('routes MissingPartial on a modules/ path to module_info', () => {
    const diag = {
      check: 'MissingPartial',
      message: "Partial 'modules/user/helpers/can_do_or_unauthorized' not found",
    };
    attachSeeAlso(diag);
    expect(diag.see_also.tool).toBe('module_info');
    expect(diag.see_also.args.name).toBe('user');
    expect(diag.see_also.args.section).toBe('api');
  });

  it('does NOT route MissingPartial on a non-module path (agent has project_map)', () => {
    const diag = {
      check: 'MissingPartial',
      message: "Partial 'blog_posts/form' not found",
    };
    attachSeeAlso(diag);
    expect(diag.see_also).toBeUndefined();
  });

  it('routes MetadataParamsCheck on a forms/ partial to forms api', () => {
    const diag = {
      check: 'MetadataParamsCheck',
      message: 'Required parameter name must be passed',
    };
    attachSeeAlso(diag, "{% render 'modules/common-styling/forms/error_list' %}");
    expect(diag.see_also.tool).toBe('domain_guide');
    expect(diag.see_also.args.domain).toBe('forms');
  });

  it('routes MetadataParamsCheck on a non-forms partial to partials api', () => {
    const diag = {
      check: 'MetadataParamsCheck',
      message: 'Required parameter title must be passed',
    };
    attachSeeAlso(diag, "{% render 'blog_posts/card' %}");
    expect(diag.see_also.tool).toBe('domain_guide');
    expect(diag.see_also.args.domain).toBe('partials');
  });

  it('routes TranslationKeyExists to translations gotchas', () => {
    const diag = {
      check: 'TranslationKeyExists',
      message: "Translation key 'app.blog_posts.list.title' does not exist",
    };
    attachSeeAlso(diag);
    expect(diag.see_also.tool).toBe('domain_guide');
    expect(diag.see_also.args.domain).toBe('translations');
  });

  it('routes HardcodedRoutes on auth URLs to authentication patterns', () => {
    const diag = {
      check: 'HardcodedRoutes',
      message: 'Hardcoded route /sessions detected',
    };
    attachSeeAlso(diag);
    expect(diag.see_also.args.domain).toBe('authentication');
    expect(diag.see_also.reason).toMatch(/\/sessions\/new/);
  });

  it('routes HardcodedRoutes on generic URLs to routing patterns', () => {
    const diag = {
      check: 'HardcodedRoutes',
      message: 'Hardcoded route /dashboard detected',
    };
    attachSeeAlso(diag);
    expect(diag.see_also.args.domain).toBe('routing');
  });

  it('does not overwrite an existing see_also', () => {
    const diag = {
      check: 'UndefinedObject',
      suggestion: '`product` is a Shopify object',
      see_also: { tool: 'preset', args: {}, reason: 'already set' },
    };
    attachSeeAlso(diag);
    expect(diag.see_also.tool).toBe('preset');
  });
});

// ── 3. server_status domain_guides + development_guide tip ───────────────────

describe('server_status: domain routing + development guide tip', () => {
  function makeCtx() {
    return {
      version: 'test',
      directory: projectDir,
      session: {
        fileHistory: new Map(),
        validatedPlan: null,
        pending: { files: new Set(), translations: new Set(), pages: new Set(), planId: null, validatedAt: null },
      },
      posCliFound: false,
      checkCmd: 'pos-cli',
      schemaIndex: { _loaded: true },
      objectsIndex: { _loaded: true },
      filtersIndex: { _loaded: true },
      tagsIndex: { _loaded: true },
    };
  }

  it('lists every domain_guide domain the server can serve', async () => {
    const result = await serverStatusTool.createHandler(makeCtx())();
    expect(Array.isArray(result.domain_guides)).toBe(true);
    // Core domains MUST always be present.
    expect(result.domain_guides).toContain('pages');
    expect(result.domain_guides).toContain('partials');
    expect(result.domain_guides).toContain('graphql');
    expect(result.domain_guides).toContain('authentication');
    expect(result.domain_guides).toContain('forms');
    expect(result.domain_guides).toContain('translations');
  });

  it('surfaces the development guide call + must-call timing', async () => {
    const result = await serverStatusTool.createHandler(makeCtx())();
    expect(result.development_guide).toBeTruthy();
    expect(result.development_guide.call).toBe('load_development_guide');
    expect(result.development_guide.must_call_at).toBe('session_start');
  });

  it('surfaces the MUST-call tip prominently', async () => {
    const result = await serverStatusTool.createHandler(makeCtx())();
    expect(result.tip).toMatch(/MUST call/);
    expect(result.tip).toMatch(/load_development_guide/);
    expect(result.tip).toMatch(/domain_guide/);
  });

  it('surfaces session_pending state (from Phase 0.1+0.2)', async () => {
    const ctx = makeCtx();
    ctx.session.pending.files.add('app/views/partials/foo.liquid');
    ctx.session.pending.translations.add('app.foo.bar');
    ctx.session.pending.planId = 'abc123';

    const result = await serverStatusTool.createHandler(ctx)();
    expect(result.session_pending.files).toContain('app/views/partials/foo.liquid');
    expect(result.session_pending.translations).toContain('app.foo.bar');
    expect(result.session_pending.plan_id).toBe('abc123');
  });
});
