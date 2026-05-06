import { describe, it, expect, beforeEach } from 'bun:test';
import { registerRules, clearRules, runRules } from '../../src/core/rules/engine.js';
import { rules } from '../../src/core/rules/GraphQLCheck.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';

function buildGraphWithSchema() {
  return buildFactGraph({
    pages: {}, partials: {}, commands: {}, queries: {},
    graphql: {}, layouts: {}, translations: {}, assets: [],
    schema: {
      blog_post: {
        path: 'app/schema/blog_post.yml',
        properties: [
          { name: 'title' },
          { name: 'content' },
          { name: 'author' },
          { name: 'slug' },
        ],
      },
      product: {
        path: 'app/schema/product.yml',
        properties: [
          { name: 'name' },
          { name: 'price' },
          { name: 'sku' },
        ],
      },
    },
  });
}

function buildMinimalGraph() {
  return buildFactGraph({
    pages: {}, partials: {}, commands: {}, queries: {},
    graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
  });
}

describe('GraphQLCheck rules', () => {
  beforeEach(() => {
    clearRules();
    registerRules(rules);
  });

  describe('unknown_field (priority 10)', () => {
    it('matches unknown field on Record type with schema suggestions', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'unknown_field_record', field: 'titl', type: 'Record' },
        message: 'Cannot query field "titl" on type "Record"',
        file: 'app/graphql/get_posts.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('GraphQLCheck.unknown_field');
      expect(result.confidence).toBe(0.85);
      expect(result.hint_md).toContain('titl');
      expect(result.hint_md).toContain('title');
      expect(result.hint_md).toContain('properties');
      expect(result.see_also).toBeDefined();
      expect(result.see_also.tool).toBe('domain_guide');
    });

    it('matches unknown field on non-Record type', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'unknown_field_other', field: 'foo', type: 'UserProfile' },
        message: 'Cannot query field "foo" on type "UserProfile"',
        file: 'app/graphql/get_user.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('GraphQLCheck.unknown_field');
      expect(result.confidence).toBe(0.6);
    });

    it('lists available schema tables', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'unknown_field_record', field: 'nonexistent', type: 'Record' },
        message: 'Cannot query field "nonexistent" on type "Record"',
        file: 'app/graphql/test.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.hint_md).toContain('blog_post');
      expect(result.hint_md).toContain('product');
    });
  });

  describe('unused_variable (priority 20)', () => {
    it('matches unused variable diagnostics', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'unused_variable', variable: 'limit' },
        message: 'Variable "$limit" is never used in operation "GetPosts"',
        file: 'app/graphql/get_posts.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('GraphQLCheck.unused_variable');
      expect(result.confidence).toBe(0.9);
      expect(result.hint_md).toContain('$limit');
    });
  });

  describe('type_mismatch (priority 30)', () => {
    it('matches filter type mismatch with platformOS guidance', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'type_mismatch_filter', variable: 'name', actual_type: 'String', expected_type: 'StringFilter' },
        message: 'Variable "$name" of type "String" used in position expecting type "StringFilter"',
        file: 'app/graphql/search.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('GraphQLCheck.type_mismatch');
      expect(result.confidence).toBe(0.85);
      expect(result.hint_md).toContain('StringFilter');
      expect(result.hint_md).toContain('value');
      expect(result.see_also).toBeDefined();
    });

    it('matches non-filter type mismatch', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'type_mismatch_other', variable: 'id', actual_type: 'ID!', expected_type: 'Int' },
        message: 'Variable "$id" of type "ID!" used in position expecting type "Int"',
        file: 'app/graphql/get_item.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('GraphQLCheck.type_mismatch');
      expect(result.confidence).toBe(0.7);
    });
  });

  describe('generic (priority 100)', () => {
    it('matches any GraphQLCheck as fallback', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'generic' },
        message: 'Some GraphQL error',
        file: 'app/graphql/query.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('GraphQLCheck.generic');
      expect(result.confidence).toBe(0.4);
      expect(result.see_also).toBeDefined();
      expect(result.see_also.tool).toBe('domain_guide');
    });
  });

  describe('priority ordering', () => {
    it('unknown_field wins over generic', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'unknown_field_record', field: 'title', type: 'Record' },
        message: 'Cannot query field "title" on type "Record"',
        file: 'app/graphql/test.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result.rule_id).toBe('GraphQLCheck.unknown_field');
    });

    it('unused_variable wins over generic', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'GraphQLCheck',
        params: { category: 'unused_variable', variable: 'x' },
        message: 'Variable "$x" is never used',
        file: 'test.graphql',
      };
      const result = runRules(diag, { graph });
      expect(result.rule_id).toBe('GraphQLCheck.unused_variable');
    });
  });
});
