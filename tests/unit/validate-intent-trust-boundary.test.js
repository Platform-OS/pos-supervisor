/**
 * Phase 0.1 — trust boundary between scaffold and manual tracks.
 *
 * Track A (scaffold_output) returns write_directly:true on success, signalling
 * the agent to write every file verbatim and skip the per-file validate_code
 * gate. Re-linting scaffold templates produces false-positive loops because the
 * generator is the contract, not the linter.
 *
 * Track B (manual intent) returns write_directly:false on success, preserving
 * the requirement that each hand-drafted file pass validate_code before write.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateScaffold } from '../../src/core/scaffold-generator.js';
import { validateIntent } from '../../src/core/intent-validator.js';

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'intent-trust-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

describe('validate_intent trust boundary (write_directly flag)', () => {
  it('Track A (scaffold_output) success returns write_directly:true', async () => {
    const scaffoldOutput = await generateScaffold({
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }],
      write: false,
    }, projectDir);

    const result = await validateIntent({ scaffold_output: scaffoldOutput }, projectDir);

    expect(result.ok).toBe(true);
    expect(result.write_directly).toBe(true);
    expect(result.next_step).toMatch(/EXACTLY as generated/i);
    expect(result.next_step).not.toMatch(/call validate_code.*before writing/i);
  });

  it('Track B (manual intent) success returns write_directly:false', async () => {
    const manualIntent = {
      goal: 'Add a lookup partial',
      changes: [
        {
          path: 'app/views/partials/util/lookup.liquid',
          role: 'partial',
          action: 'create',
        },
      ],
    };

    const result = await validateIntent({ intent: manualIntent }, projectDir);

    expect(result.ok).toBe(true);
    expect(result.write_directly).toBe(false);
    expect(result.next_step).toMatch(/validate_code/i);
  });

  it('Track A next_step instructs the agent to skip per-file validate_code', async () => {
    const scaffoldOutput = await generateScaffold({
      type: 'crud',
      name: 'widget',
      properties: [{ name: 'label', type: 'string' }],
      write: false,
    }, projectDir);

    const result = await validateIntent({ scaffold_output: scaffoldOutput }, projectDir);

    expect(result.ok).toBe(true);
    // The step must be explicit — agents respond to structured fields but the
    // next_step prose is still what drives behaviour in current clients.
    expect(result.next_step).toMatch(/do NOT call validate_code/);
  });

  it('pending_files from Track A still populate for post-write manual edits', async () => {
    const scaffoldOutput = await generateScaffold({
      type: 'crud',
      name: 'gadget',
      properties: [{ name: 'name', type: 'string' }],
      write: false,
    }, projectDir);

    const result = await validateIntent({ scaffold_output: scaffoldOutput }, projectDir);

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.pending_files)).toBe(true);
    expect(result.pending_files.length).toBeGreaterThan(0);
    // pending_translations is only populated when scaffold emits translation files.
    expect(Array.isArray(result.pending_translations)).toBe(true);
  });
});
