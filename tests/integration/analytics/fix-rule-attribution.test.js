/**
 * I1 follow-up — fix proposals must carry rule_id even when the rule-engine
 * attaches rule_id to the HintResult rather than to each fix.
 *
 * Prior to this fix, rule-engine rules like `MissingPartial.create_file`
 * produced proposed_fixes rows with rule_id = NULL because the rule's
 * `apply()` returns { rule_id: 'MissingPartial.create_file', fixes: [...] }
 * — the id lives on the result, not the fix object. The emit loop only
 * read f.rule_id and lost the attribution.
 *
 * The fix is a single `f.rule_id ?? d.rule_id` fallback in validate-code.js.
 * This test drives a real validate_code call that triggers a rule-engine
 * fix and asserts the emitted event carries the inherited rule_id.
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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

function readValidatorEmits(projectDir) {
  const sessionsDir = join(projectDir, '.pos-supervisor', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const entries = readdirSync(sessionsDir, { withFileTypes: true }).filter(e => e.isDirectory());
  const out = [];
  for (const entry of entries) {
    const eventsPath = join(sessionsDir, entry.name, 'events.ndjson');
    if (!existsSync(eventsPath)) continue;
    for (const line of readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean)) {
      try {
        const ev = JSON.parse(line);
        if (ev.kind === 'validator_emit') out.push(ev);
      } catch { /* skip */ }
    }
  }
  return out;
}

describe('emit-loop propagates rule_id onto every fix (I1 follow-up)', () => {
  // A page rendering a partial that doesn't exist triggers MissingPartial.
  // In quick mode the rule engine's `MissingPartial.create_file` branch fires
  // (priority 20 — nearest-match is priority 10, won't hit for a truly
  // unknown name). Its HintResult carries rule_id AND fixes[0] is a
  // create_file. The fix object itself has no rule_id — we're testing that
  // the emit loop inherits d.rule_id.
  it('MissingPartial.create_file fix inherits rule_id from the diagnostic', async () => {
    const FILE = 'app/views/pages/rule-attr-test.liquid';
    const CONTENT = '---\nslug: rule-attr-test\n---\n{% render "totally/nonexistent_partial_xyz" %}\n';

    await server.callTool('validate_code', {
      file_path: FILE,
      content: CONTENT,
      mode: 'full',
    });

    await new Promise(r => setTimeout(r, 100));

    const emits = readValidatorEmits(proj.dir);
    const mpEmit = emits.find(
      e => e.file === FILE && e.check === 'MissingPartial' && (e.proposed_fixes?.length ?? 0) > 0,
    );
    expect(mpEmit).toBeDefined();
    expect(mpEmit.hint_rule_id).toContain('MissingPartial');

    // Every fix attached to this diagnostic carries a rule_id — either its
    // own (heuristic:...) or inherited from the rule engine's d.rule_id.
    for (const fix of mpEmit.proposed_fixes) {
      expect(fix.rule_id).not.toBeNull();
      expect(typeof fix.rule_id).toBe('string');
    }

    // At least one fix should be attributed to the rule-engine rule, not
    // solely the heuristic generator — that's the regression guard.
    const hasRuleEngineAttribution = mpEmit.proposed_fixes.some(
      f => f.rule_id && !f.rule_id.startsWith('heuristic:'),
    );
    expect(hasRuleEngineAttribution).toBe(true);
  });
});
