/**
 * Regression test for the `app/lib/lib/...` phantom-path bug in
 * analyze_project (2026-04-26).
 *
 * Cause: `src/tools/analyze-project.js` previously joined function-call
 * paths as `app/lib/${fc.path}.liquid` without stripping an optional
 * leading `lib/`. In platformOS, both `{% function = 'commands/X' %}` and
 * `{% function = 'lib/commands/X' %}` are valid call forms — they both
 * resolve to `app/lib/commands/X.liquid`. The naive join produced
 * `app/lib/lib/commands/X.liquid` and then complained that the phantom
 * file did not exist.
 *
 * Fix: `analyze-project.js` now strips the optional `lib/` prefix before
 * joining, mirroring the resolution in `error-enricher.js` /
 * `core/rules/queries.js` / `fix-generator.js` /
 * `core/diagnostic-pipeline.js`.
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, FIXTURE_DIR, createTempProject } from './helpers/server.js';

setDefaultTimeout(60_000);

let server;
let proj;

beforeAll(async () => {
  proj = createTempProject(FIXTURE_DIR);

  // Create a real command + a build phase that the page calls under both
  // call-form shapes. Both should resolve to the SAME file on disk.
  const cmdDir = join(proj.dir, 'app/lib/commands/contacts/create');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(
    join(proj.dir, 'app/lib/commands/contacts/create.liquid'),
    [
      '{% doc %}',
      '  @param object {object} - input contact',
      '{% enddoc %}',
      '{% liquid',
      "  function object = 'commands/contacts/create/build', object: object",
      "  function object = 'lib/commands/contacts/create/build', object: object",
      '  return object',
      '%}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(cmdDir, 'build.liquid'),
    "{% doc %}\n  @param object {object}\n{% enddoc %}\n{% return object %}\n",
    'utf8',
  );

  // Page that calls a command which DOES NOT exist on disk — exercises the
  // false-negative guard (genuine miss must still be flagged).
  mkdirSync(join(proj.dir, 'app/views/pages/contacts'), { recursive: true });
  writeFileSync(
    join(proj.dir, 'app/views/pages/contacts/test_miss.html.liquid'),
    [
      '---',
      'slug: contacts/test-miss',
      '---',
      '{% liquid',
      "  function r = 'commands/contacts/never_written', object: context.params",
      '%}',
      '',
    ].join('\n'),
    'utf8',
  );

  server = await startServer(proj.dir);
});

afterAll(() => {
  server?.stop();
  proj?.cleanup();
});

describe("analyze_project — function-call resolution doesn't double the lib/ prefix", () => {
  it('does NOT emit missing_command for `lib/commands/X` when the file exists at app/lib/commands/X.liquid', async () => {
    const result = await server.callTool('analyze_project', {});
    const phantom = result.integrity.filter(i =>
      i.type === 'missing_command' &&
      // Phantom path would carry double `lib/lib/`.
      (/app\/lib\/lib\//.test(i.target ?? '') || /app\/lib\/lib\//.test(i.message ?? ''))
    );
    if (phantom.length > 0) {
      console.log('Phantom missing_command issues:', phantom);
    }
    expect(phantom).toHaveLength(0);
  });

  it('also does not flag the bare `commands/X` form when the file exists', async () => {
    const result = await server.callTool('analyze_project', {});
    const flagged = result.integrity.filter(i =>
      i.type === 'missing_command' &&
      (i.message ?? '').includes("'commands/contacts/create/build'")
    );
    expect(flagged).toHaveLength(0);
  });

  it('still flags genuinely missing commands (no false negative)', async () => {
    const result = await server.callTool('analyze_project', {});
    const miss = result.integrity.filter(i =>
      i.type === 'missing_command' &&
      (i.message ?? '').includes('commands/contacts/never_written')
    );
    expect(miss.length).toBeGreaterThan(0);
    // The reported target path uses the canonical resolution (single lib/).
    expect(miss[0].target).toBe('app/lib/commands/contacts/never_written.liquid');
  });
});
