import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules } from '../../../src/core/rules/UnknownFilter.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

const graph = buildFactGraph({ pages: {}, partials: {}, commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [] });

const mockTagsIndex = {
  isTag: (name) => ['render', 'graphql', 'function', 'if', 'for'].includes(name),
};

const mockFiltersIndex = {
  loaded: true,
  lookup: (name) => name === 'downcase' ? { name: 'downcase', syntax: '{{ string | downcase }}', summary: 'Lowercase' } : null,
  closestMatch: (name) => name === 'doncase' ? { name: 'downcase', syntax: '{{ string | downcase }}', summary: 'Lowercase' } : null,
};

beforeEach(() => { clearRules(); registerRules(rules); });

describe('UnknownFilter.tag_confusion', () => {
  test('fires when filter name is actually a tag', () => {
    const facts = { graph, tagsIndex: mockTagsIndex, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'render' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.tag_confusion');
    expect(result.hint_md).toContain('tag, not a filter');
    expect(result.confidence).toBe(0.95);
  });
});

describe('UnknownFilter.shopify_filter', () => {
  test('fires for Shopify-specific filters', () => {
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'money' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.shopify_filter');
    expect(result.hint_md).toContain('Shopify');
  });

  test('fires for img_url', () => {
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'img_url' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.shopify_filter');
  });
});

describe('UnknownFilter.suggest_nearest', () => {
  test('suggests exact match from filters index', () => {
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'downcase' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.suggest_nearest');
    expect(result.hint_md).toContain('downcase');
  });

  test('suggests closest match for typos', () => {
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'doncase' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.suggest_nearest');
    expect(result.hint_md).toContain('downcase');
  });
});

describe('UnknownFilter.generic', () => {
  test('fallback for completely unknown filter', () => {
    const noMatchIndex = { loaded: true, lookup: () => null, closestMatch: () => null };
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: noMatchIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'zzz_nonexistent' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.generic');
  });
});

describe('UnknownFilter — edge cases', () => {
  test('falls through to .default when filter param is missing', () => {
    const facts = { graph, tagsIndex: mockTagsIndex, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: {} };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UnknownFilter.default');
  });
});

describe('UnknownFilter.default catch-all', () => {
  test('does NOT preempt .tag_confusion', () => {
    const facts = { graph, tagsIndex: mockTagsIndex, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'render' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.tag_confusion');
  });

  test('does NOT preempt .shopify_filter', () => {
    const facts = { graph, tagsIndex: mockTagsIndex, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'money' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.shopify_filter');
  });

  test('does NOT preempt .suggest_nearest', () => {
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'downcase' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.suggest_nearest');
  });

  test('does NOT preempt .generic when filter name was extracted', () => {
    const noMatchIndex = { loaded: true, lookup: () => null, closestMatch: () => null };
    const facts = { graph, tagsIndex: { isTag: () => false }, filtersIndex: noMatchIndex };
    const diag = { check: 'UnknownFilter', params: { filter: 'zzz_nonexistent' } };
    const result = runRules(diag, facts);
    expect(result.rule_id).toBe('UnknownFilter.generic');
  });

  test('fires when extraction failed entirely', () => {
    const facts = { graph, tagsIndex: mockTagsIndex, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter' };
    const result = runRules(diag, facts);
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('UnknownFilter.default');
  });

  test('hint covers typo + Shopify-only escape hatches', () => {
    const facts = { graph, tagsIndex: mockTagsIndex, filtersIndex: mockFiltersIndex };
    const diag = { check: 'UnknownFilter', params: {} };
    const result = runRules(diag, facts);
    expect(result.hint_md).toContain('lookup');
    expect(result.hint_md).toContain('Shopify');
  });
});
