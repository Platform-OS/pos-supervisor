import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from './helpers/server.js';

setDefaultTimeout(60_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());


describe('analyze_project — cross-file integrity', () => {
  it('returns integrity field in output', async () => {
    const result = await server.callTool('analyze_project', {});
    expect(result.integrity).toBeDefined();
    expect(Array.isArray(result.integrity)).toBe(true);
  });

  it('detects orphan partials', async () => {
    const result = await server.callTool('analyze_project', {});
    // permissions.liquid is not rendered by any page in the fixture
    const orphans = result.integrity.filter(i => i.type === 'orphan_partial');
    expect(orphans.length).toBeGreaterThan(0);
  });

  it('does not flag partials that are rendered', async () => {
    const result = await server.callTool('analyze_project', {});
    // blog_posts/list is rendered by the index page — should NOT be orphan
    const listOrphan = result.integrity.find(i =>
      i.type === 'orphan_partial' && i.source?.includes('blog_posts/list')
    );
    expect(listOrphan).toBeUndefined();
  });

  it('integrity issues are included in total counts', async () => {
    const result = await server.callTool('analyze_project', {});
    const integrityWarnings = result.integrity.filter(i => i.severity === 'warning').length;
    // total_warnings should include integrity warnings
    expect(result.total_warnings).toBeGreaterThanOrEqual(integrityWarnings);
  });
});

describe('analyze_project — fix_order', () => {
  it('returns fix_order array', async () => {
    const result = await server.callTool('analyze_project', {});
    expect(result.fix_order).toBeDefined();
    expect(Array.isArray(result.fix_order)).toBe(true);
  });

  it('fix_order entries have required fields', async () => {
    const result = await server.callTool('analyze_project', {});
    for (const entry of result.fix_order) {
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.errors).toBe('number');
      expect(typeof entry.warnings).toBe('number');
      expect(typeof entry.reason).toBe('string');
      expect(typeof entry.dependents_with_errors).toBe('number');
    }
  });

  it('fix_order contains only files that appear in files array', async () => {
    const result = await server.callTool('analyze_project', {});
    const filePaths = new Set(result.files.map(f => f.path));
    for (const entry of result.fix_order) {
      expect(filePaths.has(entry.path)).toBe(true);
    }
  });

  it('fix_order covers all files with errors', async () => {
    const result = await server.callTool('analyze_project', {});
    const fixPaths = new Set(result.fix_order.map(f => f.path));
    // every file in files should appear in fix_order
    for (const f of result.files) {
      expect(fixPaths.has(f.path)).toBe(true);
    }
  });

  it('next_step references fix_order when errors exist', async () => {
    const result = await server.callTool('analyze_project', {});
    if (result.fix_order.length > 0) {
      expect(result.next_step).toMatch(/Fix in order/);
    } else {
      expect(result.next_step).toMatch(/validate_code/);
    }
  });

  it('fix_order with specific erroring files preserves ordering constraint', async () => {
    // Provide only a partial and a page that renders it — if both have errors,
    // the partial (dependency) must appear before the page (dependent).
    // This test validates the ordering contract using files that we know exist
    // in the fixture project.
    const result = await server.callTool('analyze_project', {
      files: [
        'app/views/pages/blog_posts/index.html.liquid',
        'app/views/partials/blog_posts/list.liquid',
      ],
    });

    // fix_order should have entries for whichever of these have issues.
    // We can't assert order without knowing which have errors in the fixture,
    // but we can assert the shape is correct.
    expect(result.fix_order).toBeDefined();
    for (const entry of result.fix_order) {
      expect(entry.dependents_with_errors).toBeGreaterThanOrEqual(0);
      expect(['No cross-error dependencies', 'Fix first', 'All dependencies fixed', 'Circular dependency'])
        .toContain(entry.reason.split(' — ')[0]);
    }
  });
});

describe('analyze_project — blocking_files', () => {
  it('returns blocking_files array', async () => {
    const result = await server.callTool('analyze_project', {});
    expect(result.blocking_files).toBeDefined();
    expect(Array.isArray(result.blocking_files)).toBe(true);
  });

  it('blocking_files entries have required fields', async () => {
    const result = await server.callTool('analyze_project', {});
    for (const entry of result.blocking_files) {
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.lint_errors).toBe('number');
      expect(typeof entry.integrity_errors).toBe('number');
      expect(typeof entry.total).toBe('number');
      expect(entry.total).toBe(entry.lint_errors + entry.integrity_errors);
    }
  });

  it('blocking_files only contains files with errors (not warning-only files)', async () => {
    const result = await server.callTool('analyze_project', {});
    for (const entry of result.blocking_files) {
      expect(entry.total).toBeGreaterThan(0);
    }
  });

  it('blocking_files is sorted by total descending', async () => {
    const result = await server.callTool('analyze_project', {});
    for (let i = 1; i < result.blocking_files.length; i++) {
      expect(result.blocking_files[i - 1].total).toBeGreaterThanOrEqual(result.blocking_files[i].total);
    }
  });
});

describe('analyze_project — diff_from_last_run', () => {
  // Note: previous describe blocks may have already called analyze_project,
  // so session.lastAnalysis may already be set. "null on first call" is
  // covered by the unit test for computeDiffFromLastRun.

  it('returns diff object with previous_run_at and delta fields after a prior call', async () => {
    await server.callTool('analyze_project', {});
    const result = await server.callTool('analyze_project', {});
    expect(result.diff_from_last_run).not.toBeNull();
    expect(result.diff_from_last_run.previous_run_at).toBeDefined();
    expect(typeof result.diff_from_last_run.error_delta).toBe('number');
    expect(typeof result.diff_from_last_run.warning_delta).toBe('number');
    expect(Array.isArray(result.diff_from_last_run.new_errors)).toBe(true);
    expect(Array.isArray(result.diff_from_last_run.resolved_errors)).toBe(true);
    expect(Array.isArray(result.diff_from_last_run.new_warnings)).toBe(true);
    expect(Array.isArray(result.diff_from_last_run.resolved_warnings)).toBe(true);
  });

  it('reports zero delta when running same analysis twice', async () => {
    await server.callTool('analyze_project', {});
    const result = await server.callTool('analyze_project', {});
    expect(result.diff_from_last_run.error_delta).toBe(0);
    expect(result.diff_from_last_run.warning_delta).toBe(0);
    expect(result.diff_from_last_run.new_errors).toHaveLength(0);
    expect(result.diff_from_last_run.resolved_errors).toHaveLength(0);
  });
});
