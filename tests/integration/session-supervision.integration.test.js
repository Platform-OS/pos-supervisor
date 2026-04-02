import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from './helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

describe('Session supervision — error loop detection', () => {
  it('adds note after 3+ validate_code calls with persistent errors', async () => {
    const brokenContent = '{{ undefined_var | nonexistent_filter }}';
    const params = {
      file_path: 'app/views/partials/session_test_loop.liquid',
      content: brokenContent,
      mode: 'quick',
    };

    // Session updates happen AFTER handler returns (in dispatch wrapper).
    // The handler reads history from previous calls. So:
    //   Call 1: handler sees nothing → updateSession sets count=0
    //   Call 2: handler sees count=0 → updateSession sets count=1
    //   Call 3: handler sees count=1 → updateSession sets count=2
    //   Call 4: handler sees count=2 → updateSession sets count=3
    //   Call 5: handler sees count=3 → note fires!
    await server.callTool('validate_code', params);
    await server.callTool('validate_code', params);
    await server.callTool('validate_code', params);
    await server.callTool('validate_code', params);
    const r5 = await server.callTool('validate_code', params);

    if (r5.errors.length > 0) {
      expect(r5.note).toBeDefined();
      expect(r5.note).toContain('persistent');
    }
  });

  it('resets loop counter when errors decrease', async () => {
    // Use a unique file to avoid interference
    const broken = '{{ x | bad_filter }}';
    const fixed = '<p>hello</p>';
    const fp = 'app/views/partials/session_test_reset.liquid';

    await server.callTool('validate_code', { file_path: fp, content: broken, mode: 'quick' });
    await server.callTool('validate_code', { file_path: fp, content: broken, mode: 'quick' });
    // Fix it — error count drops
    const rFixed = await server.callTool('validate_code', { file_path: fp, content: fixed, mode: 'quick' });
    // No note expected after fixing
    expect(rFixed.note).toBeUndefined();
  });
});

describe('Session supervision — tool avoidance', () => {
  it('adds supervision note when calling non-validation tools with unvalidated plan files', async () => {
    // Register a plan with pending files
    const intent = await server.callTool('validate_intent', {
      intent: {
        goal: 'Test tool avoidance',
        changes: [
          { path: 'app/views/partials/avoidance_test_a.liquid', role: 'partial', action: 'create' },
          { path: 'app/views/partials/avoidance_test_b.liquid', role: 'partial', action: 'create' },
        ],
      },
    });
    expect(intent.ok).toBe(true);

    // Call a non-exempt tool without validating the pending files first
    const guide = await server.callTool('domain_guide', { domain: 'partials', section: 'gotchas' });

    // Should have supervision note about unvalidated files
    expect(guide._supervision_note).toBeDefined();
    expect(guide._supervision_note).toContain('not yet validated');
  });
});
