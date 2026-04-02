/**
 * Guard for pos-cli-dependent tests.
 * Tests in this directory require pos-cli on PATH.
 * When unavailable, entire suites are skipped with a clear message.
 *
 * Usage:
 *   import { describePosCli } from './guard.js';
 *   describePosCli('my suite', () => { ... });
 */

import { describe } from 'bun:test';
import { spawnSync } from 'node:child_process';

let _checked = false;
let _available = false;

export function posCliAvailable() {
  if (_checked) return _available;
  _checked = true;
  try {
    const result = spawnSync('pos-cli', ['--version'], {
      timeout: 5000,
      stdio: 'pipe',
    });
    _available = result.status === 0;
  } catch {
    _available = false;
  }
  if (!_available) {
    console.log('⚠ pos-cli not found on PATH — pos-cli tests will be skipped');
  }
  return _available;
}

/**
 * Use instead of `describe` — auto-skips when pos-cli is unavailable.
 */
export const describePosCli = posCliAvailable() ? describe : describe.skip;
