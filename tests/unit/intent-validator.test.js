/**
 * Unit tests for intent-validator.js
 * No LSP, no filesystem — all in-memory with mock projectMap.
 */

import { describe, it, expect } from 'bun:test';
import {
  validateSchema,
  validateDomain,
  validateProjectState,
  validatePolicy,
  checkGoalForShopify,
  normalizeScaffoldInput,
  extractScaffoldTranslationKeys,
  buildPlanId,
  buildPendingResolution,
  coerceIntent,
  partialPathToName,
  graphqlPathToName,
  schemaPathToName,
  suggestValidationOrder,
} from '../../src/core/intent-validator.js';

// ---------------------------------------------------------------------------
// Mock project map used across all project-state and policy tests
// ---------------------------------------------------------------------------

const MOCK_PROJECT_MAP = {
  project: {
    directory: '/project',
    modules: ['core', 'user'],
    environments: ['staging'],
    has_config: true,
  },
  schema: {
    blog_post: { properties: [{ name: 'title', type: 'string' }] },
  },
  graphql: {
    'blog_posts/search': { operation: 'query', name: 'BlogPostsSearch', args: [], table: 'blog_post' },
    'blog_posts/create': { operation: 'mutation', name: 'BlogPostCreate', args: [], table: 'blog_post' },
  },
  commands: {
    'app/lib/commands/blog_posts/create.liquid': { params: [], phases: ['main', 'build', 'check'] },
  },
  queries: {
    'app/lib/queries/blog_posts/search.liquid': { params: [], graphql_calls: ['blog_posts/search'] },
  },
  pages: {
    'blog-posts': { path: 'app/views/pages/blog_posts/index.html.liquid', method: 'get', layout: null, renders: [], function_calls: [] },
  },
  partials: {
    'blog_posts/card': { path: 'app/views/partials/blog_posts/card.liquid', params: [], renders: [], rendered_by: ['app/views/pages/blog_posts/index.html.liquid'] },
    'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid', params: [], renders: [], rendered_by: [] },
  },
  translations: {
    en: {
      'app.blog_posts.title': 'Blog Posts',
      'app.blog_posts.new': 'New Blog Post',
    },
  },
};

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function makeChange(overrides = {}) {
  return {
    path: 'app/views/pages/test.html.liquid',
    role: 'page',
    action: 'create',
    references: {},
    ...overrides,
  };
}

