/**
 * Workflow text consistency contract (roadmap F-004).
 *
 * The scaffold and validate_intent tool descriptions MUST both embed the same
 * canonical workflow block. If they drift, an agent reading one tool's docs
 * contradicts the other. The fix (Phase 2.1) routes both descriptions through
 * a shared constant in src/core/workflow-text.js, so drift is impossible —
 * this test pins that invariant.
 *
 * If this test fails, something in this repo re-hardcoded the workflow text
 * instead of importing CANONICAL_WORKFLOW_BLOCK. Fix at the source, not here.
 */

import { describe, it, expect } from 'bun:test';
import { scaffoldTool } from '../../src/tools/scaffold.js';
import { validateIntentTool } from '../../src/tools/validate-intent.js';
import { CANONICAL_WORKFLOW_BLOCK } from '../../src/core/workflow-text.js';

describe('workflow text consistency (F-004)', () => {
  it('scaffold description embeds the canonical workflow block verbatim', () => {
    expect(scaffoldTool.description).toContain(CANONICAL_WORKFLOW_BLOCK);
  });

  it('validate_intent description embeds the canonical workflow block verbatim', () => {
    expect(validateIntentTool.description).toContain(CANONICAL_WORKFLOW_BLOCK);
  });

  it('both tools MUST NOT reference a divergent workflow rule', () => {
    // Phrases that previously lived in only one of the two tool descriptions
    // and created the contradiction. Asserting neither tool embeds these in
    // isolation (they may appear inside the canonical block, which both share).
    const divergentPhrases = [
      // Old scaffold-only instruction that contradicted validate-intent:
      'MUST: Call validate_intent with { scaffold_output: <this result> } before writing any files',
      // Old validate-intent-only exemption phrased as an aside:
      'Scaffold files (write:true) are written to disk immediately and do not need validate_intent',
    ];

    for (const phrase of divergentPhrases) {
      expect(scaffoldTool.description).not.toContain(phrase);
      expect(validateIntentTool.description).not.toContain(phrase);
    }
  });

  it('canonical block spells out the write:true exemption unambiguously', () => {
    // Pin the exemption language so future edits cannot water it down.
    expect(CANONICAL_WORKFLOW_BLOCK).toContain('scaffold(write:true) output');
    expect(CANONICAL_WORKFLOW_BLOCK).toContain('validate_intent is NOT required');
  });

  it('canonical block names all four workflow steps in order', () => {
    const block = CANONICAL_WORKFLOW_BLOCK;
    const posStep1 = block.indexOf('Step 1');
    const posStep2 = block.indexOf('Step 2');
    const posStep3 = block.indexOf('Step 3');
    const posStep4 = block.indexOf('Step 4');

    expect(posStep1).toBeGreaterThan(-1);
    expect(posStep2).toBeGreaterThan(posStep1);
    expect(posStep3).toBeGreaterThan(posStep2);
    expect(posStep4).toBeGreaterThan(posStep3);
  });
});
