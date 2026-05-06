import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/DuplicateFunctionArguments.js';

beforeEach(() => { clearRules(); registerRules(rules); });
afterEach(() => { clearRules(); });

function diag(extra = {}) {
  return {
    check: 'DuplicateFunctionArguments',
    params: { argument: 'foo', tag_kind: 'function', partial: 'helpers/can_do', ...extra },
    message: '',
  };
}

describe('DuplicateFunctionArguments.default', () => {
  test('attribution + hint name the argument and partial for function tag', () => {
    const r = runRules(diag(), {});
    expect(r.rule_id).toBe('DuplicateFunctionArguments.default');
    expect(r.hint_md).toMatch(/`foo`/);
    expect(r.hint_md).toMatch(/helpers\/can_do/);
    expect(r.hint_md).toMatch(/\{% function/);
    expect(r.confidence).toBe(0.9);
  });

  test('render variant surfaces the right tag in the hint', () => {
    const r = runRules(diag({ tag_kind: 'render', partial: 'forms/login', argument: 'email' }), {});
    expect(r.hint_md).toMatch(/`email`/);
    expect(r.hint_md).toMatch(/\{% render/);
    expect(r.hint_md).toMatch(/forms\/login/);
  });

  test('falls back to safe wording when params are missing', () => {
    const r = runRules({ check: 'DuplicateFunctionArguments', message: '' }, {});
    expect(r.rule_id).toBe('DuplicateFunctionArguments.default');
    expect(r.hint_md).toMatch(/duplicate argument/i);
  });
});
