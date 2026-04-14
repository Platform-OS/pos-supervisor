/**
 * module_info live-scan contract tests.
 *
 * Pins the roadmap-finding F-007 / F-008 behaviors:
 *   - module_info(name, api) returns scan-derived API, not stale markdown
 *   - validations / events / hooks carry call_syntax when scanned
 *   - common-styling exposes css_classes from disk
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { moduleInfoTool } from '../../src/tools/module-info.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

let projectDir, ctx, handler;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'module-info-'));
  ctx = { directory: projectDir, version: 'test' };
  handler = moduleInfoTool.createHandler(ctx);
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

function write(relPath, content) {
  const abs = join(projectDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('module_info(section: api): returns live-scan API as primary payload', () => {
  it('includes call_syntax on helpers', async () => {
    write('modules/user/public/lib/helpers/can_do_or_unauthorized.liquid', `{% doc %}
  @param do {String} - action to authorize
  @param requester {Object} - the user requesting

  @example
  {% function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: context.current_user, do: 'edit' %}
{% enddoc %}
`);

    const result = await handler({ name: 'user', section: 'api' });
    expect(result.section).toBe('api');
    expect(result.api.helpers).toHaveLength(1);

    const h = result.api.helpers[0];
    expect(h.call_syntax).toContain("'modules/user/helpers/can_do_or_unauthorized'");
    expect(h.call_syntax).toContain('context.current_user');
    expect(h.required_params).toContain('do');
    expect(h.required_params).toContain('requester');
  });

  it('emits {% function %} (not {% include %}) as the canonical helper call form (F-007)', async () => {
    write('modules/user/public/lib/helpers/can_do_or_unauthorized.liquid', `{% doc %}
  @param do {String}
  @param requester {Object}
{% enddoc %}
`);

    const result = await handler({ name: 'user', section: 'api' });
    const helper = result.api.helpers[0];
    // The call_syntax for a helper MUST use {% function %}, never the deprecated {% include %}.
    // This is the scan-derived source of truth — additional_notes may contain prose that
    // mentions {% include %} as a forbidden form, so we assert on call_syntax specifically.
    expect(helper.call_syntax).toContain('{% function');
    expect(helper.call_syntax).not.toContain('{% include');
    expect(helper.required_params).toContain('do');
    expect(helper.required_params).toContain('requester');
  });

  it('surfaces validations with call_syntax (regression — they used to be stripped)', async () => {
    write('modules/core/public/lib/validations/presence.liquid', `{% doc %}
  @param field_name {String} - name of the field
  @param value {String} - field value
{% enddoc %}
`);

    const result = await handler({ name: 'core', section: 'api' });
    expect(result.api.validations).toHaveLength(1);
    const v = result.api.validations[0];
    expect(v.call_syntax).toBeTruthy();
    expect(v.required_params).toContain('field_name');
    expect(v.required_params).toContain('value');
  });

  it('surfaces css_classes for common-styling (F-008)', async () => {
    write('modules/common-styling/public/assets/css/grid.css', `
.feature-grid { display: grid; }
.card { padding: 1rem; }
.pos-heading-1 { font-size: 2rem; }
`);
    // No lib/ → scanPublicApi goes through fallback path, no partials, that's fine.

    const result = await handler({ name: 'common-styling', section: 'api' });
    expect(result.css_classes).toBeTruthy();
    expect(result.css_classes).toContain('feature-grid');
    expect(result.css_classes).toContain('card');
    expect(result.css_classes).toContain('pos-heading-1');
  });

  it('appends additional_notes from curated markdown when available', async () => {
    // We can't seed the src/data/references path from here, but we can at least
    // assert the shape: when api.md is absent for a synthetic module, there is
    // no additional_notes field. This pins the negative case.
    write('modules/synthetic/public/lib/helpers/noop.liquid', '{% doc %}{% enddoc %}\n');

    const result = await handler({ name: 'synthetic', section: 'api' });
    expect('additional_notes' in result).toBe(false);
  });
});

describe('module_info(section: overview): uniform formatApiEntry for all categories', () => {
  it('surfaces call_syntax for hooks and events, not just helpers', async () => {
    write('modules/test/public/lib/events/user_created.liquid', `{% doc %}
  @param user_id {String} - the new user's id
{% enddoc %}
`);
    write('modules/test/public/lib/hooks/after_save.liquid', `{% doc %}
  @param record {Object}
{% enddoc %}
`);

    const result = await handler({ name: 'test', section: 'overview' });
    expect(result.api.events).toHaveLength(1);
    expect(result.api.hooks).toHaveLength(1);
    expect(result.api.events[0].call_syntax).toBeTruthy();
    expect(result.api.hooks[0].call_syntax).toBeTruthy();
    expect(result.api.events[0].required_params).toEqual(['user_id']);
  });
});
