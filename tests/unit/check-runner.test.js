import { describe, it, expect } from 'bun:test';
import { tmpdir } from 'node:os';
import { createCheckRunner } from '../../src/core/check-runner.js';

// Cross-platform shims for the spawned-process tests below.
//
// The original tests used `echo` (Unix) and `false` directly — both unavailable
// as standalone binaries on Windows where they are cmd.exe builtins. Use the
// current host's interpreter (Bun or Node) with `-e` so we control the spawn
// target portably. `process.execPath` is the absolute path to that interpreter.
const EXEC = process.execPath;
const echoCmd = (output) => ({ cmd: EXEC, args: ['-e', `process.stdout.write(${JSON.stringify(output)})`] });
const failCmd = () => ({ cmd: EXEC, args: ['-e', 'process.exit(1)'] });
const TMP = tmpdir();

describe('createCheckRunner', () => {
  it('returns a function', () => {
    const runner = createCheckRunner({
      ...echoCmd('{}'),
      directory: TMP,
    });
    expect(typeof runner).toBe('function');
  });

  it('parses valid check output', async () => {
    const fakeOutput = JSON.stringify({
      files: [{
        path: 'test.liquid',
        offenses: [
          { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "params"', start_row: 2, start_column: 3 },
          { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter "bad"', start_row: 5, start_column: 10 },
          { check: 'ImgLazyLoading', severity: 0, message: 'Add loading="lazy"', start_row: 8, start_column: 0 },
        ],
      }],
    });

    const runner = createCheckRunner({
      ...echoCmd(fakeOutput),
      directory: TMP,
    });

    const result = await runner('test.liquid');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('UnknownFilter');
    expect(result.errors[0].severity).toBe('error');
    expect(result.errors[0].line).toBe(5);
    expect(result.errors[0].column).toBe(10);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].check).toBe('UndefinedObject');

    expect(result.infos).toHaveLength(1);
    expect(result.infos[0].check).toBe('ImgLazyLoading');

    expect(result.checks.has('UndefinedObject')).toBe(true);
    expect(result.checks.has('UnknownFilter')).toBe(true);
  });

  it('handles empty check output gracefully', async () => {
    const runner = createCheckRunner({
      ...echoCmd('{}'),
      directory: TMP,
    });

    const result = await runner();
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.infos).toHaveLength(0);
  });

  it('handles check failure gracefully', async () => {
    const runner = createCheckRunner({
      ...failCmd(),
      directory: TMP,
    });

    const result = await runner();
    expect(result.failed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
