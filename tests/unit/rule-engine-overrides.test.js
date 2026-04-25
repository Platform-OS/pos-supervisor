import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  registerRule, clearRules, runRules,
  updateDisabledRules, updateForceOverrides,
  setDisabledRuleDetails, getDisabledRuleDetails,
  isCheckForceDisabled,
} from '../../src/core/rules/engine.js';

function makeRule(id, check, response) {
  return {
    id, check, priority: 10,
    when: () => true,
    apply: () => ({ rule_id: id, hint_md: response, fixes: [], confidence: 0.8 }),
  };
}

// Reset module-level engine state so tests don't leak into other files
// (the engine registry + override sets are singletons; any assertion here
// that mutates them must tidy up, otherwise the next file runs with
// `_forceDisabled` still populated and legitimate rules silently skip).
function resetEngineState() {
  clearRules();
  updateDisabledRules(null);
  updateForceOverrides({ force_enable: [], force_disable: [] });
  setDisabledRuleDetails([]);
}

beforeEach(resetEngineState);
afterEach(resetEngineState);

describe('engine: force overrides', () => {
  const diag = { check: 'UnknownFilter', message: "Unknown filter 'x'" };
  const facts = {};

  test('force_disable beats normal enabled state', () => {
    registerRule(makeRule('UnknownFilter.generic', 'UnknownFilter', 'hi'));
    updateForceOverrides({ force_disable: ['UnknownFilter.generic'] });
    expect(runRules(diag, facts)).toBeNull();
  });

  test('force_enable beats _disabledRules', () => {
    registerRule(makeRule('UnknownFilter.generic', 'UnknownFilter', 'hi'));
    updateDisabledRules(['UnknownFilter.generic']);
    expect(runRules(diag, facts)).toBeNull(); // baseline: disabled
    updateForceOverrides({ force_enable: ['UnknownFilter.generic'] });
    const r = runRules(diag, facts);
    expect(r?.rule_id).toBe('UnknownFilter.generic');
  });

  test('force_disable takes precedence over force_enable', () => {
    registerRule(makeRule('UnknownFilter.generic', 'UnknownFilter', 'hi'));
    updateForceOverrides({
      force_enable: ['UnknownFilter.generic'],
      force_disable: ['UnknownFilter.generic'],
    });
    expect(runRules(diag, facts)).toBeNull();
  });

  test('getDisabledRuleDetails flags force_enabled rules', () => {
    updateDisabledRules(['A.x']);
    setDisabledRuleDetails([{ rule_id: 'A.x', effectiveness: 0.1, emitted: 10 }]);
    updateForceOverrides({ force_enable: ['A.x'] });
    const details = getDisabledRuleDetails();
    expect(details).toHaveLength(1);
    expect(details[0].force_enabled).toBe(true);
    expect(details[0].effectiveness).toBe(0.1);
  });

  test('clearing overrides restores baseline behavior', () => {
    registerRule(makeRule('UnknownFilter.generic', 'UnknownFilter', 'hi'));
    updateForceOverrides({ force_disable: ['UnknownFilter.generic'] });
    expect(runRules(diag, facts)).toBeNull();
    updateForceOverrides({ force_enable: [], force_disable: [] });
    expect(runRules(diag, facts)?.rule_id).toBe('UnknownFilter.generic');
  });
});

describe('engine: check-name force-disable', () => {
  test('isCheckForceDisabled true only when name is in the set', () => {
    updateForceOverrides({ force_disable: ['pos-supervisor:HtmlInPage'] });
    expect(isCheckForceDisabled('pos-supervisor:HtmlInPage')).toBe(true);
    expect(isCheckForceDisabled('UnknownFilter')).toBe(false);
    expect(isCheckForceDisabled(null)).toBe(false);
    expect(isCheckForceDisabled(undefined)).toBe(false);
  });

  test('rule_ids and check names share the same force-disable set', () => {
    updateForceOverrides({ force_disable: ['UnknownFilter.generic', 'pos-supervisor:HtmlInPage'] });
    expect(isCheckForceDisabled('UnknownFilter.generic')).toBe(true);
    expect(isCheckForceDisabled('pos-supervisor:HtmlInPage')).toBe(true);
  });
});
