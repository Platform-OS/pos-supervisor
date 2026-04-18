import { describe, it, expect, beforeEach } from 'bun:test';
import { registerRules, clearRules, runRules } from '../../src/core/rules/engine.js';
import { rules } from '../../src/core/rules/UnknownProperty.js';
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
          { name: 'published_at' },
          { name: 'slug' },
        ],
      },
      user_profile: {
        path: 'app/schema/user_profile.yml',
        properties: [
          { name: 'first_name' },
          { name: 'last_name' },
          { name: 'email' },
          { name: 'bio' },
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

describe('UnknownProperty rules', () => {
  beforeEach(() => {
    clearRules();
    registerRules(rules);
  });

  describe('schema_property (priority 10)', () => {
    it('matches when object is a known schema table', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'tittle', object: 'blog_post' },
        message: "Property 'tittle' does not exist on 'blog_post'",
        file: 'app/views/pages/blog.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('UnknownProperty.schema_property');
      expect(result.confidence).toBe(0.85);
      expect(result.hint_md).toContain('tittle');
      expect(result.hint_md).toContain('blog_post');
      expect(result.hint_md).toContain('title');
    });

    it('matches plural form of schema name', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'emale', object: 'user_profiles' },
        message: "Property 'emale' does not exist on 'user_profiles'",
        file: 'app/views/pages/users.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('UnknownProperty.schema_property');
      expect(result.hint_md).toContain('email');
    });

    it('lists available properties', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'nonexistent', object: 'blog_post' },
        message: "Property 'nonexistent' does not exist on 'blog_post'",
        file: 'app/views/pages/blog.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.hint_md).toContain('title');
      expect(result.hint_md).toContain('content');
      expect(result.hint_md).toContain('Available properties');
    });

    it('does not match unknown schema table', () => {
      const graph = buildGraphWithSchema();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'foo', object: 'nonexistent_table' },
        message: "Property 'foo' does not exist on 'nonexistent_table'",
        file: 'test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).not.toBe('UnknownProperty.schema_property');
    });
  });

  describe('context_property (priority 20)', () => {
    it('matches when object starts with context and objectsIndex is loaded', () => {
      const graph = buildMinimalGraph();
      const mockObjectsIndex = {
        loaded: true,
        contextObjects: () => [
          { handle: 'context.current_user', properties: ['id', 'email', 'first_name'] },
          { handle: 'context.session', properties: ['token', 'csrf'] },
        ],
      };
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'emai', object: 'context.current_user' },
        message: "Property 'emai' does not exist on 'context.current_user'",
        file: 'app/views/pages/profile.liquid',
      };
      const result = runRules(diag, { graph, objectsIndex: mockObjectsIndex });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('UnknownProperty.context_property');
      expect(result.confidence).toBe(0.7);
      expect(result.hint_md).toContain('emai');
      expect(result.hint_md).toContain('email');
      expect(result.see_also).toBeDefined();
      expect(result.see_also.tool).toBe('domain_guide');
    });

    it('does not match non-context objects', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'foo', object: 'some_var' },
        message: "Property 'foo' does not exist on 'some_var'",
        file: 'test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('UnknownProperty.generic');
    });
  });

  describe('generic (priority 100)', () => {
    it('matches any property/object pair as fallback', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'foo', object: 'bar' },
        message: "Property 'foo' does not exist on 'bar'",
        file: 'app/views/pages/test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('UnknownProperty.generic');
      expect(result.confidence).toBe(0.4);
    });

    it('adds partial hint when file is in partials directory', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'UnknownProperty',
        params: { property: 'foo', object: 'bar' },
        message: "Property 'foo' does not exist on 'bar'",
        file: 'app/views/partials/my-partial.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.hint_md).toContain('doc');
    });

    it('returns null when params are missing', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'UnknownProperty',
        params: {},
        message: 'Some unknown property error',
        file: 'test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).toBeNull();
    });
  });
});
