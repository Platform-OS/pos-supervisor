/**
 * Bridge rules onto late-push diagnostics (2026-04-24 fix).
 *
 * Structural warnings, schema validators, diff-aware checks, and the
 * new-partial caller check are pushed into `result.errors/warnings` AFTER
 * `enrichAll` returns. Their rule modules never fire unless something runs
 * the engine on them again. `bridgeRulesOntoUnattributed()` is that bridge.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  clearRules, registerRule, registerRules, updateForceOverrides,
} from '../../src/core/rules/engine.js';
import { bridgeRulesOntoUnattributed } from '../../src/core/error-enricher.js';
import { rules as NonGetRenderingPageRules } from '../../src/core/rules/NonGetRenderingPage.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';

function resetEngine() {
  clearRules();
  updateForceOverrides({ force_enable: [], force_disable: [] });
}

beforeEach(resetEngine);
afterEach(resetEngine);

function emptyProjectMap() {
  return { pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [] };
}

const ctx = {
  filePath: 'app/views/pages/x.liquid',
  content: '',
  factGraph: buildFactGraph(emptyProjectMap()),
  filtersIndex: { loaded: true, lookup: () => null, closestMatch: () => null },
  objectsIndex: { loaded: true, lookup: () => null },
  tagsIndex: { isTag: () => false },
  schemaIndex: null,
  analyticsStore: null,
};

describe('bridgeRulesOntoUnattributed', () => {
  test('applies registered rule to a structural diagnostic with no prior rule_id', () => {
    registerRules(NonGetRenderingPageRules);
    const result = {
      errors: [],
      warnings: [{
        check: 'pos-supervisor:NonGetRenderingPage',
        severity: 'warning',
        message: 'method: post + renders HTML',
        line: 1,
      }],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    const w = result.warnings[0];
    expect(w.rule_id).toBe('NonGetRenderingPage.default');
    expect(w.confidence).toBe(0.9);
    expect(w.hint).toMatch(/method: post/i);
  });

  test('skips diagnostics that already carry a rule_id (idempotent)', () => {
    registerRules(NonGetRenderingPageRules);
    const result = {
      errors: [],
      warnings: [{
        check: 'pos-supervisor:NonGetRenderingPage',
        severity: 'warning',
        message: 'already stamped',
        rule_id: 'explicit.override',
        hint: 'explicit hint',
      }],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    // Pre-set rule_id preserved.
    expect(result.warnings[0].rule_id).toBe('explicit.override');
    expect(result.warnings[0].hint).toBe('explicit hint');
  });

  test('no-op when check has no registered rule module', () => {
    // Rule module NOT registered. Diagnostic stays unattributed; stampDefaultsOn
    // in the validate-code pipeline later fills in `.unmatched` fallback.
    const result = {
      errors: [],
      warnings: [{
        check: 'pos-supervisor:SomeCheckWithNoRule',
        severity: 'warning',
        message: '...',
      }],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    expect(result.warnings[0].rule_id).toBeUndefined();
  });

  test('no-op when factGraph is missing (guard against partial boot)', () => {
    registerRules(NonGetRenderingPageRules);
    const result = {
      errors: [],
      warnings: [{ check: 'pos-supervisor:NonGetRenderingPage', severity: 'warning', message: '...' }],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, { ...ctx, factGraph: null });
    expect(result.warnings[0].rule_id).toBeUndefined();
  });

  test('applies to errors and infos too, not just warnings', () => {
    registerRule({
      id: 'SampleRule.default',
      check: 'SampleCheck',
      priority: 100,
      when: () => true,
      apply: () => ({ rule_id: 'SampleRule.default', hint_md: 'hi', fixes: [], confidence: 0.5 }),
    });
    const result = {
      errors: [{ check: 'SampleCheck', severity: 'error', message: 'boom' }],
      warnings: [{ check: 'SampleCheck', severity: 'warning', message: 'boom' }],
      infos: [{ check: 'SampleCheck', severity: 'info', message: 'boom' }],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    expect(result.errors[0].rule_id).toBe('SampleRule.default');
    expect(result.warnings[0].rule_id).toBe('SampleRule.default');
    expect(result.infos[0].rule_id).toBe('SampleRule.default');
  });

  test('rule that throws does not crash the bridge (non-fatal)', () => {
    registerRule({
      id: 'Explosive.default',
      check: 'Explosive',
      priority: 100,
      when: () => true,
      apply: () => { throw new Error('boom'); },
    });
    const result = {
      errors: [],
      warnings: [{ check: 'Explosive', severity: 'warning', message: '...' }],
      infos: [],
    };
    // Must not throw.
    bridgeRulesOntoUnattributed(result, ctx);
    // Diagnostic stays unattributed — safer than half-attributed.
    expect(result.warnings[0].rule_id).toBeUndefined();
  });
});
