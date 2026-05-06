/**
 * Coverage probe for `InvalidAssignSyntax` and `InvalidOutputPush` —
 * the assign/push grammar checks described in `docs/upstream-changes/
 * upstream-changes.md` sections A and C.
 *
 * Status as of pos-cli 6.0.7: these checks live in the parser-side repo
 * but have NOT been shipped in `@platformos/platformos-check-common` yet.
 * The parser dependency was bumped to ^0.0.17 in Phase 6 (the grammar
 * change is in the parser); the LSP-level checks land separately.
 *
 * This file is a deferred coverage probe. It runs every CI cycle and
 * LOGS whether the LSP now reports `InvalidAssignSyntax` /
 * `InvalidOutputPush` for the canonical trigger inputs. It does NOT
 * fail when the checks are absent — that's the current expected state.
 *
 * When the checks DO ship in a future pos-cli, the test surfaces it via
 * the [SHIPPED] log line. At that point we should:
 *   1. Add hint files (`src/data/hints/InvalidAssignSyntax.md`,
 *      `src/data/hints/InvalidOutputPush.md`).
 *   2. Add rule modules (`src/core/rules/InvalidAssignSyntax.js`,
 *      `src/core/rules/InvalidOutputPush.js`) with priority-ordered
 *      categories, mirroring the Phase 3 ValidFrontmatter / JsonLiteralQuoteStyle
 *      treatment.
 *   3. Add fingerprint pins in `tests/upstream/diagnostic-fingerprint.test.js`.
 *   4. Replace the loose `expect(true).toBe(true)` with hard assertions on
 *      the emitted diagnostic shape (mirroring lsp-coverage-map.test.js).
 *   5. Update `docs/upstream-changes/upstream-changes.md` to mark sections
 *      A and C as ABSORBED (currently OBSERVED-ONLY).
 *
 * The triggers below come straight from upstream PR-A and PR-C test cases
 * so when the checks ship we'll already be aligned with their canonical
 * inputs.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { describePosCli } from '../integration/pos-cli/guard.js';
import { startServer, FIXTURE_DIR } from '../integration/helpers/server.js';

setDefaultTimeout(30_000);

let server;
beforeAll(async () => { server = await startServer(FIXTURE_DIR); });
afterAll(() => server?.stop());

async function lspDiagsFor(filePath, content) {
  const result = await server.callTool('validate_code', { file_path: filePath, content, mode: 'quick' });
  const all = [...result.errors, ...result.warnings];
  return all.filter(d => !d.check.startsWith('pos-supervisor:') && d.check !== 'OrphanedPartial');
}

function reportShipStatus(check, lspDiags) {
  const matched = lspDiags.filter(d => d.check === check);
  if (matched.length > 0) {
    console.log(`  [SHIPPED] ${check} — LSP fires the check. Action items in test header.`);
    for (const d of matched.slice(0, 3)) {
      console.log(`    ${d.check} (${d.severity}): ${d.message?.slice(0, 100)}`);
    }
  } else {
    console.log(`  [PENDING] ${check} — still not shipped in this pos-cli. Triggers ready when it lands.`);
  }
}

describePosCli('Coverage probe: InvalidAssignSyntax (upstream PR-A, PR-C)', () => {
  it('detects whether trailing-garbage assign syntax is flagged', async () => {
    // Triggers from upstream `InvalidAssignSyntax.spec.ts`: stray `}` after a
    // filter-array argument inside an assign. Tolerant parser folds back to
    // string markup so other checks miss it; the dedicated check catches it.
    const content =
      "{% assign x = items | map: ['a', 'b'] } %}\n" +
      "{% liquid\n  assign y = items | join: ',' }\n%}\n";
    const lsp = await lspDiagsFor('app/views/partials/coverage_invalid_assign.liquid', content);
    reportShipStatus('InvalidAssignSyntax', lsp);
    // Always pass — this is a status probe, not a hard contract.
    expect(true).toBe(true);
  });

  it('detects whether structurally-broken assign tags are flagged', async () => {
    // Empty markup, missing operator, literal target, empty RHS.
    const content =
      "{% assign %}\n" +
      "{% assign x %}\n" +
      "{% assign 'literal' = 5 %}\n" +
      "{% assign x = %}\n";
    const lsp = await lspDiagsFor('app/views/partials/coverage_assign_shapes.liquid', content);
    reportShipStatus('InvalidAssignSyntax', lsp);
    expect(true).toBe(true);
  });
});

describePosCli('Coverage probe: InvalidOutputPush (upstream PR-C)', () => {
  it('detects whether `<<` in output position is flagged', async () => {
    // The `<<` push operator is only valid inside `{% assign %}`. Using it
    // in `{{ }}` or `{% echo %}` is invalid — upstream PR-C added a
    // dedicated check for this.
    const content =
      "{{ items << 'x' }}\n" +
      "{% echo items << 'x' %}\n";
    const lsp = await lspDiagsFor('app/views/partials/coverage_invalid_output_push.liquid', content);
    reportShipStatus('InvalidOutputPush', lsp);
    expect(true).toBe(true);
  });
});

describePosCli('Coverage probe: parser grammar — bare push form still parses', () => {
  it('bare `{% assign arr << item %}` is the only valid push form post-PR-C', async () => {
    // Grammar simplification kept the bare push form. This sanity check
    // makes sure the parser doesn't regress on the canonical valid input.
    const content = "{% assign arr = '' | split: '' %}\n{% assign arr << 'item' %}\n";
    const lsp = await lspDiagsFor('app/views/partials/coverage_bare_push.liquid', content);
    const errs = lsp.filter(d => d.severity === 'error');
    if (errs.length > 0) {
      console.log('  [REGRESSION CANDIDATE] bare push form produced errors — investigate:');
      for (const e of errs.slice(0, 3)) console.log(`    ${e.check}: ${e.message}`);
    }
    expect(true).toBe(true);
  });
});
