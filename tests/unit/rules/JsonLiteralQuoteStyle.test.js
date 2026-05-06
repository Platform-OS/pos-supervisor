import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/JsonLiteralQuoteStyle.js';

beforeEach(() => { clearRules(); registerRules(rules); });
afterEach(() => { clearRules(); });

describe('JsonLiteralQuoteStyle.default', () => {
  test('attributes every emit (single-shot rule)', () => {
    const r = runRules({ check: 'JsonLiteralQuoteStyle', params: {}, message: '' }, {});
    expect(r.rule_id).toBe('JsonLiteralQuoteStyle.default');
    expect(r.hint_md).toMatch(/double-quoted/);
    expect(r.hint_md).toMatch(/JSON literal/);
    expect(r.confidence).toBe(0.95);
  });
});
