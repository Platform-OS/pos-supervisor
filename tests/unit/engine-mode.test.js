import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getEngineMode, setEngineMode, isAdaptive,
  loadEngineMode, persistEngineMode, resetEngineMode,
  onEngineModeChange,
} from '../../src/core/engine-mode.js';
import {
  registerRule, clearRules, runRules,
  updateDisabledRules, getDisabledRules,
} from '../../src/core/rules/engine.js';

let tmpDir;

beforeEach(() => {
  resetEngineMode();
  clearRules();
  updateDisabledRules([]);
  tmpDir = mkdtempSync(join(tmpdir(), 'engine-mode-test-'));
  mkdirSync(join(tmpDir, '.pos-supervisor'), { recursive: true });
});

afterEach(() => {
  resetEngineMode();
  clearRules();
  updateDisabledRules([]);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('engine mode: core', () => {
  it('defaults to static', () => {
    expect(getEngineMode()).toBe('static');
    expect(isAdaptive()).toBe(false);
  });

  it('setEngineMode switches to adaptive', () => {
    setEngineMode('adaptive');
    expect(getEngineMode()).toBe('adaptive');
    expect(isAdaptive()).toBe(true);
  });

  it('setEngineMode switches back to static', () => {
    setEngineMode('adaptive');
    setEngineMode('static');
    expect(getEngineMode()).toBe('static');
    expect(isAdaptive()).toBe(false);
  });

  it('setEngineMode rejects invalid mode', () => {
    expect(() => setEngineMode('turbo')).toThrow(/Invalid engine mode/);
  });

  it('setEngineMode is a no-op when mode unchanged', () => {
    let callCount = 0;
    onEngineModeChange(() => callCount++);
    setEngineMode('static');
    expect(callCount).toBe(0);
  });
});

describe('engine mode: persistence', () => {
  it('persistEngineMode writes JSON file', () => {
    persistEngineMode(tmpDir, 'adaptive');
    const raw = JSON.parse(readFileSync(join(tmpDir, '.pos-supervisor', 'engine-mode.json'), 'utf-8'));
    expect(raw.mode).toBe('adaptive');
    expect(raw.updated_at).toBeDefined();
  });

  it('loadEngineMode reads from disk', () => {
    persistEngineMode(tmpDir, 'adaptive');
    resetEngineMode();
    expect(getEngineMode()).toBe('static');

    const mode = loadEngineMode(tmpDir);
    expect(mode).toBe('adaptive');
    expect(getEngineMode()).toBe('adaptive');
  });

  it('loadEngineMode returns static when file missing', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'engine-mode-empty-'));
    const mode = loadEngineMode(emptyDir);
    expect(mode).toBe('static');
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('setEngineMode with projectDir persists to disk', () => {
    setEngineMode('adaptive', { projectDir: tmpDir });
    const raw = JSON.parse(readFileSync(join(tmpDir, '.pos-supervisor', 'engine-mode.json'), 'utf-8'));
    expect(raw.mode).toBe('adaptive');
  });
});

describe('engine mode: listeners', () => {
  it('onEngineModeChange fires on transition', () => {
    const calls = [];
    onEngineModeChange((mode, prev) => calls.push({ mode, prev }));

    setEngineMode('adaptive');
    setEngineMode('static');

    expect(calls).toEqual([
      { mode: 'adaptive', prev: 'static' },
      { mode: 'static', prev: 'adaptive' },
    ]);
  });

  it('unsubscribe stops listener', () => {
    let callCount = 0;
    const unsub = onEngineModeChange(() => callCount++);

    setEngineMode('adaptive');
    expect(callCount).toBe(1);

    unsub();
    setEngineMode('static');
    expect(callCount).toBe(1);
  });

  it('listener errors are non-fatal', () => {
    onEngineModeChange(() => { throw new Error('boom'); });
    expect(() => setEngineMode('adaptive')).not.toThrow();
    expect(getEngineMode()).toBe('adaptive');
  });
});

describe('engine mode: onTransition callback', () => {
  it('fires onTransition with prev and new mode', () => {
    const transitions = [];
    setEngineMode('adaptive', {
      onTransition: (prev, mode) => transitions.push({ prev, mode }),
    });
    expect(transitions).toEqual([{ prev: 'static', mode: 'adaptive' }]);
  });
});

describe('engine mode: case-base scoring gate', () => {
  function makeRule(id) {
    return {
      id,
      check: 'Test',
      priority: 10,
      when: () => true,
      apply: () => ({ rule_id: id, hint_md: 'test', fixes: [], confidence: 0.5 }),
    };
  }

  it('static mode skips case-base scoring (confidence unchanged)', () => {
    registerRule(makeRule('Test.rule'));
    const mockStore = {
      queryOne: () => ({ emitted: 100 }),
      query: () => [{ outcome: 'resolved', cnt: 90 }],
    };

    const result = runRules(
      { check: 'Test', template_fp: 'abc123' },
      { analyticsStore: mockStore },
    );
    expect(result.confidence).toBe(0.5);
    expect(result.case_base_signal).toBeUndefined();
  });

  it('adaptive mode applies case-base scoring', () => {
    setEngineMode('adaptive');
    registerRule(makeRule('Test.rule'));
    const mockStore = {
      queryOne: () => ({ emitted: 100 }),
      query: () => [{ outcome: 'resolved', cnt: 90 }, { outcome: 'regressed', cnt: 5 }],
    };

    const result = runRules(
      { check: 'Test', template_fp: 'abc123' },
      { analyticsStore: mockStore },
    );
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.case_base_signal).toBeDefined();
  });
});
