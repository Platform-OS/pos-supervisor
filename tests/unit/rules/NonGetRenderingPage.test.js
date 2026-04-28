// NonGetRenderingPage three-subrule routing — covers each path through
// `validatePageMethodAndForms` (structural-warnings.js) end-to-end into the
// rule engine. Test cases mirror the gist analysis at
// docs/rule-performance-plan.md / NonGetRenderingPageRule.md.

import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/NonGetRenderingPage.js';
import { generateStructuralWarnings } from '../../../src/core/structural-warnings.js';
import { parseLiquidFile, extractAllFromAST } from '../../../src/core/liquid-parser.js';

beforeEach(() => { clearRules(); registerRules(rules); });

function emit(file, content) {
  const ast = parseLiquidFile(content);
  const structural = extractAllFromAST(ast);
  const ws = generateStructuralWarnings(ast, content, file, structural, new Set(), {});
  return ws.filter(w => w.check === 'pos-supervisor:NonGetRenderingPage');
}

function route(diag) {
  return runRules({ ...diag }, {});
}

describe('NonGetRenderingPage.html_on_post', () => {
  test('non-API POST page with layout fires html_on_post', () => {
    const ws = emit('app/views/pages/contact.liquid',
      '---\nslug: contact\nmethod: post\nlayout: application\n---\n<h1>Contact</h1>');
    expect(ws).toHaveLength(1);
    const r = route(ws[0]);
    expect(r.rule_id).toBe('NonGetRenderingPage.html_on_post');
    expect(r.fixes[0].description).toContain('landing page');
    expect(r.fixes[0].description).toContain('API handler');
  });

  test('hint references both UI-page and API-handler shapes', () => {
    const ws = emit('app/views/pages/contact.liquid',
      '---\nslug: contact\nmethod: post\nlayout: application\n---\n<h1>x</h1>');
    const r = route(ws[0]);
    expect(r.hint_md).toContain('Landing / display page');
    expect(r.hint_md).toContain('Form-handling endpoint');
    expect(r.hint_md).toContain("action=\"/api/contacts/create\"");
  });

  test('non-API PUT/DELETE/PATCH pages with HTML also fire', () => {
    for (const method of ['put', 'delete', 'patch']) {
      const ws = emit('app/views/pages/x.liquid',
        `---\nslug: x\nmethod: ${method}\nlayout: application\n---\n<h1>x</h1>`);
      expect(ws).toHaveLength(1);
      const r = route(ws[0]);
      expect(r.rule_id).toBe('NonGetRenderingPage.html_on_post');
      expect(r.hint_md).toContain(`method: ${method}`);
    }
  });

  test('POST page with no HTML (redirect-only handler) does NOT fire', () => {
    const ws = emit('app/views/pages/contacts.liquid',
      '---\nslug: contacts\nmethod: post\n---\n{% graphql r = "contacts/create" %}');
    expect(ws).toEqual([]);
  });
});

describe('NonGetRenderingPage.api_renders_html', () => {
  test('API page with layout fires api_renders_html', () => {
    const ws = emit('app/views/pages/api/contacts/create.liquid',
      '---\nslug: api/contacts/create\nmethod: post\nlayout: application\n---\n<h1>Creating</h1>');
    expect(ws).toHaveLength(1);
    const r = route(ws[0]);
    expect(r.rule_id).toBe('NonGetRenderingPage.api_renders_html');
    expect(r.hint_md).toContain('format: json');
    expect(r.hint_md).toContain('result | json');
  });

  test('API page missing format:json fires even without HTML body', () => {
    const ws = emit('app/views/pages/api/contacts/create.liquid',
      '---\nslug: api/contacts/create\nmethod: post\n---\n{% graphql r = "contacts/create" %}\n{{ r | json }}');
    expect(ws).toHaveLength(1);
    const r = route(ws[0]);
    expect(r.rule_id).toBe('NonGetRenderingPage.api_renders_html');
    expect(r.hint_md).toContain('format: json');
  });

  test('valid API endpoint with format:json + json body emits NOTHING', () => {
    const ws = emit('app/views/pages/api/contacts/create.liquid',
      '---\nslug: api/contacts/create\nmethod: post\nformat: json\n---\n{% graphql r = "contacts/create" %}\n{{ r | json }}');
    expect(ws).toEqual([]);
  });

  test('/_/ and /internal/ prefixes are also API paths', () => {
    for (const prefix of ['_', 'internal']) {
      const ws = emit(`app/views/pages/${prefix}/x.liquid`,
        `---\nslug: ${prefix}/x\nmethod: post\nlayout: application\n---\n<h1>x</h1>`);
      expect(ws).toHaveLength(1);
      const r = route(ws[0]);
      expect(r.rule_id).toBe('NonGetRenderingPage.api_renders_html');
    }
  });

  test('extracted slug appears in hint canonical-shape example', () => {
    const ws = emit('app/views/pages/api/foo/bar.liquid',
      '---\nslug: api/foo/bar\nmethod: put\nlayout: application\n---\n<h1>x</h1>');
    const r = route(ws[0]);
    expect(r.hint_md).toContain('slug: api/foo/bar');
    expect(r.hint_md).toContain('method: put');
  });
});

