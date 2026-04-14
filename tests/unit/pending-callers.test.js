/**
 * Phase 1.5 — partitionCallersByPending: separate plan-local callers
 * (which will be updated in the same plan) from external callers that
 * still need the agent's attention.
 */

import { describe, it, expect } from 'bun:test';

import { partitionCallersByPending } from '../../src/core/pending-callers.js';

describe('partitionCallersByPending', () => {
  it('returns all callers as remaining when pending_files is empty', () => {
    const result = partitionCallersByPending(
      ['app/views/pages/posts/index.html.liquid', 'app/views/pages/posts/show.html.liquid'],
      [],
    );
    expect(result.pending).toEqual([]);
    expect(result.remaining).toHaveLength(2);
  });

  it('moves callers present in pending_files into pending', () => {
    const callers = [
      'app/views/pages/posts/index.html.liquid',
      'app/views/pages/posts/show.html.liquid',
      'app/views/partials/widgets/hero.liquid',
    ];
    const pending = [
      'app/views/pages/posts/index.html.liquid',
      'app/views/pages/posts/show.html.liquid',
    ];
    const result = partitionCallersByPending(callers, pending);
    expect(result.pending).toHaveLength(2);
    expect(result.remaining).toEqual(['app/views/partials/widgets/hero.liquid']);
  });

  it('matches by suffix when pending_files uses absolute-ish paths', () => {
    const callers = ['app/views/pages/posts/index.html.liquid'];
    const pending = ['/tmp/project/app/views/pages/posts/index.html.liquid'];
    const result = partitionCallersByPending(callers, pending);
    expect(result.pending).toEqual(callers);
    expect(result.remaining).toEqual([]);
  });

  it('matches by suffix when callers are absolute and pending is relative', () => {
    const callers = ['/tmp/project/app/views/pages/posts/index.html.liquid'];
    const pending = ['app/views/pages/posts/index.html.liquid'];
    const result = partitionCallersByPending(callers, pending);
    expect(result.pending).toEqual(callers);
    expect(result.remaining).toEqual([]);
  });

  it('returns both arrays empty when callers is empty', () => {
    const result = partitionCallersByPending([], ['a.liquid']);
    expect(result.pending).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it('handles undefined inputs gracefully', () => {
    expect(partitionCallersByPending(undefined, undefined)).toEqual({ pending: [], remaining: [] });
    expect(partitionCallersByPending(null, null)).toEqual({ pending: [], remaining: [] });
  });
});
