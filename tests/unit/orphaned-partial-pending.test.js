/**
 * Phase 1.4 — OrphanedPartial respects the pending set.
 *
 * Contract: when the validated file is a partial and a multi-file creation
 * plan is in flight (pending_files or pending_pages non-empty), suppress
 * OrphanedPartial. Callers in the plan may not be on disk yet, so the
 * orphan determination is a guess. Info diagnostic surfaces the reason.
 */

import { describe, it, expect } from 'bun:test';

import { runDiagnosticPipeline } from '../../src/core/diagnostic-pipeline.js';

function orphanError(line = 1, message = 'Partial is not rendered anywhere') {
  return { check: 'OrphanedPartial', severity: 'error', line, message };
}

function makeResult(errors = [], warnings = [], infos = []) {
  return { errors: [...errors], warnings: [...warnings], infos: [...infos] };
}

describe('suppressOrphanedPartial — pending set', () => {
  it('suppresses OrphanedPartial when the validated partial is itself in pending_files', () => {
    const filePath = 'app/views/partials/posts/card.liquid';
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath,
      content: '<div>{{ title }}</div>\n',
      pendingFiles: [filePath, 'app/views/pages/posts/index.html.liquid'],
    });
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:OrphanedPartialSuppressed');
    expect(info).toBeTruthy();
    expect(info.reason).toBe('pending-plan');
  });

  it('suppresses when a pending page/partial/layout exists even if the validated file is already written', () => {
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/posts/card.liquid',
      content: '<div>{{ title }}</div>\n',
      pendingFiles: ['app/views/pages/posts/index.html.liquid'],
    });
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(0);
    expect(result.infos.find(i => i.check === 'pos-supervisor:OrphanedPartialSuppressed'))
      .toBeTruthy();
  });

  it('suppresses when pending_pages is non-empty', () => {
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/posts/card.liquid',
      content: '<div>{{ title }}</div>\n',
      pendingFiles: [],
      pendingPages: ['app/views/pages/posts/index.html.liquid'],
    });
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(0);
  });

  it('DOES NOT suppress when no pending state and file is a plain partial (real orphan)', () => {
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/posts/card.liquid',
      content: '<div>{{ title }}</div>\n',
    });
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(1);
    expect(result.infos.find(i => i.check === 'pos-supervisor:OrphanedPartialSuppressed'))
      .toBeUndefined();
  });

  it('preserves commands/queries exemption with an info advisory', () => {
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath: 'app/lib/commands/posts/create.liquid',
      content: '{% assign x = 1 %}\n',
    });
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:OrphanedPartialSuppressed');
    expect(info).toBeTruthy();
    expect(info.reason).toBe('lib-target');
  });

  it('preserves commands/queries exemption for queries path', () => {
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath: 'app/lib/queries/posts/search.liquid',
      content: '{% graphql q = "x" %}\n',
    });
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(0);
  });

  it('only suppresses when pending state plausibly contains callers (pages/partials/layouts)', () => {
    // Pending state is non-empty but has no plausible callers — e.g. just a translation file.
    const result = makeResult([orphanError()]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/posts/card.liquid',
      content: '<div>{{ title }}</div>\n',
      pendingFiles: ['app/translations/en.yml'],
    });
    // No plausible callers → real orphan stays.
    expect(result.errors.filter(e => e.check === 'OrphanedPartial')).toHaveLength(1);
  });
});
