/**
 * Guard for pos-cli-dependent tests.
 * Tests in this directory require pos-cli to be reachable on this machine.
 * When unavailable, entire suites are skipped with a clear message.
 *
 * Resolution goes through src/core/pos-cli-resolver.js so the guard works
 * uniformly on Linux, macOS, and Windows (cmd.exe, Git Bash, PowerShell).
 * The prior implementation called `spawnSync('pos-cli', ['--version'])`
 * directly, which silently reported "not found" on Windows even when
 * pos-cli was installed — Node's spawn can't auto-resolve the `.cmd` shim
 * without `shell: true`, and `shell: true` would mangle the version check
 * on systems with locale-dependent stderr.
 *
 * Usage:
 *   import { describePosCli } from './guard.js';
 *   describePosCli('my suite', () => { ... });
 */

import { describe } from 'bun:test';
import { resolvePosCli, resolveNode } from '../../../src/core/pos-cli-resolver.js';

let _checked = false;
let _available = false;

async function checkAvailability() {
  try {
    const [posCli, node] = await Promise.all([resolvePosCli(), resolveNode()]);
    return posCli.found && !!node;
  } catch {
    return false;
  }
}

// Top-level await so describePosCli below can synchronously branch.
// bun:test loads test files eagerly; this runs once per file but the
// resolver's npm-root spawn is identical work for every file and finishes
// in ~50 ms on a warm machine, well under any test-discovery budget.
if (!_checked) {
  _available = await checkAvailability();
  _checked = true;
  if (!_available) {
    console.log('⚠ pos-cli not reachable — pos-cli tests will be skipped');
  }
}

export function posCliAvailable() {
  return _available;
}

/**
 * Use instead of `describe` — auto-skips when pos-cli is unavailable.
 */
export const describePosCli = _available ? describe : describe.skip;
