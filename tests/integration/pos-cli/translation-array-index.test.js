/**
 * Regression test for the fix-channel duplication bug (2026-04-25).
 *
 * Before this fix, an indexed translation key like `key[0]` produced THREE
 * proposed_fixes per error:
 *   1. A correct heuristic guidance ("Pass the full array, then iterate…").
 *   2. The rule engine's stale `suggest_nearest` guidance ("Replace with
 *      `en.parent.items`…") — Levenshtein found the parent key as the
 *      closest match, which is misleading.
 *   3. Same as #2 for the second error.
 *
 * The fix:
 *   - The array-index case is now owned by a dedicated rule
 *     `TranslationKeyExists.array_index_misuse` (priority 5).
 *   - `suggest_nearest` and `create_key` are gated to NOT fire on indexed
 *     keys.
 *   - The validate-code merge loop drops heuristic GUIDANCE when a rule
 *     fix exists for the same diagnostic; heuristic TEXT_EDIT survives
 *     (actionable diff complements rule narrative).
 *
 * This test drives the full pipeline (validate_code, full mode) and
 * asserts the agent sees ONLY the iteration guidance per error, not
 * the misleading nearest-key suggestion.
 */

import { it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from './guard.js';
import { startServer, FIXTURE_DIR, createTempProject } from '../helpers/server.js';

setDefaultTimeout(30_000);

let server;
let proj;

beforeAll(async () => {
  proj = createTempProject(FIXTURE_DIR);
  server = await startServer(proj.dir);
});

afterAll(() => {
  server?.stop();
  proj?.cleanup();
});

// Using a key whose namespace exists in the fixture so the LSP actually
// fires `TranslationKeyExists`. `blog_posts.titl[0]` is close enough to the
// fixture's `blog_posts.title` that the parent key would have been the
// nearest-match candidate before the fix. Path is a flat partial — LSP
// translation resolution is path-sensitive in the fixture project, and
// nested subdirs sometimes skip the check.
const FILE = 'app/views/partials/test_arr.liquid';
const CONTENT = "{{ 'blog_posts.titl[0]' | t }}";

describePosCli('translation array-index misuse: single-source-of-truth fix', () => {
  it('emits ONE iteration guidance per error, never the misleading "nearest key" suggestion', async () => {
    const result = await server.callTool('validate_code', {
      file_path: FILE,
      content: CONTENT,
      mode: 'full',
    });

    const tkeDiags = [
      ...result.errors.filter(e => e.check === 'TranslationKeyExists'),
      ...result.warnings.filter(w => w.check === 'TranslationKeyExists'),
    ];
    expect(tkeDiags.length).toBeGreaterThanOrEqual(1);

    // Each diagnostic carries the array-index rule attribution.
    for (const d of tkeDiags) {
      expect(d.rule_id).toBe('TranslationKeyExists.array_index_misuse');
    }

    // Filter proposed_fixes to ones from these TranslationKeyExists rows.
    const tkeProposed = result.proposed_fixes.filter(f =>
      f.check === 'TranslationKeyExists' || /TranslationKeyExists/.test(f.rule_id ?? '')
    );
    expect(tkeProposed.length).toBeGreaterThan(0);

    for (const f of tkeProposed) {
      // Modern attribution wins for both rule and (any surviving) heuristic.
      const id = f.rule_id ?? '';
      const isArrayRule = id === 'TranslationKeyExists.array_index_misuse';
      const isStrippedHeuristic = id.startsWith('heuristic:TranslationKeyExists');
      expect(isArrayRule || isStrippedHeuristic).toBe(true);

      // No fix should suggest the misleading "did you mean" or
      // "Replace 'foo[0]' with 'foo'" rewrite. The bug we're guarding
      // against was: the rule's stale `suggest_nearest` proposing the
      // parent key as a "did you mean" candidate.
      expect(f.description).not.toMatch(/[Dd]id you mean/);
      expect(f.description).not.toMatch(/Replace `blog_posts\.titl\[\d+\]` with `blog_posts/);
    }

    // Spot-check the iteration-guidance shape on at least one fix.
    const arrayFix = tkeProposed.find(f => f.rule_id === 'TranslationKeyExists.array_index_misuse');
    expect(arrayFix).toBeDefined();
    expect(arrayFix.description).toMatch(/\{% for item in items %\}/);
    expect(arrayFix.description).toMatch(/blog_posts\.titl/);
    // arrayKey reference must NOT carry the [0]/[1] suffix.
    expect(arrayFix.description).not.toMatch(/blog_posts\.titl\[\d+\]/);
  });
});
