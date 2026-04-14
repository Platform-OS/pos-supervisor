/**
 * LSP coverage overlap tests — detect when upstream starts covering our checks.
 *
 * For each pos-supervisor: structural check, this sends triggering content and
 * checks if the LSP independently produces a related diagnostic. This detects:
 *
 * - OVERLAP: LSP now covers something we do manually → opportunity to simplify
 * - NO OVERLAP: LSP does not cover this → our structural warning is still needed
 *
 * These tests always pass. They log findings for review.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from '../integration/pos-cli/guard.js';
import { startServer, FIXTURE_DIR } from '../integration/helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

/**
 * Call validate_code and separate LSP diagnostics from pos-supervisor diagnostics.
 */
async function checkOverlap(filePath, content) {
  const result = await server.callTool('validate_code', { file_path: filePath, content, mode: 'quick' });
  const allDiags = [...result.errors, ...result.warnings];
  // Exclude OrphanedPartial — it fires for all test partials and is noise in overlap detection
  const lsp = allDiags.filter(d => !d.check.startsWith('pos-supervisor:') && d.check !== 'OrphanedPartial');
  const ours = allDiags.filter(d => d.check.startsWith('pos-supervisor:'));
  return { lsp, ours, all: allDiags };
}

function reportOverlap(ourCheck, lspDiags) {
  if (lspDiags.length > 0) {
    const checks = [...new Set(lspDiags.map(d => d.check))];
    console.log(`  [OVERLAP] ${ourCheck} — LSP also reports: ${checks.join(', ')}`);
    for (const d of lspDiags.slice(0, 3)) {
      console.log(`    ${d.check}: ${d.message?.slice(0, 80)}`);
    }
  } else {
    console.log(`  [NO OVERLAP] ${ourCheck} — LSP does not cover this`);
  }
}

describePosCli('Coverage map: pos-supervisor structural checks', () => {
  it('pos-supervisor:HtmlInPage', async () => {
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_html.html.liquid',
      '---\nslug: coverage-html\n---\n<div>Direct HTML in page</div>',
    );
    reportOverlap('pos-supervisor:HtmlInPage', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:GraphqlInPartial', async () => {
    const { lsp } = await checkOverlap(
      'app/views/partials/coverage_gql.liquid',
      "{% graphql g = 'users/search', id: 1 %}",
    );
    reportOverlap('pos-supervisor:GraphqlInPartial', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:MissingDocBlock', async () => {
    const { lsp } = await checkOverlap(
      'app/views/partials/coverage_nodoc.liquid',
      '{{ title }}',
    );
    reportOverlap('pos-supervisor:MissingDocBlock', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:MissingReturn', async () => {
    const { lsp } = await checkOverlap(
      'app/lib/commands/coverage/test.liquid',
      '{% assign x = 1 %}',
    );
    reportOverlap('pos-supervisor:MissingReturn', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:ShopifyObject', async () => {
    const { lsp } = await checkOverlap(
      'app/views/partials/coverage_shopify.liquid',
      '{{ cart.item_count }}\n{{ product.price }}',
    );
    // Check specifically if LSP reports UndefinedObject mentioning Shopify objects
    const shopifyRelated = lsp.filter(d =>
      d.check === 'UndefinedObject' &&
      d.message?.match(/cart|product/i)
    );
    if (shopifyRelated.length > 0) {
      console.log('  [OVERLAP] LSP reports UndefinedObject for Shopify objects');
      console.log('  Impact: enricher Shopify detection via UndefinedObject path is active');
    } else {
      reportOverlap('pos-supervisor:ShopifyObject', lsp);
    }
    expect(true).toBe(true);
  });

  it('pos-supervisor:DeprecatedTag (parse_json)', async () => {
    const { lsp } = await checkOverlap(
      'app/views/partials/coverage_deprecated.liquid',
      '{% parse_json x %}{"a":1}{% endparse_json %}\n{{ x }}',
    );
    const deprecatedFromLsp = lsp.filter(d => d.check === 'DeprecatedTag');
    reportOverlap('pos-supervisor:DeprecatedTag', deprecatedFromLsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:InvalidSlug (leading slash)', async () => {
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_slug.html.liquid',
      '---\nslug: /leading-slash-test\n---\nHello',
    );
    reportOverlap('pos-supervisor:InvalidSlug', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:InvalidSlug (bracket syntax)', async () => {
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_slug_bracket.html.liquid',
      '---\nslug: users/[id]\n---\nHello',
    );
    reportOverlap('pos-supervisor:InvalidSlug', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:InvalidLayout', async () => {
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_layout.html.liquid',
      '---\nslug: coverage-layout\nlayout: nonexistent_layout_xyz\n---\nHello',
    );
    reportOverlap('pos-supervisor:InvalidLayout', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:MissingSlug', async () => {
    // Page without front matter at all
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_noslug.html.liquid',
      'Hello world',
    );
    reportOverlap('pos-supervisor:MissingSlug', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:FilterArgMisuse', async () => {
    const { lsp } = await checkOverlap(
      'app/views/partials/coverage_filterargs.liquid',
      '{{ items | map: "a", "b", "c" }}',
    );
    reportOverlap('pos-supervisor:FilterArgMisuse', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:MissingContentForLayout', async () => {
    const { lsp } = await checkOverlap(
      'app/views/layouts/coverage_nocfl.html.liquid',
      '<html><body>No content_for_layout here</body></html>',
    );
    reportOverlap('pos-supervisor:MissingContentForLayout', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:InvalidMethod', async () => {
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_method.html.liquid',
      '---\nslug: coverage-method\nmethod: POST\n---\nHello',
    );
    reportOverlap('pos-supervisor:InvalidMethod', lsp);
    expect(true).toBe(true);
  });

  it('pos-supervisor:InvalidFrontMatter', async () => {
    const { lsp } = await checkOverlap(
      'app/views/pages/coverage_fm.html.liquid',
      '---\nslug: coverage-fm\ncache: 3600\n---\nHello',
    );
    reportOverlap('pos-supervisor:InvalidFrontMatter', lsp);
    expect(true).toBe(true);
  });
});
