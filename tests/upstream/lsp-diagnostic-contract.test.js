/**
 * LSP diagnostic contract tests — pin the behavior of pos-cli LSP checks.
 *
 * These tests verify that the LSP reports specific diagnostics for known inputs.
 * When upstream changes check behavior (like UndefinedObject requiring {% doc %}),
 * these tests catch it immediately.
 *
 * Each test documents WHY we depend on the behavior (the enrichment, suppression,
 * or pipeline logic that relies on it).
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from '../integration/pos-cli/guard.js';
import { startServer, FIXTURE_DIR } from '../integration/helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

/**
 * Helper: call validate_code and return only LSP-originated diagnostics
 * (excludes pos-supervisor: structural warnings).
 */
async function getLspDiags(filePath, content, mode = 'full') {
  const result = await server.callTool('validate_code', { file_path: filePath, content, mode });
  const lspErrors = result.errors.filter(d => !d.check.startsWith('pos-supervisor:'));
  const lspWarnings = result.warnings.filter(d => !d.check.startsWith('pos-supervisor:'));
  const lspInfos = (result.infos ?? []).filter(d => !d.check.startsWith('pos-supervisor:'));
  return { errors: lspErrors, warnings: lspWarnings, infos: lspInfos, all: [...lspErrors, ...lspWarnings, ...lspInfos], raw: result };
}

// ── Check behavior contracts ───────────────────────────────────────────────

