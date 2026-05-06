import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  registerRule, registerRules, clearRules, runRules,
  updateDisabledRules, getDisabledRules, ruleCount,
} from '../../src/core/rules/engine.js';

function makeRule(id, check, priority = 50) {
  return {
    id,
    check,
    priority,
    when: () => true,
    apply: () => ({ rule_id: id, hint_md: `Hint from ${id}`, fixes: [], confidence: 0.5 }),
  };
}

describe('J4: disabled rule enforcement', () => {
  beforeEach(() => { clearRules(); updateDisabledRules([]); });
  afterEach(() => { clearRules(); updateDisabledRules([]); });

  it('updateDisabledRules sets the disabled set', () => {
    updateDisabledRules(['rule_a', 'rule_b']);
    const disabled = getDisabledRules();
    expect(disabled.has('rule_a')).toBe(true);
    expect(disabled.has('rule_b')).toBe(true);
    expect(disabled.size).toBe(2);
  });

  it('updateDisabledRules replaces previous set', () => {
    updateDisabledRules(['rule_a']);
    updateDisabledRules(['rule_b']);
    const disabled = getDisabledRules();
    expect(disabled.has('rule_a')).toBe(false);
    expect(disabled.has('rule_b')).toBe(true);
  });

  it('updateDisabledRules with null clears all', () => {
    updateDisabledRules(['rule_a']);
    updateDisabledRules(null);
    expect(getDisabledRules().size).toBe(0);
  });

  it('disabled rule is skipped in single-match mode', () => {
    registerRules([
      makeRule('Test.high', 'Test', 10),
      makeRule('Test.low', 'Test', 100),
    ]);
    updateDisabledRules(['Test.high']);

    const result = runRules({ check: 'Test' }, {});
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('Test.low');
  });

  it('disabled rule is skipped in multi-match mode', () => {
    registerRules([
      makeRule('Test.a', 'Test', 10),
      makeRule('Test.b', 'Test', 20),
      makeRule('Test.c', 'Test', 30),
    ]);
    updateDisabledRules(['Test.b']);

    const results = runRules({ check: 'Test' }, {}, { multiMatch: true });
    expect(results).toHaveLength(2);
    expect(results.map(r => r.rule_id)).toEqual(['Test.a', 'Test.c']);
  });

  it('returns null when all rules for a check are disabled', () => {
    registerRule(makeRule('Test.only', 'Test', 10));
    updateDisabledRules(['Test.only']);

    const result = runRules({ check: 'Test' }, {});
    expect(result).toBeNull();
  });

  it('non-disabled rules fire normally', () => {
    registerRule(makeRule('Test.active', 'Test', 10));
    updateDisabledRules(['SomeOther.rule']);

    const result = runRules({ check: 'Test' }, {});
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('Test.active');
  });

  it('clearing disabled set re-enables rules', () => {
    registerRule(makeRule('Test.rule', 'Test', 10));
    updateDisabledRules(['Test.rule']);
    expect(runRules({ check: 'Test' }, {})).toBeNull();

    updateDisabledRules([]);
    expect(runRules({ check: 'Test' }, {})).not.toBeNull();
  });
});
