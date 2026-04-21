/**
 * Engine mode — global toggle for the neuro-symbolic write side.
 *
 * Two modes:
 *   'adaptive' — auto-disabling, case-base scoring, promoted rules, probation
 *   'static'   — all rules fire at raw confidence, no promoted rules loaded
 *
 * Analytics data collection runs in BOTH modes. Only the consumption
 * of analytics (scoring, disabling, promoting) is gated.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODE_FILE = 'engine-mode.json';
const VALID_MODES = new Set(['adaptive', 'static']);

let _mode = 'static';
let _listeners = [];

export function getEngineMode() {
  return _mode;
}

export function isAdaptive() {
  return _mode === 'adaptive';
}

export function setEngineMode(mode, { projectDir, onTransition } = {}) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid engine mode: '${mode}'. Must be 'adaptive' or 'static'.`);
  }
  const prev = _mode;
  if (prev === mode) return;

  _mode = mode;

  if (projectDir) {
    persistEngineMode(projectDir, mode);
  }

  if (onTransition) {
    onTransition(prev, mode);
  }

  for (const fn of _listeners) {
    try { fn(mode, prev); } catch { /* listener failure is non-fatal */ }
  }
}

export function onEngineModeChange(fn) {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter(f => f !== fn);
  };
}

export function loadEngineMode(projectDir) {
  const filePath = join(projectDir, '.pos-supervisor', MODE_FILE);
  if (!existsSync(filePath)) return _mode;

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (VALID_MODES.has(raw?.mode)) {
      _mode = raw.mode;
    }
  } catch { /* malformed file — keep current mode */ }

  return _mode;
}

export function persistEngineMode(projectDir, mode) {
  const dir = join(projectDir, '.pos-supervisor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, MODE_FILE),
    JSON.stringify({ mode, updated_at: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}

export function resetEngineMode() {
  _mode = 'static';
  _listeners = [];
}
