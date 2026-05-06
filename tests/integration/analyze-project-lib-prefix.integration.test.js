/**
 * Regression test for the `lib/`-prefix correctness contract in
 * `analyze_project` (2026-04-29).
 *
 * History — the previous version of this test pinned the inverse claim:
 * that `'commands/X'` and `'lib/commands/X'` were both valid call forms.
 * That assumption was wrong. platformOS resolves `function` paths under
 * the partial search paths declared by `@platformos/platformos-common`:
 *
 *   FILE_TYPE_DIRS[Partial] = ['views/partials', 'lib']
 *
 * joined under `app/`. So `'commands/X'` is found at `app/lib/commands/X.liquid`
 * and `'lib/commands/X'` is searched at `app/lib/lib/commands/X.liquid` — a
 * directory that never exists in any sane project. Stripping the `lib/`
 * prefix in `analyze-project.js` silently suppressed real errors AND
 * matched the buggy stripping in `core/diagnostic-pipeline.js` /
 * `error-enricher.js` / `core/rules/queries.js` / `fix-generator.js`,
 * so the false assumption propagated end-to-end.
 *
 * The new contract:
 *   • `commands/X` (bare) is canonical; if the file exists, no issue.
 *   • `lib/commands/X` resolves to `app/lib/lib/commands/X.liquid`,
 *     which never exists, so analyze_project MUST flag it as a
 *     missing_command and surface the doubled `lib/lib/` path in the
 *     resolution string (so the agent sees what platformOS actually does).
 *   • A genuinely missing command (under the bare `commands/` form) is
 *     still reported with the canonical single-`lib/` resolution.
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

  // Real command + a build phase that the orchestrator calls under both
  // shapes. The bare `commands/...` call must resolve cleanly; the
  // `lib/commands/...` call must be flagged as wrong even though a file
  // with the lib/-stripped name exists on disk.
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

  // Page that calls a command which DOES NOT exist on disk — exercises
  // the canonical missing-command path (no `lib/` prefix involved).
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

describe("analyze_project — `lib/` prefix is invalid, never optional", () => {
  it('does NOT flag the bare `commands/X` form when the file exists at app/lib/commands/X.liquid', async () => {
    const result = await server.callTool('analyze_project', {});
    const flagged = result.integrity.filter(i =>
      i.type === 'missing_command' &&
      (i.message ?? '').includes("'commands/contacts/create/build'")
    );
    expect(flagged).toHaveLength(0);
  });

  it('FLAGS `lib/commands/X` as missing — the literal prefix expands to `app/lib/lib/...` and never resolves', async () => {
    const result = await server.callTool('analyze_project', {});
    const flagged = result.integrity.filter(i =>
      i.type === 'missing_command' &&
      (i.message ?? '').includes("'lib/commands/contacts/create/build'")
    );
    expect(flagged.length).toBeGreaterThan(0);
    // The reported target path shows the doubled `lib/` so the agent sees
    // exactly what platformOS would search at runtime.
    expect(flagged[0].target).toBe('app/lib/lib/commands/contacts/create/build.liquid');
    expect(flagged[0].message).toContain('app/lib/lib/commands/contacts/create/build.liquid');
  });

  it('still flags genuinely missing commands under the canonical (single-`lib/`) form', async () => {
    const result = await server.callTool('analyze_project', {});
    const miss = result.integrity.filter(i =>
      i.type === 'missing_command' &&
      (i.message ?? '').includes('commands/contacts/never_written')
    );
    expect(miss.length).toBeGreaterThan(0);
    expect(miss[0].target).toBe('app/lib/commands/contacts/never_written.liquid');
    // No accidental doubling on the canonical form
    expect(miss[0].target).not.toMatch(/app\/lib\/lib\//);
  });
});
