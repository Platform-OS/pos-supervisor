/**
 * CAC predictor configuration — persisted at
 * `<projectDir>/.pos-supervisor/cac-config.json`.
 *
 * The CAC (Cohen's Agentic Conjecture) layer is an OPT-IN 4th gating axis
 * applied to diagnostics after the existing cascade
 * (severity → static confidence → adaptive-mode → force-disable). It uses
 * historical adoption data from the analytics store to predict the probability
 * that an agent will adopt the proposed fix for a given diagnostic, and
 * suppresses or downgrades emits whose predicted adoption falls below the
 * configured threshold.
 *
 * Defaults: DISABLED. The validator behaves identically to versions that
 * predate this module until an operator explicitly turns it on from the
 * dashboard. Even when enabled, the default mode is `shadow`, which records
 * decisions to the session bus but does not modify diagnostics.
 *
 * File schema (JSON):
 *   {
 *     "version": 1,
 *     "enabled": false,
 *     "mode": "shadow" | "active",
 *     "threshold": 0.30,
 *     "action":  "downgrade" | "suppress",
 *     "min_samples": 5
 *   }
 *
 * Reads are tolerant — a missing file or malformed JSON yields the safe
 * default state (disabled). Writes are atomic (temp + rename) so a crash
 * mid-save can't leave the file half-written. Mirrors `rule-overrides.js`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_VERSION = 1;
const FILE_NAME = 'cac-config.json';

export const VALID_MODES = ['shadow', 'active'];
export const VALID_ACTIONS = ['downgrade', 'suppress'];

function configPath(projectDir) {
  return join(projectDir, '.pos-supervisor', FILE_NAME);
}

export function defaultCacConfig() {
  return {
    version: FILE_VERSION,
    enabled: false,
    mode: 'shadow',
    threshold: 0.30,
    action: 'downgrade',
    min_samples: 5,
  };
}

function coerceConfig(raw) {
  const def = defaultCacConfig();
  const out = { ...def };
  if (typeof raw?.enabled === 'boolean') out.enabled = raw.enabled;
  if (VALID_MODES.includes(raw?.mode)) out.mode = raw.mode;
  if (VALID_ACTIONS.includes(raw?.action)) out.action = raw.action;
  if (typeof raw?.threshold === 'number' && raw.threshold >= 0 && raw.threshold <= 1) {
    out.threshold = raw.threshold;
  }
  if (Number.isInteger(raw?.min_samples) && raw.min_samples >= 0) {
    out.min_samples = raw.min_samples;
  }
  return out;
}

/**
 * Load config from disk. Never throws — on any error returns default state
 * and calls `log` if provided. A corrupt config file must not prevent the
 * server from starting or stop validate_code from running.
 */
export function loadCacConfig(projectDir, { log } = {}) {
  const path = configPath(projectDir);
  if (!existsSync(path)) return defaultCacConfig();
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return coerceConfig(parsed);
  } catch (e) {
    log?.(`cac-config: failed to parse ${path} (${e.message}); using defaults`);
    return defaultCacConfig();
  }
}

/**
 * Atomic write: stage to a sibling temp file, then rename. fs rename within
 * the same dir is atomic on POSIX. A reader during the write sees either the
 * old file or the new — never a torn read.
 */
export function saveCacConfig(projectDir, state, { log } = {}) {
  const path = configPath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  const coerced = coerceConfig(state);
  const payload = JSON.stringify(coerced, null, 2);
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmp, payload);
    renameSync(tmp, path);
  } catch (e) {
    log?.(`cac-config: save failed (${e.message})`);
    throw e;
  }
  return coerced;
}

/**
 * Patch one or more fields. Unknown fields are ignored (coerceConfig drops
 * them). Returns the new state after persistence.
 */
export function updateCacConfig(projectDir, patch, { log } = {}) {
  const current = loadCacConfig(projectDir, { log });
  const merged = { ...current, ...patch };
  return saveCacConfig(projectDir, merged, { log });
}
