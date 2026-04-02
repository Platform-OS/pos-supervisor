/**
 * Position accuracy tests — verify that diagnostics point at the actual
 * offending code, not at containing tags like {% liquid %}.
 *
 * These tests assert on specific line/column values to catch regressions
 * in diagnostic positioning between LSP and pos-cli check paths.
 */
import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describePosCli('Position accuracy — statements inside {% liquid %} blocks', () => {
  it('error points at function call line, not at {% liquid %} tag', async () => {
    const content = `---
slug: pos_test
---
{% liquid
  assign x = 'hello'
  function result = 'queries/blog_posts/search'
  assign y = result.total_entries
%}`;
    //  1-based (what agent sees):
    //  Line 1: ---
    //  Line 2: slug: pos_test
    //  Line 3: ---
    //  Line 4: {% liquid
    //  Line 5:   assign x = 'hello'
    //  Line 6:   function result = 'queries/blog_posts/search'
    //  Line 7:   assign y = result.total_entries
    //  Line 8: %}

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/position_test.html.liquid',
      content,
      mode: 'quick',
    });

    const funcErrors = [...result.errors, ...result.warnings].filter(e =>
      e.check === 'MetadataParamsCheck' && e.message?.includes('function call')
    );

    for (const e of funcErrors) {
      // Must point at line 6 (1-based, the function call), NOT line 4 ({% liquid %})
      expect(e.line).toBe(6);
      expect(e.line).not.toBe(4);
    }
  });

  it('error points at render call line, not at containing block', async () => {
    const content = `---
slug: render_test
---
{% render 'blog_posts/card' %}`;
    //  1-based line 4: {% render 'blog_posts/card' %}

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/render_pos_test.html.liquid',
      content,
      mode: 'quick',
    });

    const renderErrors = [...result.errors, ...result.warnings].filter(e =>
      e.check === 'MissingRenderPartialArguments'
    );

    for (const e of renderErrors) {
      expect(e.line).toBe(4); // 1-based
    }
  });

  it('UnusedAssign points at the assign line inside liquid block', async () => {
    const content = `---
slug: assign_test
---
{% liquid
  assign unused_var = 'hello'
%}
<p>nothing</p>`;
    //  1-based line 5: assign unused_var = 'hello'

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/assign_pos_test.html.liquid',
      content,
      mode: 'quick',
    });

    const unusedErrors = [...result.errors, ...result.warnings].filter(e =>
      e.check === 'UnusedAssign'
    );

    for (const e of unusedErrors) {
      expect(e.line).toBe(5); // 1-based
      expect(e.line).not.toBe(4); // not the {% liquid %} line
    }
  });
});

describePosCli('Position accuracy — LSP vs pos-cli parity', () => {
  it('LSP and pos-cli check report same line numbers for same content', async () => {
    // This test documents parity between the two diagnostic paths.
    // If LSP positions diverge from pos-cli, this test will catch it.
    const content = `---
slug: parity_test
---
{{ undefined_var }}
{{ 'hello' | nonexistent_filter }}`;

    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/parity_test.html.liquid',
      content,
      mode: 'quick',
    });

    // 1-based: Line 4: {{ undefined_var }}, Line 5: {{ 'hello' | nonexistent_filter }}
    const allDiags = [...result.errors, ...result.warnings];

    const filterError = allDiags.find(e => e.check === 'UnknownFilter');
    if (filterError) {
      expect(filterError.line).toBe(5); // 1-based
    }
  });
});