describePosCli('LSP contract: UnknownFilter', () => {
  it('fires for nonexistent filters', async () => {
    // Dependency: error-enricher.js extractFilterName() parses filter name from this diagnostic
    const { all } = await getLspDiags(
      'app/views/partials/contract_filter.liquid',
      '{{ "hello" | totally_nonexistent_filter }}',
    );
    const check = all.find(d => d.check === 'UnknownFilter');
    expect(check).toBeDefined();
  });

  it('message contains filter name in quotes', async () => {
    // Dependency: extractFilterName() regex /`([^`]+)`/ or /"([^"]+)"/ or /'([^']+)'/
    const { all } = await getLspDiags(
      'app/views/partials/contract_filter_msg.liquid',
      '{{ "x" | bogus_filter_name }}',
    );
    const check = all.find(d => d.check === 'UnknownFilter');
    expect(check).toBeDefined();
    expect(check.message).toMatch(/['"`]bogus_filter_name['"`]/);
  });

  it('does NOT fire for valid platformOS filters', async () => {
    const { all } = await getLspDiags(
      'app/views/partials/contract_filter_valid.liquid',
      '{{ "x" | json }}\n{{ arr | map: "name" }}',
    );
    const unknowns = all.filter(d => d.check === 'UnknownFilter');
    expect(unknowns.length).toBe(0);
  });
});

describePosCli('LSP contract: UndefinedObject', () => {
  it('fires for undeclared variables in partials WITH {% doc %}', async () => {
    // Dependency: enricher adds hints, Shopify detection, "did you mean?" suggestions
    const content = `{% doc %}\n  @param title {string} - title\n{% enddoc %}\n{{ unknown_variable_xyz }}`;
    const { all } = await getLspDiags(
      'app/views/partials/contract_undef_doc.liquid',
      content,
    );
    const check = all.find(d => d.check === 'UndefinedObject');
    expect(check).toBeDefined();
  });

  it('does NOT fire for declared @param variables', async () => {
    const content = `{% doc %}\n  @param title {string} - title\n{% enddoc %}\n{{ title }}`;
    const { all } = await getLspDiags(
      'app/views/partials/contract_undef_param.liquid',
      content,
    );
    const undefs = all.filter(d => d.check === 'UndefinedObject' && d.message?.includes('title'));
    expect(undefs.length).toBe(0);
  });

  it('behavior WITHOUT {% doc %} in partials (tracking)', async () => {
    // This tracks the behavioral change in platformos-check-common@0.0.17:
    // UndefinedObject now requires {% doc %} in partials.
    // If upstream reverts this, this test catches it as an opportunity.
    const { all } = await getLspDiags(
      'app/views/partials/contract_undef_nodoc.liquid',
      '{{ some_mystery_variable }}',
    );
    const check = all.find(d => d.check === 'UndefinedObject');
    if (check) {
      console.log('[OPPORTUNITY] UndefinedObject now fires WITHOUT {% doc %} in partials!');
      console.log('  Impact: enrichment/Shopify detection works for all partials again.');
      console.log('  Action: remove the {% doc %} requirement from enrichment tests.');
    }
    // Currently expected: UndefinedObject does NOT fire without {% doc %}
    expect(check).toBeUndefined();
  });

  it('fires for unknown variables in pages', async () => {
    // Pages always get UndefinedObject checks (no {% doc %} needed)
    const content = `---\nslug: contract-test\n---\n{{ totally_unknown_page_var }}`;
    const { all } = await getLspDiags(
      'app/views/pages/contract_undef.html.liquid',
      content,
    );
    const check = all.find(d => d.check === 'UndefinedObject');
    expect(check).toBeDefined();
  });

  it('message contains variable name in quotes', async () => {
    // Dependency: extractVarName() regex /`([^`]+)`/ or /'([^']+)'/ or /"([^"]+)"/
    const content = `{% doc %}\n  @param t {string}\n{% enddoc %}\n{{ mystery_var_name }}`;
    const { all } = await getLspDiags(
      'app/views/partials/contract_undef_msg.liquid',
      content,
    );
    const check = all.find(d => d.check === 'UndefinedObject');
    expect(check).toBeDefined();
    expect(check.message).toMatch(/['"`]mystery_var_name['"`]/);
  });

  it('severity is warning (2)', async () => {
    // Dependency: pipeline elevateShopify() expects UndefinedObject as warning, then promotes
    const content = `{% doc %}\n  @param t {string}\n{% enddoc %}\n{{ undef_sev_test }}`;
    const { warnings } = await getLspDiags(
      'app/views/partials/contract_undef_sev.liquid',
      content,
    );
    const check = warnings.find(d => d.check === 'UndefinedObject');
    expect(check).toBeDefined();
  });
});

describePosCli('LSP contract: MissingPartial', () => {
  it('fires for nonexistent partials', async () => {
    // Dependency: enricher builds create path, detects object type (partial/command/query/module)
    const { all } = await getLspDiags(
      'app/views/partials/contract_missing.liquid',
      "{% render 'completely/nonexistent/partial' %}",
    );
    const check = all.find(d => d.check === 'MissingPartial');
    expect(check).toBeDefined();
  });

  it('message contains partial name in quotes', async () => {
    // Dependency: extractPartialName() regex /['"]([^'"]+)['"]/
    const { all } = await getLspDiags(
      'app/views/partials/contract_missing_msg.liquid',
      "{% render 'contract_test/nonexistent_xyz' %}",
    );
    const check = all.find(d => d.check === 'MissingPartial');
    expect(check).toBeDefined();
    expect(check.message).toMatch(/['"`]contract_test\/nonexistent_xyz['"`]/);
  });

  it('does NOT fire for existing partials', async () => {
    // blog_posts/card exists in the fixture project
    const { all } = await getLspDiags(
      'app/views/partials/contract_existing.liquid',
      "{% render 'blog_posts/card', blog_post: null %}",
    );
    const missing = all.filter(d => d.check === 'MissingPartial');
    expect(missing.length).toBe(0);
  });

  it('severity is warning (2)', async () => {
    // MissingPartial is a warning from the LSP — our pipeline keeps it as warning
    // (or downgrades in pre-write mode)
    const { warnings } = await getLspDiags(
      'app/views/partials/contract_missing_sev.liquid',
      "{% render 'does/not/exist/anywhere' %}",
    );
    const check = warnings.find(d => d.check === 'MissingPartial');
    expect(check).toBeDefined();
  });
});

describePosCli('LSP contract: DeprecatedTag', () => {
  it('fires for {% include %}', async () => {
    // Dependency: enricher overrides message, extracts tag name + replacement
    const { all } = await getLspDiags(
      'app/views/partials/contract_deprecated.liquid',
      "{% include 'shared/test' %}",
    );
    const check = all.find(d => d.check === 'DeprecatedTag');
    expect(check).toBeDefined();
  });

  it('message contains tag name in quotes', async () => {
    // Dependency: extractDeprecatedTagInfo() regex /[`'"](\w+)[`'"]/
    const { all } = await getLspDiags(
      'app/views/partials/contract_deprecated_msg.liquid',
      "{% include 'test_partial' %}",
    );
    const check = all.find(d => d.check === 'DeprecatedTag');
    expect(check).toBeDefined();
    expect(check.message).toMatch(/['"`]include['"`]/);
  });
});

describePosCli('LSP contract: TranslationKeyExists', () => {
  it('fires for missing translation keys', async () => {
    // Dependency: enricher builds YAML snippet, extracts key
    const { all } = await getLspDiags(
      'app/views/partials/contract_trans.liquid',
      "{{ 'nonexistent.translation.key.xyz123' | t }}",
    );
    const check = all.find(d => d.check === 'TranslationKeyExists');
    expect(check).toBeDefined();
  });

  it('message contains translation key in quotes', async () => {
    // Dependency: extractTranslationKey() regex /['"`]([^'"`]+)['"`]/
    const { all } = await getLspDiags(
      'app/views/partials/contract_trans_msg.liquid',
      "{{ 'my.test.key.nonexistent' | t }}",
    );
    const check = all.find(d => d.check === 'TranslationKeyExists');
    expect(check).toBeDefined();
    expect(check.message).toMatch(/['"`]my\.test\.key\.nonexistent['"`]/);
  });
});

describePosCli('LSP contract: UnusedAssign', () => {
  it('fires for unused variables', async () => {
    // Dependency: enricher extracts var name
    const { all } = await getLspDiags(
      'app/views/partials/contract_unused.liquid',
      '{% assign never_used_variable = "hello" %}',
    );
    const check = all.find(d => d.check === 'UnusedAssign');
    expect(check).toBeDefined();
  });

  it('severity is warning', async () => {
    const { warnings } = await getLspDiags(
      'app/views/partials/contract_unused_sev.liquid',
      '{% assign unused_sev_test = 1 %}',
    );
    const check = warnings.find(d => d.check === 'UnusedAssign');
    expect(check).toBeDefined();
  });
});

describePosCli('LSP contract: OrphanedPartial', () => {
  it('fires for unreferenced partials', async () => {
    // Dependency: pipeline suppresses OrphanedPartial for commands/queries
    const { all } = await getLspDiags(
      'app/views/partials/contract_orphaned.liquid',
      '{{ "just some content" }}',
    );
    const check = all.find(d => d.check === 'OrphanedPartial');
    expect(check).toBeDefined();
  });

  it('severity is warning', async () => {
    const { warnings } = await getLspDiags(
      'app/views/partials/contract_orphaned_sev.liquid',
      'hello',
    );
    const check = warnings.find(d => d.check === 'OrphanedPartial');
    expect(check).toBeDefined();
  });
});

describePosCli('LSP contract: MissingRenderPartialArguments', () => {
  it('fires when required params are omitted', async () => {
    // blog_posts/card has {% doc %} @param blog_post — rendering without it triggers this
    // Dependency: enricher extracts partial name and missing param
    const { all } = await getLspDiags(
      'app/views/partials/contract_missing_args.liquid',
      "{% render 'blog_posts/card' %}",
    );
    const check = all.find(d => d.check === 'MissingRenderPartialArguments');
    expect(check).toBeDefined();
  });

  it('message contains "argument" and param name', async () => {
    // Dependency: extractMissingArgInfo() regex /argument\s+['"`](\w+)['"`]/
    const { all } = await getLspDiags(
      'app/views/partials/contract_missing_args_msg.liquid',
      "{% render 'blog_posts/card' %}",
    );
    const check = all.find(d => d.check === 'MissingRenderPartialArguments');
    if (check) {
      expect(check.message).toMatch(/argument/i);
      expect(check.message).toMatch(/blog_post/);
    }
  });
});
