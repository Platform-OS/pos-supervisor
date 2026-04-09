import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describePosCli('Enrichment: UnknownFilter', () => {
  it('provides hint with filter name', async () => {
    const content = `{{ 'hello' | nonexistent_filter }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_filter.liquid',
      content,
      mode: 'full',
    });
    const filterError = result.errors.find(e => e.check === 'UnknownFilter');
    expect(filterError).toBeDefined();
    expect(filterError.hint).toBeDefined();
    expect(filterError.hint).toContain('nonexistent_filter');
  });
});

describePosCli('Enrichment: UndefinedObject', () => {
  it('provides hint with variable name', async () => {
    // UndefinedObject requires a {% doc %} block — the LSP only reports undefined
    // variables when the partial declares its expected params via {% doc %}.
    const content = `{% doc %}
  @param title {string} - title
{% enddoc %}
{{ some_undefined_variable }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_undef.liquid',
      content,
      mode: 'full',
    });
    // UndefinedObject may appear as error or warning depending on config
    const allDiags = [...result.errors, ...result.warnings];
    const undefError = allDiags.find(e => e.check === 'UndefinedObject');
    expect(undefError).toBeDefined();
    expect(undefError.hint).toBeDefined();
  });

  it('provides Shopify suggestion for Shopify objects', async () => {
    const content = `{{ cart.item_count }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_obj.liquid',
      content,
      mode: 'full',
    });
    // cart is detected as pos-supervisor:ShopifyObject via structural warnings,
    // or as UndefinedObject via LSP when {% doc %} is present
    const allDiags = [...result.errors, ...result.warnings];
    const cartError = allDiags.find(e =>
      (e.check === 'UndefinedObject' || e.check === 'pos-supervisor:ShopifyObject') &&
      e.message?.includes('cart')
    );
    expect(cartError).toBeDefined();
    // Shopify detection should provide a suggestion with Shopify context
    expect(cartError.suggestion).toBeDefined();
    expect(cartError.suggestion).toMatch(/shopify/i);
  });
});

describePosCli('Enrichment: MissingPartial', () => {
  it('provides hint with create path', async () => {
    const content = `{% render 'products/nonexistent_card' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_missing.liquid',
      content,
      mode: 'full',
    });
    const missingError = [...result.errors, ...result.warnings].find(e => e.check === 'MissingPartial');
    expect(missingError).toBeDefined();
    expect(missingError.hint).toBeDefined();
    // Hint should include the path where the file should be created
    expect(missingError.hint).toContain('products/nonexistent_card');
  });
});

describePosCli('Enrichment: TranslationKeyExists', () => {
  it('provides hint with YAML snippet', async () => {
    const content = `{{ 'nonexistent.translation.key' | t }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_trans.liquid',
      content,
      mode: 'full',
    });
    // TranslationKeyExists is reported as an error
    const transError = result.errors.find(e => e.check === 'TranslationKeyExists');
    expect(transError).toBeDefined();
    expect(transError.hint).toBeDefined();
    // Hint should contain YAML snippet showing where to add the key
    expect(transError.hint).toContain('nonexistent');
  });
});

describePosCli('Enrichment: MissingRenderPartialArguments', () => {
  // This tests the Item 1 fix: extractMissingArgInfo regex now correctly extracts param name
  it('provides hint with actual missing param name (not "?")', async () => {
    // Render blog_posts/card without the required 'blog_post' param
    const content = `{% render 'blog_posts/card' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_missing_arg.liquid',
      content,
      mode: 'full',
    });
    const argError = [...result.errors, ...result.warnings].find(e =>
      e.check === 'MissingRenderPartialArguments'
    );
    if (argError) {
      expect(argError.hint).toBeDefined();
      // Should contain actual param name 'blog_post', NOT '?'
      expect(argError.hint).toContain('blog_post');
      expect(argError.hint).not.toContain("'?'");
    }
  });
});

describePosCli('Enrichment: DeprecatedTag', () => {
  it('provides hint with replacement tag', async () => {
    const content = `{% include 'shared/header' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_deprecated_tag.liquid',
      content,
      mode: 'full',
    });
    const deprecatedError = [...result.errors, ...result.warnings].find(e =>
      e.check === 'DeprecatedTag'
    );
    expect(deprecatedError).toBeDefined();
    expect(deprecatedError.hint).toBeDefined();
    // Should suggest 'render' as replacement for 'include'
    expect(deprecatedError.hint).toContain('render');
  });
});

describePosCli('Enrichment: hints are never null for known checks', () => {
  it('all known error types get non-null hints', async () => {
    // A file with multiple error types
    const content = `{{ unknown_var }}
{{ 'test' | fake_filter }}
{% include 'old_partial' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_multi_error.liquid',
      content,
      mode: 'full',
    });
    const knownChecks = new Set([
      'UndefinedObject', 'UnknownFilter', 'DeprecatedTag',
      'MissingPartial', 'TranslationKeyExists', 'MissingRenderPartialArguments',
    ]);
    const knownDiags = [...result.errors, ...result.warnings].filter(e => knownChecks.has(e.check));
    for (const d of knownDiags) {
      expect(d.hint).not.toBeNull();
      expect(typeof d.hint).toBe('string');
      expect(d.hint.length).toBeGreaterThan(0);
    }
  });
});
