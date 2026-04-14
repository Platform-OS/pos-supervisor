/**
 * Phase 1.6 — invalidateProjectMap() resets the cache so the next
 * getProjectMap() call re-scans the project.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getProjectMap, invalidateProjectMap } from '../../src/tools/project-map.js';

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'project-map-inval-'));
  mkdirSync(join(projectDir, 'app', 'views', 'partials', 'widgets'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'views', 'partials', 'widgets', 'one.liquid'), '<div>1</div>\n');
  // Starting point: one partial on disk.
  invalidateProjectMap();
});

afterEach(() => {
  invalidateProjectMap();
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

describe('invalidateProjectMap', () => {
  it('forces a fresh scan so files written after the first call are visible', async () => {
    const first = await getProjectMap(projectDir);
    const firstKeys = Object.keys(first.partials ?? {});
    expect(firstKeys).toContain('widgets/one');

    // Add a second partial after the cache is warm.
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'widgets', 'two.liquid'),
      '<div>2</div>\n',
    );

    // Without invalidation, cache returns the stale scan.
    const stale = await getProjectMap(projectDir);
    expect(Object.keys(stale.partials ?? {})).not.toContain('widgets/two');

    // After invalidation, the next call does a fresh scan.
    invalidateProjectMap();
    const fresh = await getProjectMap(projectDir);
    expect(Object.keys(fresh.partials ?? {})).toContain('widgets/two');
  });

  it('is a no-op when called with no cache populated', () => {
    // Should not throw.
    invalidateProjectMap();
    invalidateProjectMap();
  });

  it('next call after invalidation reflects deletions, not just additions', async () => {
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'widgets', 'gone.liquid'),
      '<div>gone</div>\n',
    );
    invalidateProjectMap();
    const warm = await getProjectMap(projectDir);
    expect(Object.keys(warm.partials ?? {})).toContain('widgets/gone');

    unlinkSync(join(projectDir, 'app', 'views', 'partials', 'widgets', 'gone.liquid'));
    invalidateProjectMap();
    const fresh = await getProjectMap(projectDir);
    expect(Object.keys(fresh.partials ?? {})).not.toContain('widgets/gone');
  });
});
