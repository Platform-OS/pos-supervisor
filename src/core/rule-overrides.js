/**
 * Rule overrides — manual force-enable / force-disable records that survive
 * restart. Persisted at `<projectDir>/.pos-supervisor/rule-overrides.json`.
 *
 * Two kinds of override:
 *   - force_enable:  rule runs even when case-base scoring would disable it.
 *                    Use case: operator wants to re-test a rule after fixing
 *                    a false-positive source, before enough fresh outcomes
 *                    accumulate to auto-flip the score.
 *   - force_disable: rule never runs, even if the engine considers it healthy.
 *                    Use case: emergency kill-switch for a rule producing bad
 *                    suggestions in production.
 *
 * File schema (JSON):
 *   {
 *     "version": 1,
 *     "force_enable":  { "<rule_id>": { "ts": "<iso8601>", "reason": "<text>" } },
 *     "force_disable": { "<rule_id>": { "ts": "<iso8601>", "reason": "<text>" } }
 *   }
 *
 * Reads are tolerant: a missing file → empty overrides. A malformed file is
 * logged (via the caller's log hook) and treated as empty, never thrown —
 * the dashboard must stay reachable even if someone hand-edited the JSON.
 * Writes are atomic (temp + rename) so a crash mid-save can't leave the file
 * half-written.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_VERSION = 1;
const FILE_NAME = 'rule-overrides.json';

function overridesPath(projectDir) {
  return join(projectDir, '.pos-supervisor', FILE_NAME);
}

function emptyState() {
  return { version: FILE_VERSION, force_enable: {}, force_disable: {} };
}

/**
 * Load overrides from disk. Never throws — on any error returns empty state
 * and calls `log` if provided. Intentional: a corrupt overrides file must
 * not prevent the server from starting.
 */
export function loadOverrides(projectDir, { log } = {}) {
  const path = overridesPath(projectDir);
  if (!existsSync(path)) return emptyState();
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    const fe = parsed?.force_enable ?? {};
    const fd = parsed?.force_disable ?? {};
    if (typeof fe !== 'object' || typeof fd !== 'object') {
      throw new Error('force_enable / force_disable must be objects');
    }
    return { version: FILE_VERSION, force_enable: { ...fe }, force_disable: { ...fd } };
  } catch (e) {
    log?.(`rule-overrides: failed to parse ${path} (${e.message}); treating as empty`);
    return emptyState();
  }
}

/**
 * Atomic write: stage to a sibling temp file, then rename. fs rename within
 * the same dir is atomic on POSIX. A reader during the write sees either the
 * old file or the new — never a torn read.
 */
export function saveOverrides(projectDir, state, { log } = {}) {
  const path = overridesPath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  const payload = JSON.stringify({
    version: FILE_VERSION,
    force_enable: state.force_enable ?? {},
    force_disable: state.force_disable ?? {},
  }, null, 2);
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmp, payload);
    renameSync(tmp, path);
  } catch (e) {
    log?.(`rule-overrides: save failed (${e.message})`);
    throw e;
  }
}

/**
 * Register a force-enable for `ruleId`. Removes any force-disable for the
 * same rule (the two are mutually exclusive — setting one clears the other).
 * Persists immediately.
 */
export function addForceEnable(projectDir, ruleId, reason = '', { log } = {}) {
  if (!ruleId) throw new Error('addForceEnable: ruleId required');
  const state = loadOverrides(projectDir, { log });
  state.force_enable[ruleId] = { ts: new Date().toISOString(), reason };
  delete state.force_disable[ruleId];
  saveOverrides(projectDir, state, { log });
  return state;
}

export function addForceDisable(projectDir, ruleId, reason = '', { log } = {}) {
  if (!ruleId) throw new Error('addForceDisable: ruleId required');
  const state = loadOverrides(projectDir, { log });
  state.force_disable[ruleId] = { ts: new Date().toISOString(), reason };
  delete state.force_enable[ruleId];
  saveOverrides(projectDir, state, { log });
  return state;
}

export function removeOverride(projectDir, ruleId, { log } = {}) {
  if (!ruleId) throw new Error('removeOverride: ruleId required');
  const state = loadOverrides(projectDir, { log });
  delete state.force_enable[ruleId];
  delete state.force_disable[ruleId];
  saveOverrides(projectDir, state, { log });
  return state;
}

/** Convenience for callers that just want two string[] of rule_ids. */
export function overrideSets(state) {
  return {
    force_enable: new Set(Object.keys(state.force_enable ?? {})),
    force_disable: new Set(Object.keys(state.force_disable ?? {})),
  };
}
