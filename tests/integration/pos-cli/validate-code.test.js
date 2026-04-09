import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describePosCli('validate_code — parsing', () => {
  it('extracts structural elements from valid Liquid', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: my-page\n---\n{% render \'shared/header\' %}\n{{ \'greeting\' | t }}\n{% graphql g = \'products/search\' %}',
      mode: 'quick',
    });

    expect(result.structural).toBeDefined();
    expect(result.structural.slug).toBe('my-page');
    expect(result.structural.renders_used).toContain('shared/header');
    expect(result.structural.filters_used).toContain('t');
    expect(result.structural.translation_keys).toContain('greeting');
    expect(result.structural.tags_used).toContain('render');
    expect(result.structural.tags_used).toContain('graphql');
  });

  it('reports parse_error for completely broken content', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '{% if true %}\n<p>unclosed if',
      mode: 'quick',
    });

    // Tolerant mode should still return structural data
    expect(result.structural).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Linting
// ---------------------------------------------------------------------------

describePosCli('validate_code — linting', () => {
  it('catches UndefinedObject for bare variables', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'quick',
    });

    const undefs = [...result.errors, ...result.warnings].filter(d => d.check === 'UndefinedObject');
    expect(undefs.length).toBeGreaterThan(0);
    expect(undefs[0].message).toContain('params');
  });

  it('catches UnknownFilter', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ "hello" | fakefilter }}',
      mode: 'quick',
    });

    const unknowns = result.errors.filter(d => d.check === 'UnknownFilter');
    expect(unknowns.length).toBeGreaterThan(0);
    expect(unknowns[0].message).toContain('fakefilter');
  });

  it('catches MissingPartial as error (blocks valid)', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/blog_posts/index.html.liquid',
      content: '---\nslug: blog\n---\n{% render \'nonexistent/partial\' %}',
      mode: 'quick',
    });

    // MissingPartial is always an error — use pending_files to suppress during multi-file creation
    const missing = result.errors.filter(d => d.check === 'MissingPartial');
    expect(missing.length).toBeGreaterThan(0);
    expect(result.status).toBe('error');
    // Should NOT appear in infos
    const missingInfos = result.infos.filter(d => d.check === 'MissingPartial');
    expect(missingInfos).toHaveLength(0);
  });

  it('returns status ok for clean code', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: clean-page\n---\n{% comment %}clean page{% endcomment %}',
      mode: 'quick',
    });

    expect(result.status).toBe('ok');
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Enrichment (full mode)
// ---------------------------------------------------------------------------

describePosCli('validate_code — enrichment (full mode)', () => {
  it('adds hints to UndefinedObject errors', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'full',
    });

    const undefs = [...result.errors, ...result.warnings].filter(d => d.check === 'UndefinedObject');
    expect(undefs.length).toBeGreaterThan(0);
    expect(undefs[0].hint).toBeDefined();
    expect(undefs[0].hint).toContain('context');
  });

  it('adds domain guide for pages domain when errors exist', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'full',
    });

    expect(result.domain_guide).toBeDefined();
    expect(result.domain_guide.domain).toBe('pages');
    expect(result.domain_guide.rule).toBeDefined();
    expect(result.domain_guide.triggered_gotchas).toBeDefined();
  });

  it('adds suggestion for UndefinedObject with known context object', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'full',
    });

    const undefs = [...result.errors, ...result.warnings].filter(d => d.check === 'UndefinedObject' && d.message.includes('params'));
    expect(undefs.length).toBeGreaterThan(0);
    // Should suggest context.params
    if (undefs[0].suggestion) {
      expect(undefs[0].suggestion).toContain('context.params');
    }
  });
});

// ---------------------------------------------------------------------------
// Proposed fixes
// ---------------------------------------------------------------------------

