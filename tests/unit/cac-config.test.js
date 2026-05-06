import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadCacConfig, saveCacConfig, updateCacConfig,
  defaultCacConfig, VALID_MODES, VALID_ACTIONS,
} from '../../src/core/cac-config.js';

let projectDir;

beforeEach(() => {
  projectDir = join(tmpdir(), `pos-cac-cfg-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

describe('cac-config: defaults + load', () => {
  test('default state is disabled, shadow mode', () => {
    const def = defaultCacConfig();
    expect(def.enabled).toBe(false);
    expect(def.mode).toBe('shadow');
    expect(def.action).toBe('downgrade');
    expect(def.threshold).toBeGreaterThan(0);
    expect(def.threshold).toBeLessThan(1);
    expect(def.min_samples).toBeGreaterThanOrEqual(1);
  });

  test('VALID_MODES and VALID_ACTIONS exposed for UI', () => {
    expect(VALID_MODES).toContain('shadow');
    expect(VALID_MODES).toContain('active');
    expect(VALID_ACTIONS).toContain('downgrade');
    expect(VALID_ACTIONS).toContain('suppress');
  });

  test('loadCacConfig on missing file returns defaults (no throw)', () => {
    const s = loadCacConfig(projectDir);
    expect(s).toEqual(defaultCacConfig());
  });

  test('loadCacConfig on malformed JSON returns defaults + logs', () => {
    const path = join(projectDir, '.pos-supervisor', 'cac-config.json');
    mkdirSync(join(projectDir, '.pos-supervisor'), { recursive: true });
    writeFileSync(path, '{not json');
    let logged = null;
    const s = loadCacConfig(projectDir, { log: (m) => { logged = m; } });
    expect(s).toEqual(defaultCacConfig());
    expect(logged).toContain('failed to parse');
  });
});

describe('cac-config: save + round-trip', () => {
  test('saveCacConfig persists and round-trips', () => {
    saveCacConfig(projectDir, { enabled: true, mode: 'active', threshold: 0.5, action: 'suppress', min_samples: 10 });
    const loaded = loadCacConfig(projectDir);
    expect(loaded.enabled).toBe(true);
    expect(loaded.mode).toBe('active');
    expect(loaded.threshold).toBe(0.5);
    expect(loaded.action).toBe('suppress');
    expect(loaded.min_samples).toBe(10);
  });

  test('saveCacConfig coerces invalid mode to default', () => {
    saveCacConfig(projectDir, { enabled: true, mode: 'turbo', threshold: 0.4 });
    const loaded = loadCacConfig(projectDir);
    expect(loaded.mode).toBe('shadow');     // coerced from invalid
    expect(loaded.threshold).toBe(0.4);     // valid, kept
    expect(loaded.enabled).toBe(true);      // valid, kept
  });

  test('saveCacConfig clamps out-of-range threshold to default', () => {
    saveCacConfig(projectDir, { threshold: 1.5 });
    const loaded = loadCacConfig(projectDir);
    expect(loaded.threshold).toBe(defaultCacConfig().threshold);
  });

  test('saveCacConfig rejects negative min_samples', () => {
    saveCacConfig(projectDir, { min_samples: -3 });
    const loaded = loadCacConfig(projectDir);
    expect(loaded.min_samples).toBe(defaultCacConfig().min_samples);
  });

  test('saveCacConfig writes valid JSON file with version', () => {
    saveCacConfig(projectDir, { enabled: true });
    const path = join(projectDir, '.pos-supervisor', 'cac-config.json');
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.enabled).toBe(true);
  });
});

describe('cac-config: update (patch)', () => {
  test('updateCacConfig merges into existing state', () => {
    saveCacConfig(projectDir, { enabled: true, threshold: 0.4 });
    const next = updateCacConfig(projectDir, { mode: 'active' });
    expect(next.enabled).toBe(true);     // preserved
    expect(next.threshold).toBe(0.4);    // preserved
    expect(next.mode).toBe('active');    // patched
  });

  test('updateCacConfig drops unknown keys silently', () => {
    const next = updateCacConfig(projectDir, { enabled: true, sneaky: 42 });
    expect(next.enabled).toBe(true);
    expect(next).not.toHaveProperty('sneaky');
  });
});

describe('cac-config: file-state guarantees', () => {
  test('force_enable not object would corrupt rule-overrides — verify cac is robust to similar', () => {
    const path = join(projectDir, '.pos-supervisor', 'cac-config.json');
    mkdirSync(join(projectDir, '.pos-supervisor'), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, enabled: 'lol' }));
    const loaded = loadCacConfig(projectDir);
    // 'lol' is not a boolean → coerced to default
    expect(loaded.enabled).toBe(false);
  });
});
