/**
 * Shared canonical workflow text.
 *
 * This file is the ONE place the scaffold ↔ validate_intent workflow decision
 * tree lives. Both tool descriptions import CANONICAL_WORKFLOW_BLOCK and embed
 * it verbatim into their `description` strings. A regression test
 * (tests/upstream/workflow-consistency.test.js) asserts that every tool we care
 * about contains this exact substring — so drift between tool descriptions is
 * literally impossible.
 *
 * History: roadmap F-004 tracked a live contradiction where scaffold.js said
 * `MUST call validate_intent before writing` and validate-intent.js said
 * `scaffold(write:true) does not need it`. An agent following one description
 * violated the other. The fix is not "write better prose" — it is to remove
 * the possibility of divergence by sharing the source string.
 *
 * If you need to change the workflow text, change it here. Both tool
 * descriptions pick up the new text on next module load.
 */

export const CANONICAL_WORKFLOW_BLOCK = `CANONICAL WORKFLOW:

  Track A — scaffold-generated files (preferred, single-shot):
    Step 1 — (recommended) call domain_guide for every domain in consult_before_writing.
    Step 2 — call scaffold with write:true. Files land on disk, session.pending clears,
             the fs-watcher re-indexes the LSP.
    Step 3 — DONE. No validate_intent, no validate_code on untouched scaffold output.
    Step 4 — if you hand-edit a scaffold file afterwards, call validate_code on the edited file.

  Track B — hand-drafted files (or a review of scaffold dry-run output):
    Step 1 — call domain_guide for every domain you touch.
    Step 2 — call validate_intent: { intent } for hand-drafted batches (REQUIRED),
             or { scaffold_output } for an optional pre-write review of dry-run output.
    Step 3 — call validate_code on the FULL content of each hand-drafted file BEFORE writing.
    Step 4 — if validate_code returns status != "ok" or must_fix_before_write:true,
             fix and re-validate.

IMPORTANT — when validate_intent IS required:
  - scaffold(write:true) output      → validate_intent is NOT required. This is the default path.
    scaffold writes files directly, clears session.pending, and the fs-watcher re-indexes the LSP.
    Only call validate_code if you make manual edits afterwards.
  - scaffold(write:false) output     → validate_intent is OPTIONAL (review-only). Scaffold
    templates are pre-validated; use validate_intent only if you want a second pass before
    committing with write:true.
  - manually-drafted file batches    → validate_intent IS required, then validate_code per file.`;