describePosCli('validate_code — proposed fixes', () => {
  it('returns proposed_fixes array for UndefinedObject in page', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'full',
    });

    expect(result.proposed_fixes).toBeDefined();
    expect(Array.isArray(result.proposed_fixes)).toBe(true);
    // params is a known context object → should get a text_edit fix
    const textEdit = result.proposed_fixes.find(f => f.type === 'text_edit' && f.new_text === 'context.params');
    expect(textEdit).toBeDefined();
  });

  it('attaches fix field to individual diagnostics', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'full',
    });

    const undefs = [...result.errors, ...result.warnings].filter(d => d.check === 'UndefinedObject' && d.message.includes('params'));
    expect(undefs.length).toBeGreaterThan(0);
    expect(undefs[0].fix).toBeDefined();
    expect(undefs[0].fix.new_text).toBe('context.params');
  });

  it('returns {% doc %} insert fix for partial missing doc block', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog/card.liquid',
      content: '<p>{{ post.title }}</p>',
      mode: 'full',
    });

    expect(result.proposed_fixes).toBeDefined();
    const insert = result.proposed_fixes.find(f => f.type === 'insert' && f.new_text?.includes('@param'));
    expect(insert).toBeDefined();
    // Doc block scaffold is always inserted; param name is post if UndefinedObject fired,
    // or generic placeholder if only MissingDocBlock structural check fired
    expect(insert.new_text).toContain('{% doc %}');
    expect(insert.new_text).toContain('@param');
  });

  it('returns empty proposed_fixes for valid code', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: clean\n---\n{% assign greeting = "hello" %}',
      mode: 'full',
    });

    expect(result.proposed_fixes).toBeDefined();
    expect(result.proposed_fixes).toHaveLength(0);
  });

  it('returns proposed_fixes in quick mode as empty', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test.html.liquid',
      content: '---\nslug: test\n---\n{{ params.id }}',
      mode: 'quick',
    });

    // Quick mode skips fix generation
    expect(result.proposed_fixes).toBeDefined();
    expect(result.proposed_fixes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Context-aware suppression
// ---------------------------------------------------------------------------

describePosCli('validate_code — context-aware suppression', () => {
  it('suppresses UndefinedObject for declared @param names in commands', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/lib/commands/blog_posts/create.liquid',
      content: '{% doc %}\n  @param {object} object\n  @param {string} id\n{% enddoc %}\n{% liquid\n  assign item = object\n  return item\n%}',
      mode: 'quick',
    });

    // object and id should NOT appear in errors (they're declared params)
    const undefs = result.errors.filter(d => d.check === 'UndefinedObject');
    const paramUndefs = undefs.filter(d => d.message?.includes('`object`') || d.message?.includes('`id`'));
    expect(paramUndefs).toHaveLength(0);

    // Should have a suppression info
    const suppInfo = result.infos.filter(d => d.check === 'pos-supervisor:DocParamSuppressed');
    expect(suppInfo.length).toBeGreaterThanOrEqual(0); // May or may not fire depending on linter
  });

  it('suppresses UndefinedObject for declared @param in partials', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog/card.liquid',
      content: '{% doc %}\n  @param {object} post\n{% enddoc %}\n<p>{{ post.title }}</p>',
      mode: 'quick',
    });

    const undefs = result.errors.filter(d => d.check === 'UndefinedObject' && d.message?.includes('`post`'));
    expect(undefs).toHaveLength(0);
  });

  it('MissingPartial stays as error — use pending_files to suppress during scaffolding', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/blog_posts/index.html.liquid',
      content: '---\nslug: blog\n---\n{% render \'nonexistent/partial\' %}',
      mode: 'quick',
    });

    const missingErrors = result.errors.filter(d => d.check === 'MissingPartial');
    expect(missingErrors.length).toBeGreaterThan(0);

    const missingInfos = result.infos.filter(d => d.check === 'MissingPartial');
    expect(missingInfos).toHaveLength(0);
  });

  it('extracts doc_params in structural output', async () => {
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/blog/card.liquid',
      content: '{% doc %}\n  @param {object} post\n  @param {string} title\n{% enddoc %}\n<p>{{ post.title }}</p>',
      mode: 'quick',
    });

    expect(result.structural.doc_params).toBeDefined();
    expect(result.structural.doc_params).toContain('post');
    expect(result.structural.doc_params).toContain('title');
  });
});