describe('NonGetRenderingPage.get_form_target', () => {
  test('GET page with form to non-API path fires get_form_target', () => {
    const ws = emit('app/views/pages/index.liquid',
      '---\nslug: index\n---\n<form action="/contacts/create" method="post"></form>');
    expect(ws).toHaveLength(1);
    const r = route(ws[0]);
    expect(r.rule_id).toBe('NonGetRenderingPage.get_form_target');
    expect(r.hint_md).toContain('/api/contacts/create');
    expect(r.hint_md).toContain('app/views/pages/api/contacts/create.liquid');
  });

  test('form action under /api/ is sanctioned — no diagnostic', () => {
    const ws = emit('app/views/pages/index.liquid',
      '---\nslug: index\n---\n<form action="/api/contact" method="post"></form>');
    expect(ws).toEqual([]);
  });

  test('self-posting form (action == own slug) is sanctioned — no diagnostic', () => {
    const ws = emit('app/views/pages/contacts.liquid',
      '---\nslug: contacts\n---\n<form action="/contacts" method="post"></form>');
    expect(ws).toEqual([]);
  });

  test('GET form (method="get") is not flagged — no submission risk', () => {
    const ws = emit('app/views/pages/search.liquid',
      '---\nslug: search\n---\n<form action="/results" method="get"></form>');
    expect(ws).toEqual([]);
  });

  test('attribute order is irrelevant — action before method works', () => {
    const ws = emit('app/views/pages/index.liquid',
      '---\nslug: index\n---\n<form action="/contacts/create" id="x" method="post"></form>');
    expect(ws).toHaveLength(1);
    expect(route(ws[0]).rule_id).toBe('NonGetRenderingPage.get_form_target');
  });

  test('multiple forms — emits one diagnostic per offending form', () => {
    const ws = emit('app/views/pages/index.liquid',
      '---\nslug: index\n---\n<form action="/a" method="post"></form>\n<form action="/api/b" method="post"></form>\n<form action="/c" method="post"></form>');
    expect(ws).toHaveLength(2);
    const actions = ws.map(w => w.message.match(/posts to `([^`]+)`/)?.[1]);
    expect(actions).toEqual(['/a', '/c']);
  });

  test('form with single quotes parses correctly', () => {
    const ws = emit('app/views/pages/index.liquid',
      "---\nslug: index\n---\n<form action='/x' method='post'></form>");
    expect(ws).toHaveLength(1);
    expect(route(ws[0]).rule_id).toBe('NonGetRenderingPage.get_form_target');
  });
});

describe('NonGetRenderingPage default fallback', () => {
  test('unknown subtype message routes to default rule', () => {
    const r = runRules({
      check: 'pos-supervisor:NonGetRenderingPage',
      message: 'Some new diagnostic shape we have not seen',
    }, {});
    expect(r.rule_id).toBe('NonGetRenderingPage.default');
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe('NonGetRenderingPage — DEMO regression cases', () => {
  test('the original DEMO failure (POST landing page) now ships actionable fix', () => {
    // Pre-task-4 the rule was `NonGetRenderingPage.default` with `fixes: []`
    // and 25 outcomes (5 resolved / 15 unchanged / 5 regressed).
    const ws = emit('app/views/pages/contact.liquid',
      '---\nslug: contact\nmethod: post\nlayout: application\n---\n<h1>Contact</h1>\n<form>...</form>');
    expect(ws).toHaveLength(1);
    const r = route(ws[0]);
    expect(r.rule_id).toBe('NonGetRenderingPage.html_on_post');
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].type).toBe('guidance');
    // Hint disambiguates the two valid intents (landing vs API handler) so
    // the agent's loop-on-unchanged behaviour stops.
    expect(r.hint_md).toContain('Landing / display page');
    expect(r.hint_md).toContain('Form-handling endpoint');
  });
});
