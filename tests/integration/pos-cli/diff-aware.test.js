import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

// ---------------------------------------------------------------------------
// Feature 6: Diff-aware mode — detect removed functionality
// ---------------------------------------------------------------------------

describePosCli('Diff-aware mode — RemovedRender', () => {
  it('warns when update removes a render call', async () => {
    // The fixture file app/views/partials/blog_posts/list.liquid renders 'blog_posts/card'.
    // Submit content that removes that render call.
    const newContent = `{% doc %}
  @param query {string} Optional search term
{% enddoc %}

{% liquid
  function items = 'queries/blog_posts/search', query: query
%}

{% for item in items.results %}
  <div>{{ item.id }}</div>
{% endfor %}`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog_posts/list.liquid',
      content: newContent,
      mode: 'full',
    });

    const removedRender = result.warnings.find(w =>
      w.check === 'pos-supervisor:RemovedRender'
    );
    expect(removedRender).toBeDefined();
    expect(removedRender.message).toContain('blog_posts/card');
  });
});

describePosCli('Diff-aware mode — RemovedParam', () => {
  it('warns when update removes a @param declaration', async () => {
    // The fixture file app/views/partials/blog_posts/list.liquid has @param query.
    // Submit content that removes that param.
    const newContent = `{% doc %}
{% enddoc %}

{% liquid
  function items = 'queries/blog_posts/search', query: 'default'
%}

{% for item in items.results %}
  {% render 'blog_posts/card', blog_post: item %}
{% endfor %}`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog_posts/list.liquid',
      content: newContent,
      mode: 'full',
    });

    const removedParam = result.warnings.find(w =>
      w.check === 'pos-supervisor:RemovedParam'
    );
    expect(removedParam).toBeDefined();
    expect(removedParam.message).toContain('query');
  });
});

describePosCli('Diff-aware mode — AddedParam', () => {
  it('warns when update adds a new @param and lists affected callers', async () => {
    // The fixture file app/views/partials/blog_posts/list.liquid has @param query.
    // Add a new @param "limit" — callers that don't pass it will break.
    // blog_posts/index.html.liquid renders this partial, so it should be listed.
    const newContent = `{% doc %}
  @param query {string} Optional search term
  @param limit {number} Max results to return
{% enddoc %}

{% liquid
  function items = 'queries/blog_posts/search', query: query
%}

{% for item in items.results %}
  {% render 'blog_posts/card', blog_post: item %}
{% endfor %}`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog_posts/list.liquid',
      content: newContent,
      mode: 'full',
    });

    const addedParam = result.warnings.find(w =>
      w.check === 'pos-supervisor:AddedParam'
    );
    expect(addedParam).toBeDefined();
    expect(addedParam.message).toContain('limit');
    expect(addedParam.message).toContain('blog_posts/index');
  });

  it('does not warn about added params for non-partial files', async () => {
    // Pages don't have callers — adding @param should not trigger AddedParam
    const newContent = `---
slug: test-page
---
{% doc %}
  @param new_thing {string} Something new
{% enddoc %}
<div>{{ new_thing }}</div>`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/blog_posts/index.html.liquid',
      content: newContent,
      mode: 'full',
    });

    const addedParam = result.warnings.find(w =>
      w.check === 'pos-supervisor:AddedParam'
    );
    expect(addedParam).toBeUndefined();
  });
});

describePosCli('Diff-aware mode — no warning when nothing removed', () => {
  it('does not warn when content preserves existing renders and params', async () => {
    // Read the original content and just add a comment — nothing removed
    const originalPath = join(FIXTURE_DIR, 'app/views/partials/blog_posts/list.liquid');
    const originalContent = readFileSync(originalPath, 'utf8');
    const newContent = originalContent + '\n{% comment %} Added a comment {% endcomment %}';

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog_posts/list.liquid',
      content: newContent,
      mode: 'full',
    });

    const removedWarnings = result.warnings.filter(w =>
      w.check === 'pos-supervisor:RemovedRender' ||
      w.check === 'pos-supervisor:RemovedGraphQL' ||
      w.check === 'pos-supervisor:RemovedParam'
    );
    expect(removedWarnings).toHaveLength(0);
  });
});
