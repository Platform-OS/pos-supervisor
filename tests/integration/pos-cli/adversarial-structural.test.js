import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describePosCli('Structural warnings — MissingSlug', () => {
  it('warns about missing slug on non-index page', async () => {
    const content = `---
layout: application
---
{{ context.page.metadata.title }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/blog_posts/about.html.liquid',
      content,
      mode: 'full',
    });
    // Non-index pages should get MissingSlug warning
    const allDiags = [...result.errors, ...result.warnings];
    const slugWarning = allDiags.find(d => d.check === 'pos-supervisor:MissingSlug');
    expect(slugWarning).toBeDefined();
  });

  it('does NOT warn about missing slug on root index page', async () => {
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

  it('does NOT warn about missing slug when slug is present', async () => {
    const content = `---
slug: about
layout: application
---
<p>About us</p>`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/about.html.liquid',
      content,
      mode: 'full',
    });
    const allDiags = [...result.errors, ...result.warnings];
    const slugWarning = allDiags.find(d => d.check === 'pos-supervisor:MissingSlug');
    expect(slugWarning).toBeUndefined();
  });
});

describePosCli('Structural warnings — HTML in pages', () => {
  it('warns when page contains HTML directly', async () => {
    const content = `---
slug: bad_page
---
<div class="container">
  <h1>Direct HTML in page</h1>
  <p>This should be in a partial</p>
</div>`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/bad_page.html.liquid',
      content,
      mode: 'full',
    });
    // Pages should use render, not contain HTML directly
    const allDiags = [...result.errors, ...result.warnings];
    const htmlWarning = allDiags.find(d => d.check === 'pos-supervisor:HtmlInPage');
    expect(htmlWarning).toBeDefined();
  });
});

describePosCli('Structural warnings — deprecated tags', () => {
  it('warns about parse_json tag usage', async () => {
    const content = `{% parse_json data %}
  {"key": "value"}
{% endparse_json %}
{{ data.key }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_deprecated.liquid',
      content,
      mode: 'full',
    });
    const allDiags = [...result.errors, ...result.warnings];
    // parse_json tag is deprecated
    const deprecatedWarning = allDiags.find(d =>
      d.check === 'pos-supervisor:DeprecatedTag' || d.check === 'DeprecatedTag' ||
      (d.message && d.message.includes('parse_json'))
    );
    expect(deprecatedWarning).toBeDefined();
  });
});

describePosCli('Structural warnings — GraphQL in partials', () => {
  it('warns when partial contains graphql tag', async () => {
    const content = `{% graphql g = 'products/search' %}
{% for item in g.records.results %}
  {{ item.id }}
{% endfor %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_gql_in_partial.liquid',
      content,
      mode: 'full',
    });
    // Partials should not contain graphql calls
    const allDiags = [...result.errors, ...result.warnings];
    const gqlWarning = allDiags.find(d => d.check === 'pos-supervisor:GraphqlInPartial');
    expect(gqlWarning).toBeDefined();
  });
});

describePosCli('Structural warnings — missing doc block', () => {
  it('warns when partial has no doc block', async () => {
    const content = `<div>{{ title }}</div>`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_no_doc.liquid',
      content,
      mode: 'full',
    });
    const allDiags = [...result.errors, ...result.warnings];
    const docWarning = allDiags.find(d => d.check === 'pos-supervisor:MissingDocBlock');
    expect(docWarning).toBeDefined();
  });
});

describePosCli('Structural warnings — invalid front matter', () => {
  it('warns about unknown front matter keys', async () => {
    const content = `---
slug: test
authorization_policies: admin
cache: true
title: Wrong Place
---
{% render 'test' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test_bad_fm.html.liquid',
      content,
      mode: 'full',
    });
    const allDiags = [...result.errors, ...result.warnings];
    const fmWarnings = allDiags.filter(d => d.check === 'pos-supervisor:InvalidFrontMatter');
    // authorization_policies, cache, and title are all invalid
    expect(fmWarnings.length).toBeGreaterThanOrEqual(2);
  });
});
