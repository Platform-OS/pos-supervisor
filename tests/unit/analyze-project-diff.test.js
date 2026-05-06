import { describe, it, expect } from 'bun:test';
import {
  computeBlockingFiles,
  buildDiagnosticSnapshot,
  computeDiffFromLastRun,
} from '../../src/tools/analyze-project.js';

// ---------------------------------------------------------------------------
// computeBlockingFiles
// ---------------------------------------------------------------------------

describe('computeBlockingFiles', () => {
  it('returns files with lint errors', () => {
    const fileResults = [
      { path: 'app/views/pages/a.liquid', errors: 2, warnings: 1 },
      { path: 'app/views/pages/b.liquid', errors: 0, warnings: 3 },
    ];
    const result = computeBlockingFiles(fileResults, []);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('app/views/pages/a.liquid');
    expect(result[0].lint_errors).toBe(2);
    expect(result[0].integrity_errors).toBe(0);
    expect(result[0].total).toBe(2);
    expect(result[0].checks).toEqual([]);
  });

  it('includes files with integrity errors only', () => {
    const integrity = [
      { severity: 'error', source: 'app/views/partials/x.liquid', type: 'broken_render', message: 'broken' },
    ];
    const result = computeBlockingFiles([], integrity);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('app/views/partials/x.liquid');
    expect(result[0].lint_errors).toBe(0);
    expect(result[0].integrity_errors).toBe(1);
    expect(result[0].checks).toEqual(['broken_render']);
  });

  it('merges lint and integrity errors for the same file', () => {
    const fileResults = [
      { path: 'app/views/pages/a.liquid', errors: 1, warnings: 0 },
    ];
    const integrity = [
      { severity: 'error', source: 'app/views/pages/a.liquid', type: 'missing_graphql', message: 'missing' },
      { severity: 'error', source: 'app/views/pages/a.liquid', type: 'broken_render', message: 'broken' },
    ];
    const result = computeBlockingFiles(fileResults, integrity);
    expect(result).toHaveLength(1);
    expect(result[0].lint_errors).toBe(1);
    expect(result[0].integrity_errors).toBe(2);
    expect(result[0].total).toBe(3);
    expect(result[0].checks).toContain('missing_graphql');
    expect(result[0].checks).toContain('broken_render');
  });

  it('ignores integrity warnings', () => {
    const integrity = [
      { severity: 'warning', source: 'app/views/partials/x.liquid', type: 'orphan_partial', message: 'orphan' },
    ];
    expect(computeBlockingFiles([], integrity)).toHaveLength(0);
  });

  it('sorts by total descending — worst offenders first', () => {
    const fileResults = [
      { path: 'app/a.liquid', errors: 1, warnings: 0 },
      { path: 'app/b.liquid', errors: 5, warnings: 0 },
      { path: 'app/c.liquid', errors: 3, warnings: 0 },
    ];
    const result = computeBlockingFiles(fileResults, []);
    expect(result.map(r => r.path)).toEqual(['app/b.liquid', 'app/c.liquid', 'app/a.liquid']);
  });

  it('returns empty array when no files have errors', () => {
    const fileResults = [
      { path: 'app/a.liquid', errors: 0, warnings: 5 },
    ];
    expect(computeBlockingFiles(fileResults, [])).toHaveLength(0);
  });

  it('extracts check names from allResults when provided', () => {
    const fileResults = [
      { path: 'app/views/layouts/application.liquid', errors: 1, warnings: 0 },
    ];
    const allResults = {
      errors: [
        { severity: 'error', _filePath: '/project/app/views/layouts/application.liquid', check: 'MetadataParamsCheck', message: 'Required parameter clear must be passed' },
      ],
    };
    const result = computeBlockingFiles(fileResults, [], allResults);
    expect(result).toHaveLength(1);
    expect(result[0].checks).toEqual(['MetadataParamsCheck']);
  });

  it('collects multiple distinct check names per file', () => {
    const fileResults = [
      { path: 'app/views/pages/broken.liquid', errors: 3, warnings: 0 },
    ];
    const allResults = {
      errors: [
        { severity: 'error', _filePath: '/p/app/views/pages/broken.liquid', check: 'MetadataParamsCheck', message: 'a' },
        { severity: 'error', _filePath: '/p/app/views/pages/broken.liquid', check: 'MetadataParamsCheck', message: 'b' },
        { severity: 'error', _filePath: '/p/app/views/pages/broken.liquid', check: 'SyntaxError', message: 'c' },
      ],
    };
    const result = computeBlockingFiles(fileResults, [], allResults);
    expect(result[0].checks).toHaveLength(2);
    expect(result[0].checks).toContain('MetadataParamsCheck');
    expect(result[0].checks).toContain('SyntaxError');
  });

  it('works without allResults (backward compat)', () => {
    const fileResults = [
      { path: 'app/a.liquid', errors: 1, warnings: 0 },
    ];
    const result = computeBlockingFiles(fileResults, []);
    expect(result).toHaveLength(1);
    expect(result[0].checks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildDiagnosticSnapshot
// ---------------------------------------------------------------------------

describe('buildDiagnosticSnapshot', () => {
  const toRel = (p) => p?.replace('/project/', '') ?? '';

  it('captures lint errors and warnings with fingerprint keys', () => {
    const allResults = {
      errors: [
        { severity: 'error', _filePath: '/project/app/a.liquid', check: 'MissingPartial', message: "Can't find 'x'" },
      ],
      warnings: [
        { severity: 'warning', _filePath: '/project/app/b.liquid', check: 'UnusedAssign', message: 'Unused var' },
      ],
    };
    const snapshot = buildDiagnosticSnapshot(allResults, [], toRel);
    expect(snapshot.size).toBe(2);
    expect(snapshot.has("error::app/a.liquid::MissingPartial::Can't find 'x'")).toBe(true);
    expect(snapshot.has('warning::app/b.liquid::UnusedAssign::Unused var')).toBe(true);
  });

  it('captures integrity issues', () => {
    const allResults = { errors: [], warnings: [] };
    const integrity = [
      { severity: 'error', source: 'app/p.liquid', type: 'broken_render', message: 'broken render' },
    ];
    const snapshot = buildDiagnosticSnapshot(allResults, integrity, toRel);
    expect(snapshot.size).toBe(1);
    expect(snapshot.has('error::app/p.liquid::broken_render::broken render')).toBe(true);
  });

  it('deduplicates identical diagnostics', () => {
    const dup = { severity: 'error', _filePath: '/project/app/a.liquid', check: 'X', message: 'msg' };
    const allResults = { errors: [dup, dup], warnings: [] };
    const snapshot = buildDiagnosticSnapshot(allResults, [], toRel);
    expect(snapshot.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeDiffFromLastRun
// ---------------------------------------------------------------------------

describe('computeDiffFromLastRun', () => {
  const toRel = (p) => p?.replace('/project/', '') ?? '';

  function makeSnapshot(diagnostics) {
    const map = new Map();
    for (const d of diagnostics) {
      const key = `${d.severity}::${d.file}::${d.check}::${d.message}`;
      map.set(key, d);
    }
    return map;
  }

  it('returns null when there is no previous run', () => {
    const current = new Map();
    expect(computeDiffFromLastRun(null, current, 0, 0)).toBeNull();
    expect(computeDiffFromLastRun({}, current, 0, 0)).toBeNull();
  });

  it('detects new errors that were not in the previous run', () => {
    const prev = makeSnapshot([
      { severity: 'error', file: 'a.liquid', check: 'X', message: 'old' },
    ]);
    const current = makeSnapshot([
      { severity: 'error', file: 'a.liquid', check: 'X', message: 'old' },
      { severity: 'error', file: 'b.liquid', check: 'Y', message: 'new' },
    ]);
    const session = {
      lastAnalysis: { timestamp: '2026-01-01T00:00:00Z', diagnostics: prev, total_errors: 1, total_warnings: 0 },
    };
    const diff = computeDiffFromLastRun(session, current, 2, 0);
    expect(diff.new_errors).toHaveLength(1);
    expect(diff.new_errors[0]).toEqual({ severity: 'error', file: 'b.liquid', check: 'Y', message: 'new' });
    expect(diff.resolved_errors).toHaveLength(0);
    expect(diff.error_delta).toBe(1);
  });

  it('detects resolved errors no longer present', () => {
    const prev = makeSnapshot([
      { severity: 'error', file: 'a.liquid', check: 'X', message: 'fixed' },
      { severity: 'error', file: 'b.liquid', check: 'Y', message: 'still here' },
    ]);
    const current = makeSnapshot([
      { severity: 'error', file: 'b.liquid', check: 'Y', message: 'still here' },
    ]);
    const session = {
      lastAnalysis: { timestamp: '2026-01-01T00:00:00Z', diagnostics: prev, total_errors: 2, total_warnings: 0 },
    };
    const diff = computeDiffFromLastRun(session, current, 1, 0);
    expect(diff.resolved_errors).toHaveLength(1);
    expect(diff.resolved_errors[0].file).toBe('a.liquid');
    expect(diff.error_delta).toBe(-1);
  });

  it('separates new/resolved errors from new/resolved warnings', () => {
    const prev = makeSnapshot([
      { severity: 'warning', file: 'a.liquid', check: 'W', message: 'old warn' },
    ]);
    const current = makeSnapshot([
      { severity: 'error', file: 'a.liquid', check: 'E', message: 'new err' },
    ]);
    const session = {
      lastAnalysis: { timestamp: '2026-01-01T00:00:00Z', diagnostics: prev, total_errors: 0, total_warnings: 1 },
    };
    const diff = computeDiffFromLastRun(session, current, 1, 0);
    expect(diff.new_errors).toHaveLength(1);
    expect(diff.new_warnings).toHaveLength(0);
    expect(diff.resolved_errors).toHaveLength(0);
    expect(diff.resolved_warnings).toHaveLength(1);
    expect(diff.error_delta).toBe(1);
    expect(diff.warning_delta).toBe(-1);
  });

  it('includes previous_run_at from session', () => {
    const prev = makeSnapshot([]);
    const current = makeSnapshot([]);
    const session = {
      lastAnalysis: { timestamp: '2026-04-14T01:00:00Z', diagnostics: prev, total_errors: 0, total_warnings: 0 },
    };
    const diff = computeDiffFromLastRun(session, current, 0, 0);
    expect(diff.previous_run_at).toBe('2026-04-14T01:00:00Z');
    expect(diff.error_delta).toBe(0);
    expect(diff.warning_delta).toBe(0);
  });

  it('returns all-zero diff when nothing changed', () => {
    const diags = [{ severity: 'error', file: 'a.liquid', check: 'X', message: 'same' }];
    const prev = makeSnapshot(diags);
    const current = makeSnapshot(diags);
    const session = {
      lastAnalysis: { timestamp: '2026-01-01T00:00:00Z', diagnostics: prev, total_errors: 1, total_warnings: 0 },
    };
    const diff = computeDiffFromLastRun(session, current, 1, 0);
    expect(diff.new_errors).toHaveLength(0);
    expect(diff.resolved_errors).toHaveLength(0);
    expect(diff.error_delta).toBe(0);
  });
});
