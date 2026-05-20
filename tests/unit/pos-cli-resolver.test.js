import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, sep } from 'node:path';

import {
  parseShim,
  resolveShimOrSymlink,
  resolveNode,
} from '../../src/core/pos-cli-resolver.js';

const isWindows = platform() === 'win32';

// Real npm cmd-shim content (paraphrased verbatim from a live npm install
// of an @platformos package). The whitespace and structure matter — we
// regression-test against the exact tokens npm emits.
const WINDOWS_CMD_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@platformos\\pos-cli\\bin\\pos-cli.js" %*
`;

const POWERSHELL_SHIM = `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
  & "$basedir/node$exe"  "$basedir/node_modules/@platformos/pos-cli/bin/pos-cli.js" $args
  $ret=$LASTEXITCODE
} else {
  & "node$exe"  "$basedir/node_modules/@platformos/pos-cli/bin/pos-cli.js" $args
  $ret=$LASTEXITCODE
}
exit $ret
`;

const UNIX_SH_WRAPPER = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case \`uname\` in
    *CYGWIN*|*MINGW*|*MSYS*)
        if command -v cygpath > /dev/null 2>&1; then
            basedir=\`cygpath -w "$basedir"\`
        fi
    ;;
esac

if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/node_modules/@platformos/pos-cli/bin/pos-cli.js" "$@"
else
  exec node  "$basedir/node_modules/@platformos/pos-cli/bin/pos-cli.js" "$@"
fi
`;

const POS_CLI_JS_STUB = `#!/usr/bin/env node\n// stub pos-cli.js for resolver tests\n`;

// ── Per-suite fixture: a mock npm-prefix layout under tmpdir ──────────────
//
//   <tmp>/prefix/bin/pos-cli            (Unix wrapper)
//   <tmp>/prefix/bin/pos-cli.cmd        (Windows shim)
//   <tmp>/prefix/bin/pos-cli.ps1        (PowerShell shim)
//   <tmp>/prefix/bin/node_modules/@platformos/pos-cli/bin/pos-cli.js
//   <tmp>/prefix/bin-symlink/pos-cli    (symlink to the .js, Unix style)
//
// All shim contents reference `%dp0%\node_modules\...` or `$basedir/node_modules/...`
// — i.e. the JS path lives under the SHIM'S directory, matching the way
// npm lays out global Windows installs.

