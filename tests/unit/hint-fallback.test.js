import { describe, it, expect, setDefaultTimeout } from 'bun:test';
import { enrichError } from '../../src/core/error-enricher.js';

setDefaultTimeout(30_000);

// ---------------------------------------------------------------------------
// Feature 4: Hint extraction fallbacks
// ---------------------------------------------------------------------------

describe('extractMissingArgInfo fallback — garbled message', () => {
  it('enrichError produces a non-null hint even with a garbled MissingRenderPartialArguments message', async () => {
    const diagnostic = {
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: 'Something completely garbled with no recognizable pattern',
      line: 5,
      column: 0,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/partials/test.liquid',
    });
    // When extraction fails, enrichError should still produce a hint (generic fallback)
    // and the hint should NOT contain '?' from failed template interpolation
    expect(result.hint).not.toBeNull();
    if (result.hint) {
      expect(result.hint).not.toContain("'?'");
    }
  });

  it('enrichError produces a hint for MissingPartial with garbled message', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error',
      message: 'garbled error no quotes at all',
      line: 1,
      column: 0,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content: '{% render something %}',
    });
    // Should get a generic hint, not null, and not contain unresolved template vars
    expect(result.hint).not.toBeNull();
    if (result.hint) {
      expect(typeof result.hint).toBe('string');
      expect(result.hint.length).toBeGreaterThan(0);
    }
  });

  it('enrichError produces a hint for UnknownFilter with garbled message', async () => {
    const diagnostic = {
      check: 'UnknownFilter',
      severity: 'error',
      message: 'totally garbled message with no filter name extractable',
      line: 1,
      column: 0,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/partials/test.liquid',
    });
    // Should still get a generic hint for the check type
    expect(result.hint).not.toBeNull();
    if (result.hint) {
      expect(result.hint).not.toContain("'?'");
    }
  });

  it('enrichError produces a hint for UndefinedObject with garbled message', async () => {
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning',
      message: 'no backticks or quotes here so extraction fails completely',
      line: 1,
      column: 0,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/partials/test.liquid',
    });
    // Should get a generic UndefinedObject hint without '?' placeholders
    expect(result.hint).not.toBeNull();
    if (result.hint) {
      expect(result.hint).not.toContain("'?'");
    }
  });

  it('extractMissingArgInfo returns nulls for unrecognizable message (tested via enrichError)', async () => {
    // When the internal extractMissingArgInfo can't parse the message,
    // it returns { partialName: null, missingParam: null }.
    // enrichError should then call getHint without template vars (generic hint).
    const diagnostic = {
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      message: '????',
      line: 0,
      column: 0,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/partials/test.liquid',
    });
    // The hint should be the generic fallback, not containing unresolved {{ }}
    expect(result.hint).toBeDefined();
    if (result.hint) {
      expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
    }
  });
});
