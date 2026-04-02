import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describePosCli('Regression: root-index-missing-slug', () => {
  // Original failure: app/views/pages/index.html.liquid got false MissingSlug warning
  it('root index page should NOT get MissingSlug warning', async () => {
    const content = `---
layout: application
---
{% render 'home/hero' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/index.html.liquid',
      content,
      mode: 'full',
    });
    const allDiags = [...result.errors, ...result.warnings];
    const slugWarning = allDiags.find(d => d.check === 'pos-supervisor:MissingSlug');
    expect(slugWarning).toBeUndefined();
  });
});

describePosCli('Regression: slug-slash-warning', () => {
  // Original failure: slug: / warned "remove slash", no slug warned "MissingSlug"
  // Both cases should give consistent, correct guidance
  it('slug: / should get appropriate guidance', async () => {
    const content = `---
slug: /
layout: application
---
{% render 'home/hero' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/index.html.liquid',
      content,
      mode: 'full',
    });
    // Root index with slug: / is valid — should not produce MissingSlug
    const slugWarning = [...result.errors, ...result.warnings].find(d => d.check === 'pos-supervisor:MissingSlug');
    expect(slugWarning).toBeUndefined();
  });

  it('non-root page with no slug should get MissingSlug', async () => {
    const content = `---
layout: application
---
{% render 'about/content' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/about.html.liquid',
      content,
      mode: 'full',
    });
    const slugWarning = [...result.errors, ...result.warnings].find(d => d.check === 'pos-supervisor:MissingSlug');
    expect(slugWarning).toBeDefined();
  });
});

describePosCli('Regression: changes-as-string', () => {
  // Original failure: Agent submitted changes as JSON string, got schema_error
  it('validate_intent coerces JSON string changes to array', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Test coercion from string',
        changes: JSON.stringify([
          {
            path: 'app/views/partials/test_coercion.liquid',
            role: 'partial',
            action: 'create',
          },
        ]),
      },
    });
    // Should not fail with schema_error — coerceIntent should recover
    const schemaErrors = (result.errors ?? []).filter(e => e.type === 'schema_error');
    expect(schemaErrors).toHaveLength(0);
  });
});

describePosCli('Regression: module-override-role', () => {
  // Original failure: app/modules/user/public/lib/queries/... failed domain check with role 'lib'
  // Module override paths (under app/modules/) with role 'module_override' should validate correctly
  it('app/modules override path with module_override role validates', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Override module query',
        changes: [
          {
            path: 'app/modules/user/public/views/partials/lib/helpers/custom.liquid',
            role: 'module_override',
            action: 'create',
          },
        ],
      },
    });
    // module_override paths under app/modules/<name>/public/ should pass
    const pathErrors = (result.errors ?? []).filter(e => e.type === 'invalid_path_for_role');
    expect(pathErrors).toHaveLength(0);
  });

  it('rejects bare modules/ path (third-party, write-protected)', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Try to write to third-party module',
        changes: [
          {
            path: 'modules/user/public/views/partials/lib/helpers/custom.liquid',
            role: 'partial',
            action: 'create',
          },
        ],
      },
    });
    // Third-party module paths should fail
    expect(result.ok).toBe(false);
  });
});

describePosCli('Regression: stale-index-false-positive', () => {
  // Original failure: Agent got update_target_missing on a file that existed on disk
  it('update action on existing file should not produce update_target_missing error', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Update existing page',
        changes: [
          {
            path: 'app/views/pages/blog_posts/index.html.liquid',
            role: 'page',
            action: 'update',
            references: { partials: ['blog_posts/list'] },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    const targetErrors = (result.errors ?? []).filter(e => e.type === 'update_target_missing');
    expect(targetErrors).toHaveLength(0);
  });
});

describePosCli('Regression: module-graphql-rejected', () => {
  // Original failure: modules/user/user/search rejected as missing_graphql
  it('module graphql reference for installed module should be accepted', async () => {
    const result = await server.callTool('validate_intent', {
      intent: {
        goal: 'Use user module graphql',
        changes: [
          {
            path: 'app/lib/queries/users/search.liquid',
            role: 'query',
            action: 'create',
            references: { graphql: ['modules/user/user/search'] },
          },
        ],
      },
    });
    // Should not reject installed module's graphql
    const gqlErrors = (result.errors ?? []).filter(e => e.type === 'missing_graphql');
    expect(gqlErrors).toHaveLength(0);
  });
});
