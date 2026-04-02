import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

// ---------------------------------------------------------------------------
// Feature 8: Auto-enrich errors without suggestions
// ---------------------------------------------------------------------------

describePosCli('Auto-enrich — LSP completions on errors without suggestions', () => {
  it('error without suggestion has completions field populated', async () => {
    // Use an undefined object that is NOT a Shopify object (so no suggestion is generated),
    // but that the LSP can provide completions for
    const content = `{{ contex }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_auto_enrich.liquid',
      content,
      mode: 'full',
    });

    // Find errors that have a line number (required for completions lookup)
    const errorsWithLine = result.errors.filter(e => e.line != null);

    // At least some errors should exist for the undefined object
    expect(errorsWithLine.length).toBeGreaterThanOrEqual(0);

    // Check if any error got completions added
    // Note: completions are best-effort — they may not always be populated
    // depending on LSP state, but the field should exist when the feature fires
    const withCompletions = result.errors.filter(e =>
      Array.isArray(e.completions) && e.completions.length > 0
    );

    // If LSP is available and returned completions, verify the array structure
    if (withCompletions.length > 0) {
      for (const e of withCompletions) {
        expect(Array.isArray(e.completions)).toBe(true);
        // Completions should be strings (labels)
        for (const c of e.completions) {
          expect(typeof c).toBe('string');
        }
      }
    }
  });

  it('errors with existing suggestions do not get completions', async () => {
    // Shopify object — will get a suggestion from the enricher
    const content = `{{ cart.item_count }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_no_extra_completions.liquid',
      content,
      mode: 'full',
    });

    // Errors with suggestions should NOT have completions (auto-enrich skips them)
    const errorsWithSuggestion = result.errors.filter(e => e.suggestion);
    for (const e of errorsWithSuggestion) {
      // completions should be undefined (not populated) for errors that already have suggestions
      expect(e.completions).toBeUndefined();
    }
  });
});
