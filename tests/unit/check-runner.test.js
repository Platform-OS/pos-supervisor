import { describe, it, expect } from 'bun:test';
import { createCheckRunner } from '../../src/core/check-runner.js';

describe('createCheckRunner', () => {
  it('returns a function', () => {
    const runner = createCheckRunner({
      cmd: 'echo',
      args: ['{}'],
      directory: '/tmp',
    });
    expect(typeof runner).toBe('function');
  });

  it('parses valid check output', async () => {
    const fakeOutput = JSON.stringify({
      files: [{
        path: '/tmp/test.liquid',
        offenses: [
          { check: 'UndefinedObject', severity: 'warning', message: 'Unknown object "params"', start_row: 2, start_column: 3 },
          { check: 'UnknownFilter', severity: 'error', message: 'Unknown filter "bad"', start_row: 5, start_column: 10 },
          { check: 'ImgLazyLoading', severity: 0, message: 'Add loading="lazy"', start_row: 8, start_column: 0 },
        ],
      }],
    });

    const runner = createCheckRunner({
      cmd: 'echo',
      args: [fakeOutput],
      directory: '/tmp',
    });

    const result = await runner('/tmp/test.liquid');

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
      cmd: 'echo',
      args: ['{}'],
      directory: '/tmp',
    });

    const result = await runner();
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.infos).toHaveLength(0);
  });

  it('handles check failure gracefully', async () => {
    const runner = createCheckRunner({
      cmd: 'false', // always fails
      args: [],
      directory: '/tmp',
    });

    const result = await runner();
    expect(result.failed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
