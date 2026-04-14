/**
 * module-scanner live-scan tests.
 *
 * Builds throwaway fixture modules that embed doc blocks, @example tags,
 * @return, and CSS assets — then asserts the scan output reflects every
 * field. The scan layer is authoritative; rotting here is a regression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanModule } from '../../src/core/module-scanner.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'module-scanner-'));
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

function writeModuleFile(relPath, content) {
  const abs = join(projectDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('module-scanner: doc-block parsing', () => {
  it('extracts required and optional params from @param [name] form', async () => {
    writeModuleFile('modules/test/public/lib/helpers/greet.liquid', `{% doc %}
  Say hi.

  @param name {String} - recipient name
  @param [prefix] {String} - optional greeting prefix
{% enddoc %}

{% liquid
  assign prefix = prefix | default: 'Hello'
  echo prefix
  echo ', '
  echo name
  echo '!'
%}
`);

    const result = await scanModule(projectDir, 'test');
    expect(result.helpers).toHaveLength(1);
    const helper = result.helpers[0];
    // Names retain the category prefix as stored in lib/ — helpers/greet, not greet.
    expect(helper.name).toBe('helpers/greet');
    expect(helper.required_params).toEqual(['name']);
    expect(helper.optional_params).toEqual(['prefix']);
  });

  it('infers optionality from | default: in the body even when @param is unbracketed', async () => {
    writeModuleFile('modules/test/public/lib/helpers/greet.liquid', `{% doc %}
  @param name {String} - recipient
  @param prefix {String} - greeting prefix
{% enddoc %}
{% assign prefix = prefix | default: 'Hello' %}
{{ prefix }}, {{ name }}!
`);

    const result = await scanModule(projectDir, 'test');
    const helper = result.helpers[0];
    expect(helper.required_params).toEqual(['name']);
    expect(helper.optional_params).toEqual(['prefix']);
  });

  it('uses @example verbatim when present', async () => {
    writeModuleFile('modules/test/public/lib/helpers/can_do.liquid', `{% doc %}
  @param requester {Object} - the user
  @param do {String} - action

  @example
  {% function allowed = 'modules/test/helpers/can_do', requester: context.current_user, do: 'read' %}
{% enddoc %}
`);

    const result = await scanModule(projectDir, 'test');
    const helper = result.helpers[0];
    expect(helper.call_syntax).toContain("'modules/test/helpers/can_do'");
    expect(helper.call_syntax).toContain('context.current_user');
    expect(helper.call_syntax).toContain("do: 'read'");
  });

  it('generates call_syntax from params when no @example is present', async () => {
    writeModuleFile('modules/test/public/lib/queries/find.liquid', `{% doc %}
  @param id {String} - record id
{% enddoc %}
{% graphql result = 'find', id: id %}
{{ result }}
`);

    const result = await scanModule(projectDir, 'test');
    const q = result.queries[0];
    expect(q.call_syntax).toMatch(/{% function result = 'modules\/test\/queries\/find'/);
    expect(q.call_syntax).toContain("id:");
  });

  it('extracts @return with type and description', async () => {
    writeModuleFile('modules/test/public/lib/helpers/count.liquid', `{% doc %}
  @param list {Array} - the list

  @return {Int} - number of items
{% enddoc %}
{{ list | size }}
`);

    const result = await scanModule(projectDir, 'test');
    expect(result.helpers[0].returns).toBe('{Int} number of items');
  });

  it('classifies lib/commands vs lib/queries vs lib/helpers vs lib/validations', async () => {
    writeModuleFile('modules/test/public/lib/commands/create.liquid',      '{% doc %}{% enddoc %}\n');
    writeModuleFile('modules/test/public/lib/queries/search.liquid',       '{% doc %}{% enddoc %}\n');
    writeModuleFile('modules/test/public/lib/helpers/format.liquid',       '{% doc %}{% enddoc %}\n');
    writeModuleFile('modules/test/public/lib/validations/presence.liquid', '{% doc %}{% enddoc %}\n');

    const result = await scanModule(projectDir, 'test');
    expect(result.commands.map(c => c.name)).toEqual(['commands/create']);
    expect(result.queries.map(c => c.name)).toEqual(['queries/search']);
    expect(result.helpers.map(c => c.name)).toEqual(['helpers/format']);
    expect(result.validations.map(c => c.name)).toEqual(['validations/presence']);
  });

  it('classifies fallback lib/ tree nested under views/partials/', async () => {
    // Some modules (the fixture `user` module) place helpers under
    // views/partials/lib/helpers/. The scanner must route these to helpers/.
    writeModuleFile('modules/test/public/views/partials/lib/helpers/can_do.liquid', `{% doc %}
  @param requester_id {String}
  @param action {String}
{% enddoc %}
`);

    const result = await scanModule(projectDir, 'test');
    // NOT in partials — must be routed to helpers by the fallback-path classifier.
    expect(result.helpers.some(h => h.name.endsWith('can_do'))).toBe(true);
    expect(result.partials.some(p => p.name.endsWith('can_do'))).toBe(false);
  });
});

describe('module-scanner: CSS class extraction', () => {
  it('reads css_classes.json manifest when present', async () => {
    writeModuleFile('modules/common-styling/public/css_classes.json', JSON.stringify([
      'feature-grid', 'card', 'pos-heading-1',
    ]));

    const result = await scanModule(projectDir, 'common-styling');
    expect(result.css_classes).toEqual(['card', 'feature-grid', 'pos-heading-1']);
  });

  it('falls back to regex-scanning .css assets when no manifest', async () => {
    writeModuleFile('modules/common-styling/public/assets/css/grid.css', `
.feature-grid { display: grid; }
.card { padding: 1rem; }
.card--highlighted { background: yellow; }
`);
    writeModuleFile('modules/common-styling/public/assets/css/headings.css', `
.pos-heading-1 { font-size: 2rem; }
.pos-heading-1__subtitle { font-size: 1rem; }
`);

    const result = await scanModule(projectDir, 'common-styling');
    expect(result.css_classes).toContain('feature-grid');
    expect(result.css_classes).toContain('card');
    expect(result.css_classes).toContain('card--highlighted');
    expect(result.css_classes).toContain('pos-heading-1');
    expect(result.css_classes).toContain('pos-heading-1__subtitle');
  });

  it('returns empty array when module has no CSS', async () => {
    writeModuleFile('modules/test/public/lib/helpers/noop.liquid', '{% doc %}{% enddoc %}\n');
    const result = await scanModule(projectDir, 'test');
    expect(result.css_classes).toEqual([]);
  });

  it('handles malformed css_classes.json gracefully', async () => {
    writeModuleFile('modules/common-styling/public/css_classes.json', '{ not valid json');
    writeModuleFile('modules/common-styling/public/assets/css/grid.css', '.recovered { color: red; }\n');

    const result = await scanModule(projectDir, 'common-styling');
    // Falls through to regex scan
    expect(result.css_classes).toContain('recovered');
  });
});
