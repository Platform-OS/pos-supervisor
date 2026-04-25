import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadOverrides, saveOverrides,
  addForceEnable, addForceDisable, removeOverride,
  overrideSets,
} from '../../src/core/rule-overrides.js';

let projectDir;

beforeEach(() => {
  projectDir = join(tmpdir(), `pos-overrides-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

describe('rule-overrides: read/write', () => {
  test('loadOverrides on missing file returns empty state', () => {
    const s = loadOverrides(projectDir);
    expect(s.force_enable).toEqual({});
    expect(s.force_disable).toEqual({});
  });

  test('addForceEnable persists with ts + reason', () => {
    const s = addForceEnable(projectDir, 'Foo.bar', 'testing');
    expect(s.force_enable['Foo.bar'].reason).toBe('testing');
    expect(typeof s.force_enable['Foo.bar'].ts).toBe('string');

    // Round-trip: re-read from disk.
    const loaded = loadOverrides(projectDir);
    expect(loaded.force_enable['Foo.bar'].reason).toBe('testing');
  });

  test('force_enable and force_disable are mutually exclusive', () => {
    addForceDisable(projectDir, 'Foo.bar', 'kill');
    const s = addForceEnable(projectDir, 'Foo.bar', 'unkill');
    expect(s.force_enable['Foo.bar']).toBeDefined();
    expect(s.force_disable['Foo.bar']).toBeUndefined();
  });

  test('removeOverride clears both kinds', () => {
    addForceEnable(projectDir, 'A.x');
    addForceDisable(projectDir, 'B.y');
    const s = removeOverride(projectDir, 'A.x');
    expect(s.force_enable['A.x']).toBeUndefined();
    expect(s.force_disable['B.y']).toBeDefined();
  });

  test('malformed JSON file → empty state (never throws)', () => {
    const path = join(projectDir, '.pos-supervisor', 'rule-overrides.json');
    mkdirSync(join(projectDir, '.pos-supervisor'), { recursive: true });
    writeFileSync(path, '{not json');
    let logged = null;
    const s = loadOverrides(projectDir, { log: (m) => { logged = m; } });
    expect(s.force_enable).toEqual({});
    expect(s.force_disable).toEqual({});
    expect(logged).toContain('failed to parse');
  });

  test('force_enable or force_disable not object → empty state', () => {
    const path = join(projectDir, '.pos-supervisor', 'rule-overrides.json');
    mkdirSync(join(projectDir, '.pos-supervisor'), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, force_enable: 'lol', force_disable: {} }));
    const s = loadOverrides(projectDir);
    expect(s.force_enable).toEqual({});
  });

  test('overrideSets converts object maps to Sets', () => {
    const state = { force_enable: { 'A.x': {} }, force_disable: { 'B.y': {} } };
    const { force_enable, force_disable } = overrideSets(state);
    expect(force_enable.has('A.x')).toBe(true);
    expect(force_disable.has('B.y')).toBe(true);
  });
});
