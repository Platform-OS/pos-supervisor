import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installedModules,
  moduleInstalled,
  moduleCallPathsByCategory,
  moduleCallPaths,
} from '../../../src/core/rules/module-paths.js';

let projectDir;

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'modpaths-'));

  const writeFile = (rel, content = '') => {
    const abs = join(projectDir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  // core: lib-style layout
  writeFile('modules/core/public/lib/commands/execute.liquid');
  writeFile('modules/core/public/lib/commands/email/send/build.liquid');
  writeFile('modules/core/public/lib/commands/email/send/check.liquid');
  writeFile('modules/core/public/lib/queries/users/find.liquid');
  writeFile('modules/core/public/lib/helpers/auth_token.liquid');
  writeFile('modules/core/public/lib/validations/presence.liquid');
  writeFile('modules/core/public/views/partials/widget.liquid');

  // legacy: views/partials/lib layout
  writeFile('modules/legacy/public/views/partials/lib/commands/old_create.liquid');
  writeFile('modules/legacy/public/views/partials/lib/queries/old_find.liquid');
  writeFile('modules/legacy/public/views/partials/banner.liquid');

  // empty module
  mkdirSync(join(projectDir, 'modules', 'empty'), { recursive: true });
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('module-paths.installedModules', () => {
  test('lists every directory under modules/', () => {
    expect(installedModules(projectDir)).toEqual(['core', 'empty', 'legacy']);
  });

  test('returns [] when modules/ is missing', () => {
    expect(installedModules('/nonexistent')).toEqual([]);
  });

  test('returns [] when projectDir is null', () => {
    expect(installedModules(null)).toEqual([]);
  });
});

describe('module-paths.moduleInstalled', () => {
  test('true for present module', () => {
    expect(moduleInstalled(projectDir, 'core')).toBe(true);
  });

  test('false for absent module', () => {
    expect(moduleInstalled(projectDir, 'ghost')).toBe(false);
  });

  test('false on null inputs', () => {
    expect(moduleInstalled(null, 'core')).toBe(false);
    expect(moduleInstalled(projectDir, null)).toBe(false);
  });
});

describe('module-paths.moduleCallPathsByCategory', () => {
  test('groups core lib exports by category with full call_paths', () => {
    const out = moduleCallPathsByCategory(projectDir, 'core');
    expect(out.commands).toEqual([
      'modules/core/commands/email/send/build',
      'modules/core/commands/email/send/check',
      'modules/core/commands/execute',
    ]);
    expect(out.queries).toEqual(['modules/core/queries/users/find']);
    expect(out.helpers).toEqual(['modules/core/helpers/auth_token']);
    expect(out.validations).toEqual(['modules/core/validations/presence']);
    expect(out.partials).toContain('modules/core/widget');
  });

  test('falls back to views/partials/lib for legacy layout', () => {
    const out = moduleCallPathsByCategory(projectDir, 'legacy');
    expect(out.commands).toEqual(['modules/legacy/commands/old_create']);
    expect(out.queries).toEqual(['modules/legacy/queries/old_find']);
    expect(out.partials).toContain('modules/legacy/banner');
  });

  test('returns empty buckets for an empty module', () => {
    const out = moduleCallPathsByCategory(projectDir, 'empty');
    expect(out.commands).toEqual([]);
    expect(out.queries).toEqual([]);
    expect(out.partials).toEqual([]);
  });

  test('returns empty buckets when module is absent', () => {
    const out = moduleCallPathsByCategory(projectDir, 'ghost');
    expect(Object.values(out).every(v => v.length === 0)).toBe(true);
  });
});

describe('module-paths.moduleCallPaths', () => {
  test('flattens every callable across categories', () => {
    const flat = moduleCallPaths(projectDir, 'core');
    expect(flat).toContain('modules/core/commands/execute');
    expect(flat).toContain('modules/core/queries/users/find');
    expect(flat).toContain('modules/core/helpers/auth_token');
    expect(flat).toContain('modules/core/validations/presence');
    expect(flat).toContain('modules/core/widget');
  });
});
