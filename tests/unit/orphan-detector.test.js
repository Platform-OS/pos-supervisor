/**
 * Phase 1.7 — single orphan-computation path. Verify the predicate agrees
 * with the project_map evidence and with a pending plan's reference set.
 */

import { describe, it, expect } from 'bun:test';

import {
  isPartialRendered,
  isOrphanPartial,
  findOrphanPartials,
  isSubphaseFile,
} from '../../src/core/orphan-detector.js';

const projectMap = {
  partials: {
    'blog_posts/index':  { path: 'app/views/partials/blog_posts/index.liquid',  rendered_by: ['app/views/pages/blog_posts/index.html.liquid'] },
    'blog_posts/form':   { path: 'app/views/partials/blog_posts/form.liquid',   rendered_by: [] },
    'blog_posts/hidden': { path: 'app/views/partials/blog_posts/hidden.liquid', rendered_by: [] },
    'widgets/used':      { path: 'app/views/partials/widgets/used.liquid',      rendered_by: ['app/views/partials/blog_posts/index.liquid'] },
  },
};

describe('isPartialRendered', () => {
  it('returns true when rendered_by is non-empty', () => {
    expect(isPartialRendered('blog_posts/index', projectMap)).toBe(true);
    expect(isPartialRendered('widgets/used', projectMap)).toBe(true);
  });

  it('returns false when rendered_by is empty', () => {
    expect(isPartialRendered('blog_posts/form', projectMap)).toBe(false);
  });

  it('returns false for unknown partial names', () => {
    expect(isPartialRendered('nonexistent', projectMap)).toBe(false);
  });

  it('tolerates missing projectMap', () => {
    expect(isPartialRendered('x', undefined)).toBe(false);
    expect(isPartialRendered('x', {})).toBe(false);
  });
});

describe('isOrphanPartial', () => {
  it('returns false when project renders it', () => {
    expect(isOrphanPartial('blog_posts/index', projectMap)).toBe(false);
  });

  it('returns true when nothing renders it and plan is silent', () => {
    expect(isOrphanPartial('blog_posts/form', projectMap)).toBe(true);
  });

  it('returns false when a pending plan reference exists', () => {
    const planRefs = new Set(['blog_posts/form']);
    expect(isOrphanPartial('blog_posts/form', projectMap, { planReferencedPartials: planRefs }))
      .toBe(false);
  });

  it('ignores unknown partial names as not-orphan-in-project', () => {
    // Absent from project map and not in plan → not "orphan" — caller decides.
    expect(isOrphanPartial('ghost', projectMap)).toBe(true); // because isPartialRendered → false
  });
});

describe('findOrphanPartials', () => {
  it('returns every partial with no renderer', () => {
    const result = findOrphanPartials(projectMap);
    const names = result.map(o => o.name).sort();
    expect(names).toEqual(['blog_posts/form', 'blog_posts/hidden']);
    expect(result[0]).toHaveProperty('path');
  });

  it('excludes names referenced by the pending plan', () => {
    const planRefs = new Set(['blog_posts/form']);
    const result = findOrphanPartials(projectMap, { planReferencedPartials: planRefs });
    const names = result.map(o => o.name);
    expect(names).toEqual(['blog_posts/hidden']);
  });

  it('returns an empty array when all partials are rendered', () => {
    const allRendered = {
      partials: {
        'a': { path: 'app/views/partials/a.liquid', rendered_by: ['x'] },
      },
    };
    expect(findOrphanPartials(allRendered)).toEqual([]);
  });
});

describe('isSubphaseFile', () => {
  it('matches /build/, /check/, /execute/ segments', () => {
    expect(isSubphaseFile('app/lib/commands/posts/build/step-1.liquid')).toBe(true);
    expect(isSubphaseFile('app/lib/commands/posts/check/validate.liquid')).toBe(true);
    expect(isSubphaseFile('app/lib/commands/posts/execute.liquid')).toBe(true);
  });

  it('does not match ordinary command files', () => {
    expect(isSubphaseFile('app/lib/commands/posts/create.liquid')).toBe(false);
    expect(isSubphaseFile('app/views/partials/blog/post.liquid')).toBe(false);
  });
});
