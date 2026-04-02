import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describePosCli('Shopify contamination — objects', () => {
  it('detects Shopify objects and provides platformOS alternatives', async () => {
    const content = `{{ cart.item_count }}
{{ product.price }}
{{ shop.name }}
{{ customer.name }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify.liquid',
      content,
      mode: 'full',
    });
    // Shopify objects may appear as errors, warnings, or structural warnings
    const allDiags = [...result.errors, ...result.warnings];
    const shopifyDiags = allDiags.filter(e =>
      (e.check === 'UndefinedObject' || e.check === 'pos-supervisor:ShopifyObject') &&
      (e.message?.match(/cart|product|shop|customer/i))
    );
    expect(shopifyDiags.length).toBeGreaterThanOrEqual(2);
    // At least some should have Shopify-specific suggestions
    const withSuggestion = shopifyDiags.filter(e => e.suggestion && /shopify/i.test(e.suggestion));
    expect(withSuggestion.length).toBeGreaterThan(0);
  });

  it('detects Shopify filters and suggests platformOS alternatives', async () => {
    const content = `{{ 1999 | money }}
{{ 'now' | date: '%Y' }}
{{ product.url | img_url: '300x' }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_filters.liquid',
      content,
      mode: 'full',
    });
    const filterErrors = result.errors.filter(e => e.check === 'UnknownFilter');
    // money and img_url are Shopify-specific filters
    expect(filterErrors.length).toBeGreaterThanOrEqual(1);
    // Should have enriched suggestions mentioning Shopify
    const withSuggestion = filterErrors.filter(e => e.suggestion && /shopify/i.test(e.suggestion));
    expect(withSuggestion.length).toBeGreaterThan(0);
  });
});

describePosCli('Shopify contamination — tags', () => {
  it('detects Shopify form tag', async () => {
    const content = `{% form 'contact' %}
  <input type="text" name="email">
{% endform %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_tags.liquid',
      content,
      mode: 'full',
    });
    // form is not a platformOS tag — should produce an error or structural warning
    const allDiags = [...result.errors, ...result.warnings];
    expect(allDiags.length).toBeGreaterThan(0);
  });

  it('detects Shopify section tag', async () => {
    const content = `{% section 'header' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_section.liquid',
      content,
      mode: 'full',
    });
    const allDiags = [...result.errors, ...result.warnings];
    expect(allDiags.length).toBeGreaterThan(0);
  });
});
