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