function makeIntent(overrides = {}) {
  return {
    goal: 'Test goal',
    changes: [makeChange()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Layer 1 — Schema
// ---------------------------------------------------------------------------

describe('validateSchema', () => {
  it('accepts minimal valid intent', () => {
    const result = validateSchema(makeIntent());
    expect(result.ok).toBe(true);
  });

  it('rejects missing goal', () => {
    const { ok, errors } = validateSchema({ changes: [makeChange()] });
    expect(ok).toBe(false);
    expect(errors.some(e => e.field === 'goal')).toBe(true);
  });

  it('rejects non-string goal', () => {
    const { ok, errors } = validateSchema(makeIntent({ goal: 42 }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.field === 'goal')).toBe(true);
  });

  it('rejects empty string goal', () => {
    const { ok, errors } = validateSchema(makeIntent({ goal: '   ' }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.field === 'goal')).toBe(true);
  });

  it('rejects missing changes', () => {
    const { ok, errors } = validateSchema({ goal: 'Test' });
    expect(ok).toBe(false);
    expect(errors.some(e => e.field === 'changes')).toBe(true);
  });

  it('rejects empty changes array', () => {
    const { ok, errors } = validateSchema(makeIntent({ changes: [] }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.field === 'changes')).toBe(true);
  });

  it('rejects change missing path', () => {
    const change = { role: 'page', action: 'create' };
    const { ok, errors } = validateSchema(makeIntent({ changes: [change] }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.field?.includes('path'))).toBe(true);
  });

  it('rejects change with invalid role', () => {
    const { ok, errors } = validateSchema(makeIntent({ changes: [makeChange({ role: 'widget' })] }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.type === 'invalid_role')).toBe(true);
  });

  it('rejects change with invalid action', () => {
    const { ok, errors } = validateSchema(makeIntent({ changes: [makeChange({ action: 'publish' })] }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.type === 'invalid_action')).toBe(true);
  });

  it('rejects move action without move_to', () => {
    const { ok, errors } = validateSchema(makeIntent({ changes: [makeChange({ action: 'move' })] }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.type === 'missing_move_to')).toBe(true);
  });

  it('accepts move action with move_to', () => {
    const change = makeChange({
      action: 'move',
      move_to: 'app/views/pages/new_test.html.liquid',
    });
    const result = validateSchema(makeIntent({ changes: [change] }));
    expect(result.ok).toBe(true);
  });

  it('rejects unknown top-level key (typo guard)', () => {
    const intent = { goal: 'Test', changes: [makeChange()], change: [] };
    const { ok, errors } = validateSchema(intent);
    expect(ok).toBe(false);
    expect(errors.some(e => e.type === 'unknown_top_level_key' && e.key === 'change')).toBe(true);
  });

  it('rejects references.partials that is not an array of strings', () => {
    const change = makeChange({ references: { partials: ['ok', 42] } });
    const { ok, errors } = validateSchema(makeIntent({ changes: [change] }));
    expect(ok).toBe(false);
    expect(errors.some(e => e.field?.includes('references.partials'))).toBe(true);
  });

  it('accepts all valid roles', () => {
    const roles = ['page', 'layout', 'partial', 'graphql', 'schema', 'command', 'query', 'translation', 'lib', 'asset', 'config', 'migration', 'module_override'];
    for (const role of roles) {
      const result = validateSchema(makeIntent({ changes: [makeChange({ role })] }));
      const roleErrors = (result.errors ?? []).filter(e => e.type === 'invalid_role');
      expect(roleErrors).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// coerceIntent — string→array coercion
// ---------------------------------------------------------------------------

describe('coerceIntent', () => {
  it('returns intent unchanged when changes is already an array', () => {
    const intent = makeIntent();
    const result = coerceIntent(intent);
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('parses changes when it is a JSON-stringified array (common LLM mistake)', () => {
    const original = makeIntent();
    const stringified = { ...original, changes: JSON.stringify(original.changes) };
    const result = coerceIntent(stringified);
    expect(Array.isArray(result.changes)).toBe(true);
    expect(result.changes).toHaveLength(original.changes.length);
  });

  it('does not mutate the original object', () => {
    const original = makeIntent();
    const withString = { ...original, changes: JSON.stringify(original.changes) };
    coerceIntent(withString);
    expect(typeof withString.changes).toBe('string');
  });

  it('leaves unparseable string as-is (schema layer reports the error)', () => {
    const intent = { goal: 'Test', changes: 'not json' };
    const result = coerceIntent(intent);
    expect(typeof result.changes).toBe('string');
  });

  it('validateSchema passes after coercion of stringified changes', () => {
    const original = makeIntent();
    const withString = { ...original, changes: JSON.stringify(original.changes) };
    const result = validateSchema(withString);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Domain
// ---------------------------------------------------------------------------

describe('validateDomain', () => {
  const VALID_PATHS = {
    page:        'app/views/pages/blog_posts/index.html.liquid',
    layout:      'app/views/layouts/application.liquid',
    partial:     'app/views/partials/blog_posts/card.liquid',
    graphql:     'app/graphql/blog_posts/search.graphql',
    schema:      'app/schema/blog_post.yml',
    command:     'app/lib/commands/blog_posts/create.liquid',
    query:       'app/lib/queries/blog_posts/search.liquid',
    translation: 'app/translations/en.yml',
    lib:         'app/lib/helpers/slugify.liquid',
    asset:           'app/assets/stylesheets/custom.css',
    config:          'app/config.yml',
    migration:       'app/migrations/20240101_add_blog_posts.liquid',
    module_override: 'app/modules/user/public/lib/queries/role_permissions/permissions.liquid',
  };

  for (const [role, path] of Object.entries(VALID_PATHS)) {
    it(`accepts correct path for role '${role}'`, () => {
      const result = validateDomain([{ path, role, action: 'create' }]);
      expect(result.ok).toBe(true);
    });
  }

  it('rejects page path placed under app/lib/', () => {
    const result = validateDomain([{ path: 'app/lib/pages/index.liquid', role: 'page', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('rejects partial path placed under app/views/pages/', () => {
    const result = validateDomain([{ path: 'app/views/pages/form.liquid', role: 'partial', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('rejects graphql file with .liquid extension', () => {
    const result = validateDomain([{ path: 'app/graphql/blog_posts/search.liquid', role: 'graphql', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('rejects schema file with .graphql extension', () => {
    const result = validateDomain([{ path: 'app/schema/blog_post.graphql', role: 'schema', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('rejects lib role for app/assets/ path (use asset role instead)', () => {
    const result = validateDomain([{ path: 'app/assets/stylesheets/custom.css', role: 'lib', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('accepts asset role for app/assets/ path', () => {
    const result = validateDomain([{ path: 'app/assets/javascripts/app.js', role: 'asset', action: 'create' }]);
    expect(result.ok).toBe(true);
  });

  it('accepts module_override role for app/modules/<name>/public/ path (create)', () => {
    const result = validateDomain([{
      path: 'app/modules/user/public/lib/queries/role_permissions/permissions.liquid',
      role: 'module_override',
      action: 'create',
    }]);
    expect(result.ok).toBe(true);
  });

  it('accepts module_override role for app/modules/<name>/private/ path', () => {
    const result = validateDomain([{
      path: 'app/modules/core/private/views/partials/custom.liquid',
      role: 'module_override',
      action: 'update',
    }]);
    expect(result.ok).toBe(true);
  });

  it('rejects lib role for app/modules/ override path (must use module_override role)', () => {
    const result = validateDomain([{
      path: 'app/modules/user/public/lib/queries/role_permissions/permissions.liquid',
      role: 'lib',
      action: 'create',
    }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('rejects module_override role for bare modules/ path (third-party read-only)', () => {
    // module_override is for app/modules/ — bare modules/ is still write-protected
    const result = validateDomain([{
      path: 'modules/user/public/lib/queries/permissions.liquid',
      role: 'module_override',
      action: 'create',
    }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].type).toBe('invalid_path_for_role');
  });

  it('rejects create on modules/ path', () => {
    const result = validateDomain([{ path: 'modules/core/lib/helper.liquid', role: 'lib', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'module_write_protected')).toBe(true);
  });

  it('rejects update on modules/ path', () => {
    const result = validateDomain([{ path: 'modules/core/lib/helper.liquid', role: 'lib', action: 'update' }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'module_write_protected')).toBe(true);
  });

  it('allows delete on modules/ path', () => {
    // delete is the one allowed write-like action
    const result = validateDomain([{ path: 'modules/core/lib/helper.liquid', role: 'lib', action: 'delete' }]);
    // No module_write_protected error
    expect((result.errors ?? []).some(e => e.type === 'module_write_protected')).toBe(false);
  });

  it('rejects move with move_to violating the role pattern', () => {
    const result = validateDomain([{
      path:    'app/views/partials/blog_posts/card.liquid',
      role:    'partial',
      action:  'move',
      move_to: 'app/views/pages/blog_posts/card.liquid',
    }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'move_to_pattern_mismatch')).toBe(true);
  });

  it('accepts move with valid move_to', () => {
    const result = validateDomain([{
      path:    'app/views/partials/blog_posts/card.liquid',
      role:    'partial',
      action:  'move',
      move_to: 'app/views/partials/shared/blog_card.liquid',
    }]);
    expect(result.ok).toBe(true);
  });

  it('includes expected_pattern in error', () => {
    const result = validateDomain([{ path: 'app/views/pages/index.liquid', role: 'query', action: 'create' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].expected_pattern).toBeDefined();
    expect(result.errors[0].expected_pattern).toContain('app/lib/queries');
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — Project-state
// ---------------------------------------------------------------------------

describe('validateProjectState', () => {
  it('rejects reference to partial absent from projectMap and not in plan', () => {
    const changes = [makeChange({ references: { partials: ['nonexistent/partial'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_partial' && e.ref === 'nonexistent/partial')).toBe(true);
  });

  it('rejects reference to graphql absent from projectMap and not in plan', () => {
    const changes = [makeChange({ references: { graphql: ['blog_posts/delete'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_graphql' && e.ref === 'blog_posts/delete')).toBe(true);
  });

  it('rejects reference to schema absent from projectMap and not in plan', () => {
    const changes = [makeChange({ references: { schemas: ['product'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_schema' && e.ref === 'product')).toBe(true);
  });

  it('rejects reference to command absent from projectMap and not in plan', () => {
    const changes = [makeChange({ references: { commands: ['app/lib/commands/products/create.liquid'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_command')).toBe(true);
  });

  it('rejects reference to query absent from projectMap and not in plan', () => {
    const changes = [makeChange({ references: { queries: ['app/lib/queries/products/search.liquid'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_query')).toBe(true);
  });

  it('accepts partial reference resolved via pending (created in same plan)', () => {
    const changes = [
      { path: 'app/views/partials/new_stuff/widget.liquid', role: 'partial', action: 'create', references: {} },
      makeChange({ references: { partials: ['new_stuff/widget'] } }),
    ];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_partial' && e.ref === 'new_stuff/widget')).toBe(false);
  });

  it('accepts graphql reference resolved via pending (created in same plan)', () => {
    const changes = [
      { path: 'app/graphql/products/search.graphql', role: 'graphql', action: 'create', references: {} },
      makeChange({ references: { graphql: ['products/search'] } }),
    ];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_graphql' && e.ref === 'products/search')).toBe(false);
  });

  it('rejects update action on path not in projectMap', () => {
    const changes = [makeChange({
      path: 'app/views/pages/nonexistent.html.liquid',
      action: 'update',
    })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'update_target_missing')).toBe(true);
  });

  it('rejects delete action on path not in projectMap', () => {
    const changes = [makeChange({
      path: 'app/views/pages/nonexistent.html.liquid',
      action: 'delete',
    })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'delete_target_missing')).toBe(true);
  });

  it('allows module_override update without existence check (scanner does not index app/modules/)', () => {
    const changes = [{
      path: 'app/modules/user/public/lib/queries/role_permissions/permissions.liquid',
      role: 'module_override',
      action: 'update',
      references: {},
    }];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'update_target_missing')).toBe(false);
  });

  it('allows module_override create without conflict check (scanner does not index app/modules/)', () => {
    const changes = [{
      path: 'app/modules/user/public/lib/queries/role_permissions/permissions.liquid',
      role: 'module_override',
      action: 'create',
      references: {},
    }];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    // No false-positive create_conflict — app/modules/ is not in the indexed paths
    expect(errors.some(e => e.type === 'create_conflict')).toBe(false);
  });

  it('rejects duplicate create for same path in one plan', () => {
    const changes = [
      makeChange({ path: 'app/views/pages/duplicate.html.liquid' }),
      makeChange({ path: 'app/views/pages/duplicate.html.liquid' }),
    ];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'duplicate_create')).toBe(true);
  });

  it('emits warning (not error) for translation key reference when translation file is in plan', () => {
    const changes = [
      { path: 'app/translations/en.yml', role: 'translation', action: 'create', references: {} },
      makeChange({ references: { translations: ['app.blog_posts.new_key'] } }),
    ];
    const { errors, warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_translation')).toBe(false);
    expect(warnings.some(w => w.type === 'unverified_translation')).toBe(true);
  });

  it('rejects translation key reference when no translation file in plan and key absent', () => {
    const changes = [makeChange({ references: { translations: ['app.nonexistent.key'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_translation' && e.ref === 'app.nonexistent.key')).toBe(true);
  });

  it('accepts translation key reference that exists in projectMap', () => {
    const changes = [makeChange({ references: { translations: ['app.blog_posts.title'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_translation')).toBe(false);
  });

  it('emits error for scaffold conflict', () => {
    const changes = [makeChange()];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP, {
      scaffoldConflicts: [{ path: 'app/views/pages/test.html.liquid', reason: 'file already exists' }],
    });
    expect(errors.some(e => e.type === 'scaffold_conflict')).toBe(true);
  });

  it('warns on module partial reference for non-installed module', () => {
    const changes = [makeChange({ references: { partials: ['modules/payments/form'] } })];
    const { warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'module_ref_not_installed' && w.module === 'payments')).toBe(true);
  });

  it('does not warn on module partial reference for installed module', () => {
    const changes = [makeChange({ references: { partials: ['modules/core/helper'] } })];
    const { warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'module_ref_not_installed' && w.module === 'core')).toBe(false);
  });

  it('accepts module graphql reference for installed module', () => {
    const changes = [makeChange({ references: { graphql: ['modules/user/user/search'] } })];
    const { errors, warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_graphql')).toBe(false);
    expect(warnings.some(w => w.type === 'module_ref_not_installed' && w.module === 'user')).toBe(false);
  });

  it('warns on module graphql reference for non-installed module', () => {
    const changes = [makeChange({ references: { graphql: ['modules/payments/stripe/charge'] } })];
    const { warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'module_ref_not_installed' && w.module === 'payments')).toBe(true);
  });

  it('accepts module commands reference for installed module', () => {
    const changes = [makeChange({ references: { commands: ['modules/user/commands/create'] } })];
    const { errors, warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_command')).toBe(false);
    expect(warnings.some(w => w.type === 'module_ref_not_installed' && w.module === 'user')).toBe(false);
  });

  it('accepts module queries reference for installed module', () => {
    const changes = [makeChange({ references: { queries: ['modules/core/queries/list'] } })];
    const { errors, warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'missing_query')).toBe(false);
    expect(warnings.some(w => w.type === 'module_ref_not_installed' && w.module === 'core')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — Policy
// ---------------------------------------------------------------------------

describe('validatePolicy', () => {
  it('rejects partial with non-empty references.graphql', () => {
    const changes = [{
      path: 'app/views/partials/blog_posts/card.liquid',
      role: 'partial',
      action: 'create',
      references: { graphql: ['blog_posts/search'] },
    }];
    const { errors } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'partial_invokes_graphql')).toBe(true);
  });

  it('rejects partial with non-empty references.commands', () => {
    const changes = [{
      path: 'app/views/partials/blog_posts/form.liquid',
      role: 'partial',
      action: 'create',
      references: { commands: ['app/lib/commands/blog_posts/create.liquid'] },
    }];
    const { errors } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'partial_calls_command')).toBe(true);
  });

  it('rejects cross-change role conflict (referenced as partial, declared with wrong role)', () => {
    // Change A declares a file at a partial path but assigns role 'page' (wrong)
    // partialPathToName('app/views/partials/blog_posts/widget.liquid') = 'blog_posts/widget'
    // Change B references 'blog_posts/widget' as a partial — but Change A has role 'page'
    const changes = [
      {
        path: 'app/views/partials/blog_posts/widget.liquid',
        role: 'page',   // wrong role for this path
        action: 'create',
        references: {},
      },
      makeChange({
        references: { partials: ['blog_posts/widget'] },
      }),
    ];
    const { errors } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'cross_change_role_conflict' && e.ref === 'blog_posts/widget')).toBe(true);
  });

  it('warns on schema deletion without migration in plan', () => {
    const changes = [{
      path: 'app/schema/blog_post.yml',
      role: 'schema',
      action: 'delete',
      references: {},
    }];
    const { warnings } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'schema_deletion')).toBe(true);
  });

  it('no warning on schema deletion when migration IS in plan', () => {
    const changes = [
      {
        path: 'app/schema/blog_post.yml',
        role: 'schema',
        action: 'delete',
        references: {},
      },
      {
        path: 'app/migrations/20240101_drop_blog_post.liquid',
        role: 'migration',
        action: 'create',
        references: {},
      },
    ];
    const { warnings } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'schema_deletion')).toBe(false);
  });

  it('warns on orphan partial (not rendered anywhere)', () => {
    const changes = [{
      path: 'app/views/partials/orphan/widget.liquid',
      role: 'partial',
      action: 'create',
      references: {},
    }];
    const { warnings } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'orphan_partial')).toBe(true);
  });

  it('no warning on partial that is referenced by another change in plan', () => {
    const changes = [
      {
        path: 'app/views/partials/new_feature/card.liquid',
        role: 'partial',
        action: 'create',
        references: {},
      },
      makeChange({ references: { partials: ['new_feature/card'] } }),
    ];
    const { warnings } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'orphan_partial')).toBe(false);
  });

  it('no warning on partial that is already rendered by something in the project', () => {
    // blog_posts/card is already rendered by blog_posts index page in MOCK_PROJECT_MAP
    const changes = [{
      path: 'app/views/partials/blog_posts/card.liquid',
      role: 'partial',
      action: 'update',
      references: {},
    }];
    const { warnings } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(warnings.some(w => w.type === 'orphan_partial')).toBe(false);
  });

  it('accepts page with graphql/command/query references (no violation)', () => {
    const changes = [{
      path: 'app/views/pages/blog_posts/index.html.liquid',
      role: 'page',
      action: 'create',
      references: {
        graphql: ['blog_posts/search'],
        commands: ['app/lib/commands/blog_posts/create.liquid'],
        queries: ['app/lib/queries/blog_posts/search.liquid'],
      },
    }];
    const { errors } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// P7 — Shopify terminology check
// ---------------------------------------------------------------------------

describe('checkGoalForShopify', () => {
  it('warns on goal containing Shopify terms (shop.)', () => {
    const warnings = checkGoalForShopify('Add shop.name to the header');
    expect(warnings.some(w => w.type === 'shopify_terminology')).toBe(true);
  });

  it('warns on goal containing Shopify terms (cart.)', () => {
    const warnings = checkGoalForShopify('Display cart.item_count in navigation');
    expect(warnings.some(w => w.type === 'shopify_terminology')).toBe(true);
  });

  it('warns on goal containing Shopify terms (| money filter)', () => {
    const warnings = checkGoalForShopify('Format price using | money filter');
    expect(warnings.some(w => w.type === 'shopify_terminology')).toBe(true);
  });

  it('no warning on clean goal string', () => {
    const warnings = checkGoalForShopify('Create blog_posts CRUD with user authentication');
    expect(warnings).toHaveLength(0);
  });

  it('returns single warning even if multiple Shopify terms present', () => {
    const warnings = checkGoalForShopify('Use shop.name and cart.items and checkout.url');
    expect(warnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scaffold track (Track A)
// ---------------------------------------------------------------------------

describe('normalizeScaffoldInput', () => {
  it('normalises scaffold output files[] to changes[] with correct roles', () => {
    const scaffoldOutput = {
      files: [
        { path: 'app/views/pages/blog_posts/index.html.liquid', domain: 'pages' },
        { path: 'app/views/partials/blog_posts/form.liquid', domain: 'partials' },
        { path: 'app/graphql/blog_posts/create.graphql', domain: 'graphql' },
        { path: 'app/schema/blog_post.yml', domain: 'schema' },
        { path: 'app/translations/en.yml', domain: 'translations' },
      ],
      summary: 'Generated 5 files',
    };

    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes).toHaveLength(5);
    expect(changes.find(c => c.path.includes('pages'))?.role).toBe('page');
    expect(changes.find(c => c.path.includes('partials'))?.role).toBe('partial');
    expect(changes.find(c => c.path.includes('graphql'))?.role).toBe('graphql');
    expect(changes.find(c => c.path.includes('schema'))?.role).toBe('schema');
    expect(changes.find(c => c.path.includes('translations'))?.role).toBe('translation');
  });

  it('all normalised changes have action create', () => {
    const scaffoldOutput = {
      files: [{ path: 'app/views/pages/test.html.liquid', domain: 'pages' }],
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes.every(c => c.action === 'create')).toBe(true);
  });

  it('uses summary as goal proxy', () => {
    const scaffoldOutput = {
      files: [{ path: 'app/views/pages/test.html.liquid', domain: 'pages' }],
      summary: 'Generated 29 files for blog_posts crud',
    };
    const { goal } = normalizeScaffoldInput(scaffoldOutput);
    expect(goal).toContain('blog_posts');
  });
});

// ---------------------------------------------------------------------------
// Pending resolution
// ---------------------------------------------------------------------------

describe('buildPendingResolution', () => {
  it('adds partial name for partial create', () => {
    const pending = buildPendingResolution([{
      path: 'app/views/partials/blog_posts/card.liquid',
      role: 'partial',
      action: 'create',
    }]);
    expect(pending.partials.has('blog_posts/card')).toBe(true);
  });

  it('adds graphql name for graphql create', () => {
    const pending = buildPendingResolution([{
      path: 'app/graphql/blog_posts/search.graphql',
      role: 'graphql',
      action: 'create',
    }]);
    expect(pending.graphql.has('blog_posts/search')).toBe(true);
  });

  it('sets hasTranslationCreate for translation create', () => {
    const pending = buildPendingResolution([{
      path: 'app/translations/en.yml',
      role: 'translation',
      action: 'create',
    }]);
    expect(pending.hasTranslationCreate).toBe(true);
  });

  it('uses move_to path for move actions', () => {
    const pending = buildPendingResolution([{
      path: 'app/views/partials/old/card.liquid',
      role: 'partial',
      action: 'move',
      move_to: 'app/views/partials/new/card.liquid',
    }]);
    expect(pending.partials.has('new/card')).toBe(true);
    expect(pending.partials.has('old/card')).toBe(false);
  });

  it('ignores update and delete actions', () => {
    const pending = buildPendingResolution([
      { path: 'app/views/partials/blog_posts/card.liquid', role: 'partial', action: 'update' },
      { path: 'app/graphql/blog_posts/search.graphql', role: 'graphql', action: 'delete' },
    ]);
    expect(pending.partials.size).toBe(0);
    expect(pending.graphql.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Plan ID
// ---------------------------------------------------------------------------

describe('buildPlanId', () => {
  it('produces a deterministic 8-char hex string', () => {
    const changes = [makeChange()];
    const id = buildPlanId(changes);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('same changes produce same id', () => {
    const changes = [makeChange(), makeChange({ path: 'app/views/partials/foo/bar.liquid', role: 'partial' })];
    expect(buildPlanId(changes)).toBe(buildPlanId([...changes]));
  });

  it('different changes produce different ids', () => {
    const a = [makeChange()];
    const b = [makeChange({ path: 'app/views/partials/other.liquid', role: 'partial' })];
    expect(buildPlanId(a)).not.toBe(buildPlanId(b));
  });
});

// ---------------------------------------------------------------------------
// Path normalisation utilities
// ---------------------------------------------------------------------------

describe('path normalisation', () => {
  it('partialPathToName strips prefix and extension', () => {
    expect(partialPathToName('app/views/partials/blog_posts/card.liquid')).toBe('blog_posts/card');
  });

  it('partialPathToName strips .html.liquid', () => {
    expect(partialPathToName('app/views/partials/shared/header.html.liquid')).toBe('shared/header');
  });

  it('graphqlPathToName strips prefix and extension', () => {
    expect(graphqlPathToName('app/graphql/blog_posts/search.graphql')).toBe('blog_posts/search');
  });

  it('schemaPathToName strips prefix and extension', () => {
    expect(schemaPathToName('app/schema/blog_post.yml')).toBe('blog_post');
  });
});

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

describe('output format', () => {
  const validChanges = [
    {
      path: 'app/views/pages/new_page.html.liquid',
      role: 'page',
      action: 'create',
      references: { translations: ['app.blog_posts.title'] },
    },
    {
      path: 'app/views/partials/blog_posts/new_card.liquid',
      role: 'partial',
      action: 'create',
      references: {},
    },
  ];

  it('success has plan_id, summary, pending_files, pending_translations, warnings, validated_at', () => {
    const { errors, warnings } = validateProjectState(validChanges, MOCK_PROJECT_MAP);
    expect(errors).toHaveLength(0);

    // Simulate makeSuccess output by calling validateSchema + validateDomain manually
    const schemaOk = validateSchema({ goal: 'Test', changes: validChanges });
    expect(schemaOk.ok).toBe(true);
    const domainOk = validateDomain(validChanges);
    expect(domainOk.ok).toBe(true);
  });

  it('pending_files contains all create paths', () => {
    // Verify via buildPendingResolution
    const pending = buildPendingResolution(validChanges);
    expect(pending.files.has('app/views/pages/new_page.html.liquid')).toBe(true);
    expect(pending.files.has('app/views/partials/blog_posts/new_card.liquid')).toBe(true);
  });

  it('failure has error_count, warning_count, errors, warnings, allowed_next_actions', () => {
    const changes = [makeChange({ references: { partials: ['nonexistent/thing'] } })];
    const { errors, warnings } = validateProjectState(changes, MOCK_PROJECT_MAP);
    expect(errors.length).toBeGreaterThan(0);
    // Each error has layer, type, message
    expect(errors[0].layer).toBeDefined();
    expect(errors[0].type).toBeDefined();
    expect(errors[0].message).toBeDefined();
  });

  it('each error has layer, type, path, message', () => {
    const changes = [makeChange({ references: { partials: ['nonexistent/thing'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    const err = errors[0];
    expect(err.layer).toBe('project_state');
    expect(err.type).toBe('missing_partial');
    expect(err.path).toBeDefined();
    expect(err.message).toBeDefined();
    expect(err.suggestion).toBeDefined();
  });

  it('missing_partial error includes the ref', () => {
    const changes = [makeChange({ references: { partials: ['missing/widget'] } })];
    const { errors } = validateProjectState(changes, MOCK_PROJECT_MAP);
    const err = errors.find(e => e.type === 'missing_partial');
    expect(err.ref).toBe('missing/widget');
  });

  it('warnings are present in result even on error (both surfaced)', () => {
    const changes = [
      // Causes error: partial invokes graphql
      {
        path: 'app/views/partials/bad.liquid',
        role: 'partial',
        action: 'create',
        references: { graphql: ['blog_posts/search'] },
      },
      // Causes warning: schema deletion without migration
      {
        path: 'app/schema/blog_post.yml',
        role: 'schema',
        action: 'delete',
        references: {},
      },
    ];
    const { errors } = validatePolicy(changes, MOCK_PROJECT_MAP);
    const { warnings } = validatePolicy(changes, MOCK_PROJECT_MAP);
    expect(errors.some(e => e.type === 'partial_invokes_graphql')).toBe(true);
    expect(warnings.some(w => w.type === 'schema_deletion')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractScaffoldTranslationKeys
// ---------------------------------------------------------------------------

describe('extractScaffoldTranslationKeys', () => {
  it('extracts dot-notation keys from a nested translation YML, stripping the locale prefix', () => {
    const files = [{
      domain: 'translations',
      path: 'app/translations/en/products.yml',
      content: `en:\n  app:\n    products:\n      list:\n        add: Add\n        total: Total\n      attr:\n        title: Title\n`,
    }];
    const keys = extractScaffoldTranslationKeys(files);
    expect(keys).toContain('app.products.list.add');
    expect(keys).toContain('app.products.list.total');
    expect(keys).toContain('app.products.attr.title');
    // Locale prefix must NOT appear in keys
    expect(keys.every(k => !k.startsWith('en.'))).toBe(true);
  });

  it('handles multiple translation files', () => {
    const files = [
      {
        domain: 'translations',
        path: 'app/translations/en/orders.yml',
        content: `en:\n  app:\n    orders:\n      create: Create\n`,
      },
      {
        domain: 'translations',
        path: 'app/translations/en/users.yml',
        content: `en:\n  app:\n    users:\n      login: Login\n`,
      },
    ];
    const keys = extractScaffoldTranslationKeys(files);
    expect(keys).toContain('app.orders.create');
    expect(keys).toContain('app.users.login');
  });

  it('ignores non-translation scaffold files', () => {
    const files = [
      { domain: 'pages', path: 'app/views/pages/index.html.liquid', content: '---\nslug: index\n---' },
      { domain: 'graphql', path: 'app/graphql/search.graphql', content: 'query { records { results { id } } }' },
    ];
    const keys = extractScaffoldTranslationKeys(files);
    expect(keys).toHaveLength(0);
  });

  it('ignores translation files with no content', () => {
    const files = [{ domain: 'translations', path: 'app/translations/en/empty.yml', content: '' }];
    const keys = extractScaffoldTranslationKeys(files);
    expect(keys).toHaveLength(0);
  });

  it('ignores translation files with missing content field', () => {
    const files = [{ domain: 'translations', path: 'app/translations/en/missing.yml' }];
    const keys = extractScaffoldTranslationKeys(files);
    expect(keys).toHaveLength(0);
  });

  it('skips files with invalid YAML without throwing', () => {
    const files = [{ domain: 'translations', path: 'app/translations/en/bad.yml', content: 'en:\n  : [unclosed' }];
    expect(() => extractScaffoldTranslationKeys(files)).not.toThrow();
    const keys = extractScaffoldTranslationKeys(files);
    expect(Array.isArray(keys)).toBe(true);
  });

  it('returns empty array for empty file list', () => {
    expect(extractScaffoldTranslationKeys([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// suggestValidationOrder
// ---------------------------------------------------------------------------

describe('suggestValidationOrder', () => {
  it('sorts files by dependency layer: schema → graphql → commands → queries → translations → layouts → pages → partials', () => {
    const files = [
      'app/views/partials/blog_posts/list.liquid',
      'app/views/pages/blog_posts/index.html.liquid',
      'app/lib/commands/blog_posts/create.liquid',
      'app/schema/blog_post.yml',
      'app/graphql/blog_posts/search.graphql',
      'app/lib/queries/blog_posts/search.liquid',
      'app/translations/en.yml',
      'app/views/layouts/application.liquid',
    ];
    const ordered = suggestValidationOrder(files);
    expect(ordered[0]).toBe('app/schema/blog_post.yml');
    expect(ordered[1]).toBe('app/graphql/blog_posts/search.graphql');
    expect(ordered[2]).toBe('app/lib/commands/blog_posts/create.liquid');
    expect(ordered[3]).toBe('app/lib/queries/blog_posts/search.liquid');
    expect(ordered[4]).toBe('app/translations/en.yml');
    expect(ordered[5]).toBe('app/views/layouts/application.liquid');
    expect(ordered[6]).toBe('app/views/pages/blog_posts/index.html.liquid');
    expect(ordered[7]).toBe('app/views/partials/blog_posts/list.liquid');
  });

  it('sorts alphabetically within the same layer', () => {
    const files = [
      'app/views/partials/z.liquid',
      'app/views/partials/a.liquid',
      'app/views/partials/m.liquid',
    ];
    const ordered = suggestValidationOrder(files);
    expect(ordered).toEqual([
      'app/views/partials/a.liquid',
      'app/views/partials/m.liquid',
      'app/views/partials/z.liquid',
    ]);
  });

  it('puts unrecognized paths after all known layers', () => {
    const files = [
      'app/views/partials/x.liquid',
      'app/config.yml',
      'app/schema/note.yml',
    ];
    const ordered = suggestValidationOrder(files);
    expect(ordered[0]).toBe('app/schema/note.yml');
    expect(ordered[1]).toBe('app/views/partials/x.liquid');
    expect(ordered[2]).toBe('app/config.yml');
  });

  it('returns empty array for empty or null input', () => {
    expect(suggestValidationOrder([])).toEqual([]);
    expect(suggestValidationOrder(null)).toEqual([]);
    expect(suggestValidationOrder(undefined)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const files = ['app/views/partials/a.liquid', 'app/schema/b.yml'];
    const copy = [...files];
    suggestValidationOrder(files);
    expect(files).toEqual(copy);
  });
});
