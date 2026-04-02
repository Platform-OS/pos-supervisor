import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

// ---------------------------------------------------------------------------
// Feature 3: Shopify contamination elevated to errors
// ---------------------------------------------------------------------------

describePosCli('Shopify contamination — elevation to errors', () => {
  it('Shopify object {{ cart.item_count }} produces errors not just warnings', async () => {
    const content = `{{ cart.item_count }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_cart.liquid',
      content,
      mode: 'full',
    });
    // cart is a Shopify object — should appear in errors (elevated from warning)
    // It may show up as UndefinedObject (elevated) or pos-supervisor:ShopifyObject
    const shopifyErrors = result.errors.filter(e =>
      (e.check === 'UndefinedObject' || e.check === 'pos-supervisor:ShopifyObject') &&
      e.message?.includes('cart')
    );
    expect(shopifyErrors.length).toBeGreaterThan(0);
    // Severity should be error
    for (const e of shopifyErrors) {
      expect(e.severity).toBe('error');
    }
  });

  it('valid is false when Shopify objects are used', async () => {
    const content = `{{ shop.name }}
{{ customer.email }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_invalid.liquid',
      content,
      mode: 'full',
    });
    expect(result.valid).toBe(false);
  });

  it('Shopify objects appear in errors array, not just warnings', async () => {
    const content = `{{ product.title }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_shopify_product.liquid',
      content,
      mode: 'full',
    });
    // product is Shopify — should be in errors
    const inErrors = result.errors.some(e =>
      (e.check === 'UndefinedObject' || e.check === 'pos-supervisor:ShopifyObject') &&
      e.message?.includes('product')
    );
    const inWarningsOnly = !inErrors && result.warnings.some(e =>
      (e.check === 'UndefinedObject' || e.check === 'pos-supervisor:ShopifyObject') &&
      e.message?.includes('product')
    );
    // Should be in errors, not only in warnings
    expect(inErrors).toBe(true);
    expect(inWarningsOnly).toBe(false);
  });
});