let fixtureRoot = null;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'pos-cli-resolver-'));

  const binDir = join(fixtureRoot, 'prefix', 'bin');
  const jsDir = join(binDir, 'node_modules', '@platformos', 'pos-cli', 'bin');
  mkdirSync(jsDir, { recursive: true });
  writeFileSync(join(jsDir, 'pos-cli.js'), POS_CLI_JS_STUB);

  writeFileSync(join(binDir, 'pos-cli.cmd'), WINDOWS_CMD_SHIM);
  writeFileSync(join(binDir, 'pos-cli.ps1'), POWERSHELL_SHIM);
  writeFileSync(join(binDir, 'pos-cli'), UNIX_SH_WRAPPER);

  // Unix symlink fixture — npm classic Linux global layout. Skipped on
  // Windows where unprivileged symlink creation may fail.
  if (!isWindows) {
    const symBinDir = join(fixtureRoot, 'prefix', 'bin-symlink');
    mkdirSync(symBinDir, { recursive: true });
    symlinkSync(join(jsDir, 'pos-cli.js'), join(symBinDir, 'pos-cli'));
  }
});

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe('parseShim()', () => {
  it('extracts the JS path from a Windows .cmd shim', () => {
    const shimPath = join(fixtureRoot, 'prefix', 'bin', 'pos-cli.cmd');
    const result = parseShim(shimPath);
    expect(result).not.toBeNull();
    expect(result.endsWith(join('pos-cli', 'bin', 'pos-cli.js'))).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it('extracts the JS path from a PowerShell .ps1 shim', () => {
    const shimPath = join(fixtureRoot, 'prefix', 'bin', 'pos-cli.ps1');
    const result = parseShim(shimPath);
    expect(result).not.toBeNull();
    expect(result.endsWith(join('pos-cli', 'bin', 'pos-cli.js'))).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it('extracts the JS path from a Unix /bin/sh wrapper', () => {
    const shimPath = join(fixtureRoot, 'prefix', 'bin', 'pos-cli');
    const result = parseShim(shimPath);
    expect(result).not.toBeNull();
    expect(result.endsWith(join('pos-cli', 'bin', 'pos-cli.js'))).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it('returns null for a file that does not reference pos-cli.js', () => {
    const garbagePath = join(fixtureRoot, 'garbage');
    writeFileSync(garbagePath, '#!/bin/sh\necho hello\n');
    expect(parseShim(garbagePath)).toBeNull();
  });

  it('returns null for a non-existent file', () => {
    expect(parseShim(join(fixtureRoot, 'does-not-exist'))).toBeNull();
  });

  it('returns null when the extracted path does not exist on disk', () => {
    const orphanShim = join(fixtureRoot, 'orphan-shim.cmd');
    writeFileSync(
      orphanShim,
      `@ECHO off\n"%dp0%\\node_modules\\@platformos\\pos-cli\\bin\\pos-cli.js" %*\n`
    );
    // No node_modules tree under fixtureRoot/ — shim points nowhere.
    expect(parseShim(orphanShim)).toBeNull();
  });

  it('rejects suspiciously large files', () => {
    const bigPath = join(fixtureRoot, 'too-big.cmd');
    // 65 KB of pseudo-shim content — over the 64 KB cap.
    const big =
      `@ECHO off\n` +
      'X'.repeat(65 * 1024) +
      `\n"%dp0%\\node_modules\\@platformos\\pos-cli\\bin\\pos-cli.js" %*`;
    writeFileSync(bigPath, big);
    expect(parseShim(bigPath)).toBeNull();
  });
});

describe('resolveShimOrSymlink()', () => {
  it('follows a Unix symlink to the underlying .js file', () => {
    if (isWindows) return; // symlink not created on Windows
    const linkPath = join(fixtureRoot, 'prefix', 'bin-symlink', 'pos-cli');
    const result = resolveShimOrSymlink(linkPath);
    expect(result).not.toBeNull();
    expect(result.endsWith('.js')).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it('parses a .cmd shim when no symlink is present', () => {
    const shimPath = join(fixtureRoot, 'prefix', 'bin', 'pos-cli.cmd');
    const result = resolveShimOrSymlink(shimPath);
    expect(result).not.toBeNull();
    expect(result.endsWith('pos-cli.js')).toBe(true);
  });

  it('returns null when neither symlink nor shim resolution succeeds', () => {
    const blankPath = join(fixtureRoot, 'random-file');
    writeFileSync(blankPath, 'not a shim');
    expect(resolveShimOrSymlink(blankPath)).toBeNull();
  });
});

describe('resolveNode()', () => {
  it('returns a usable absolute path or null — never throws', async () => {
    const result = await resolveNode();
    if (result === null) {
      // CI without node on PATH would hit this; documented possibility.
      expect(result).toBeNull();
    } else {
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(existsSync(result)).toBe(true);
    }
  });

  it('returns process.execPath when running under Node.js itself', async () => {
    // Bun's process.versions has a `bun` field; Node's does not. This
    // assertion captures the runtime split the resolver branches on.
    if (process.versions.bun) {
      // Under Bun — resolver must PATH-walk for node. Test passes if a
      // node binary is reachable on this machine, which is expected for
      // the dev environment.
      const result = await resolveNode();
      if (result !== null) {
        const base = result.split(/[\\/]/).pop();
        expect(['node', 'node.exe']).toContain(base);
      }
    } else {
      const result = await resolveNode();
      expect(result).toBe(process.execPath);
    }
  });
});
