/**
 * Module-scanner manifest precedence + drift detection (Phase 4 of the
 * pos-cli 6.0.7 alignment plan, 2026-04-25).
 *
 * Senior-dev contract: `pos-module.json` is the upstream platformOS
 * authoritative manifest. `template-values.json` is a generated mirror that
 * can drift if module deps are added without re-running `pos-cli modules
 * version`. `package.json` is npm metadata — its `version` is unrelated to
 * the platformOS module version. The scanner must reflect this hierarchy.
 *
 * These tests run with throwaway fixtures so they cannot interfere with the
 * shared module-scanner.test.js fixture (which only ships template-values.json).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanModule, listModules } from '../../src/core/module-scanner.js';

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'module-scanner-manifest-'));
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

function write(relPath, content) {
  const abs = join(projectDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

describe('module-scanner: manifest precedence', () => {
  it('pos-module.json wins over template-values.json when both exist', async () => {
    write('modules/user/pos-module.json', JSON.stringify({
      machine_name: 'user',
      name: 'User',
      version: '5.2.8',
      dependencies: { core: '^2.1.8', 'common-styling': '^1.11.0', oauth_github: '^0.0.12' },
    }));
    write('modules/user/template-values.json', JSON.stringify({
      name: 'User (template-values)',
      machine_name: 'user',
      type: 'module',
      version: '5.2.8',
      dependencies: { core: '^2.1.8', 'common-styling': '^1.11.0' }, // missing oauth_github
    }));
    write('modules/user/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'user');

    expect(scan.version).toBe('5.2.8');
    // Authoritative dependency list comes from pos-module.json (3 entries).
    expect(scan.dependencies.oauth_github).toBe('^0.0.12');
    expect(Object.keys(scan.dependencies)).toHaveLength(3);
    expect(scan.manifest_source).toBe('pos-module.json');
    // Display name comes from pos-module.json's `name`, not template-values.
    expect(scan.display_name).toBe('User');
  });

  it('falls back to template-values.json when pos-module.json is absent', async () => {
    write('modules/legacy/template-values.json', JSON.stringify({
      name: 'Legacy',
      machine_name: 'legacy',
      type: 'module',
      version: '0.9.0',
      dependencies: { core: '^1.0.0' },
    }));
    write('modules/legacy/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'legacy');

    expect(scan.version).toBe('0.9.0');
    expect(scan.dependencies.core).toBe('^1.0.0');
    expect(scan.manifest_source).toBe('template-values.json');
    expect(scan.manifest_warnings).toBeUndefined();
  });

  it('falls back to package.json when neither platformOS manifest exists', async () => {
    write('modules/npm-only/package.json', JSON.stringify({
      name: 'pos-module-npm-only',
      version: '3.1.4',
      dependencies: { foo: '^1.0.0' },
    }));
    write('modules/npm-only/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'npm-only');

    expect(scan.version).toBe('3.1.4');
    expect(scan.dependencies.foo).toBe('^1.0.0');
    expect(scan.manifest_source).toBe('package.json');
  });

  it('returns sentinel manifest_source: null when no manifest is present', async () => {
    write('modules/bare/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'bare');

    expect(scan.version).toBe('unknown');
    expect(scan.dependencies).toEqual({});
    expect(scan.manifest_source).toBeNull();
  });

  it('listModules surfaces manifest_source for every module', async () => {
    write('modules/a/pos-module.json', JSON.stringify({ name: 'A', version: '1.0.0', dependencies: {} }));
    write('modules/b/template-values.json', JSON.stringify({ name: 'B', version: '2.0.0', dependencies: {} }));
    write('modules/c/package.json', JSON.stringify({ name: 'C', version: '3.0.0' }));

    const list = await listModules(projectDir);
    const byName = Object.fromEntries(list.map(m => [m.name, m.manifest_source]));

    expect(byName.a).toBe('pos-module.json');
    expect(byName.b).toBe('template-values.json');
    expect(byName.c).toBe('package.json');
  });

  it('malformed pos-module.json falls through to template-values.json', async () => {
    write('modules/broken/pos-module.json', '{ not valid json');
    write('modules/broken/template-values.json', JSON.stringify({
      name: 'Broken',
      version: '1.0.0',
      dependencies: {},
    }));
    write('modules/broken/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'broken');

    expect(scan.version).toBe('1.0.0');
    expect(scan.manifest_source).toBe('template-values.json');
  });
});

describe('module-scanner: manifest drift detection', () => {
  it('flags dependency_drift when pos-module.json adds deps missing from template-values.json', async () => {
    write('modules/user/pos-module.json', JSON.stringify({
      name: 'User',
      version: '5.2.8',
      dependencies: { core: '^2.1.8', 'common-styling': '^1.11.0', oauth_github: '^0.0.12' },
    }));
    write('modules/user/template-values.json', JSON.stringify({
      name: 'User',
      version: '5.2.8',
      dependencies: { core: '^2.1.8', 'common-styling': '^1.11.0' },
    }));
    write('modules/user/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'user');
    expect(Array.isArray(scan.manifest_warnings)).toBe(true);
    const drift = scan.manifest_warnings.find(w => w.kind === 'dependency_drift');
    expect(drift).toBeDefined();
    expect(drift.only_in_pos_module).toEqual(['oauth_github']);
    expect(drift.only_in_template_values).toEqual([]);
    expect(drift.message).toMatch(/oauth_github/);
    expect(drift.message).toMatch(/pos-cli modules version/);
  });

  it('flags drift in the other direction (template-values has extra deps)', async () => {
    write('modules/x/pos-module.json', JSON.stringify({
      name: 'X',
      version: '1.0.0',
      dependencies: { core: '^1.0.0' },
    }));
    write('modules/x/template-values.json', JSON.stringify({
      name: 'X',
      version: '1.0.0',
      dependencies: { core: '^1.0.0', stray: '^9.9.9' },
    }));
    write('modules/x/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'x');
    const drift = scan.manifest_warnings.find(w => w.kind === 'dependency_drift');
    expect(drift.only_in_template_values).toEqual(['stray']);
    expect(drift.only_in_pos_module).toEqual([]);
  });

  it('flags version_drift when the two files report different versions', async () => {
    write('modules/x/pos-module.json', JSON.stringify({
      name: 'X',
      version: '2.0.0',
      dependencies: {},
    }));
    write('modules/x/template-values.json', JSON.stringify({
      name: 'X',
      version: '1.0.0',
      dependencies: {},
    }));
    write('modules/x/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'x');
    const v = scan.manifest_warnings.find(w => w.kind === 'version_drift');
    expect(v).toBeDefined();
    expect(v.pos_module).toBe('2.0.0');
    expect(v.template_values).toBe('1.0.0');
    // Authoritative version is pos-module.json's.
    expect(scan.version).toBe('2.0.0');
  });

  it('does NOT emit manifest_warnings when both manifests agree', async () => {
    write('modules/x/pos-module.json', JSON.stringify({
      name: 'X',
      version: '1.0.0',
      dependencies: { core: '^1.0.0' },
    }));
    write('modules/x/template-values.json', JSON.stringify({
      name: 'X',
      version: '1.0.0',
      dependencies: { core: '^1.0.0' },
    }));
    write('modules/x/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'x');
    expect(scan.manifest_warnings).toBeUndefined();
  });

  it('does NOT emit manifest_warnings when only one manifest exists', async () => {
    // Only pos-module.json — no peer to compare against.
    write('modules/a/pos-module.json', JSON.stringify({
      name: 'A',
      version: '1.0.0',
      dependencies: { core: '^1.0.0' },
    }));
    write('modules/a/public/lib/helpers/noop.liquid', '{% return null %}');

    const scan = await scanModule(projectDir, 'a');
    expect(scan.manifest_warnings).toBeUndefined();
    expect(scan.manifest_source).toBe('pos-module.json');
  });
});
