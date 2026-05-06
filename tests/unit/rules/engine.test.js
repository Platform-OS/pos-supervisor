import { describe, test, expect, beforeEach } from 'bun:test';
import {
  registerRule, registerRules, runRules, hasRules,
  getRulesForCheck, getAllChecksWithRules, clearRules, ruleCount,
} from '../../../src/core/rules/engine.js';

beforeEach(() => clearRules());

const makeRule = (overrides = {}) => {
  const id = overrides.id ?? 'Test.rule1';
  return {
    id,
    check: overrides.check ?? 'TestCheck',
    priority: overrides.priority ?? 100,
    when: overrides.when ?? (() => true),
    apply: overrides.apply ?? (() => ({ rule_id: id, hint_md: 'test hint', fixes: [], confidence: 1 })),
  };
};

describe('registerRule', () => {
  test('registers a valid rule', () => {
    registerRule(makeRule());
    expect(hasRules('TestCheck')).toBe(true);
    expect(ruleCount()).toBe(1);
  });

  test('throws on missing fields', () => {
    expect(() => registerRule({ id: 'x' })).toThrow();
    expect(() => registerRule({ id: 'x', check: 'C' })).toThrow();
  });

  test('sorts rules by priority', () => {
    registerRule(makeRule({ id: 'low', priority: 50 }));
    registerRule(makeRule({ id: 'high', priority: 10 }));
    registerRule(makeRule({ id: 'mid', priority: 30 }));
    const rules = getRulesForCheck('TestCheck');
    expect(rules.map(r => r.id)).toEqual(['high', 'mid', 'low']);
  });
});

describe('runRules — first match', () => {
  test('returns first matching rule result', () => {
    registerRule(makeRule({ id: 'first', priority: 1, apply: () => ({ rule_id: 'first', hint_md: 'first', fixes: [], confidence: 1 }) }));
    registerRule(makeRule({ id: 'second', priority: 2, apply: () => ({ rule_id: 'second', hint_md: 'second', fixes: [], confidence: 1 }) }));
    const result = runRules({ check: 'TestCheck' }, {});
    expect(result.rule_id).toBe('first');
  });

  test('skips rules where when() returns false', () => {
    registerRule(makeRule({ id: 'skip', priority: 1, when: () => false }));
    registerRule(makeRule({ id: 'match', priority: 2 }));
    const result = runRules({ check: 'TestCheck' }, {});
    expect(result.rule_id).toBe('match');
  });

  test('returns null when no rules match', () => {
    registerRule(makeRule({ when: () => false }));
    expect(runRules({ check: 'TestCheck' }, {})).toBeNull();
  });

  test('returns null for unknown check', () => {
    expect(runRules({ check: 'UnknownCheck' }, {})).toBeNull();
  });

  test('swallows rule exceptions', () => {
    registerRule(makeRule({ when: () => { throw new Error('boom'); } }));
    registerRule(makeRule({ id: 'fallback', priority: 200 }));
    const result = runRules({ check: 'TestCheck' }, {});
    expect(result.rule_id).toBe('fallback');
  });
});

describe('runRules — multi match', () => {
  test('returns all matching results', () => {
    registerRule(makeRule({ id: 'a', priority: 1, apply: () => ({ rule_id: 'a', hint_md: 'a', fixes: [], confidence: 1 }) }));
    registerRule(makeRule({ id: 'b', priority: 2, apply: () => ({ rule_id: 'b', hint_md: 'b', fixes: [], confidence: 1 }) }));
    const results = runRules({ check: 'TestCheck' }, {}, { multiMatch: true });
    expect(results).toHaveLength(2);
    expect(results.map(r => r.rule_id)).toEqual(['a', 'b']);
  });
});

describe('clearRules', () => {
  test('removes all registered rules', () => {
    registerRule(makeRule());
    clearRules();
    expect(ruleCount()).toBe(0);
    expect(hasRules('TestCheck')).toBe(false);
  });
});

describe('getAllChecksWithRules', () => {
  test('lists checks that have rules', () => {
    registerRule(makeRule({ check: 'A' }));
    registerRule(makeRule({ check: 'B', id: 'B.rule' }));
    expect(getAllChecksWithRules().sort()).toEqual(['A', 'B']);
  });
});
