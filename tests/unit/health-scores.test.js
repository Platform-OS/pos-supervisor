import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openAnalyticsStore } from '../../src/core/analytics-store.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpPath() {
  return join(tmpdir(), `pos-health-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('K1: health score history', () => {
  let store;
  beforeEach(() => { store = openAnalyticsStore(tmpPath()); });
  afterEach(() => { store.close(); });

  test('insertHealthScore and getHealthScores round-trip', () => {
    store.insertHealthScore({
      score: 72,
      mode: 'project',
      dimensions: { errors: 90, warnings: 80, orphaned: 65, coverage: 55 },
    });

    const scores = store.getHealthScores({ limit: 10 });
    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBe(72);
    expect(scores[0].mode).toBe('project');
    expect(scores[0].dimensions).toEqual({ errors: 90, warnings: 80, orphaned: 65, coverage: 55 });
    expect(scores[0].ts).toBeTruthy();
  });

  test('getHealthScores returns chronological order', () => {
    store.insertHealthScore({ score: 50, mode: 'project', dimensions: {} });
    store.insertHealthScore({ score: 60, mode: 'project', dimensions: {} });
    store.insertHealthScore({ score: 70, mode: 'project', dimensions: {} });

    const scores = store.getHealthScores({ limit: 10 });
    expect(scores).toHaveLength(3);
    expect(scores[0].score).toBe(50);
    expect(scores[1].score).toBe(60);
    expect(scores[2].score).toBe(70);
  });

  test('getHealthScores respects limit', () => {
    for (let i = 0; i < 10; i++) {
      store.insertHealthScore({ score: i * 10, mode: 'project', dimensions: {} });
    }

    const scores = store.getHealthScores({ limit: 3 });
    expect(scores).toHaveLength(3);
    expect(scores[0].score).toBe(70);
    expect(scores[2].score).toBe(90);
  });

  test('getHealthScores filters by mode', () => {
    store.insertHealthScore({ score: 50, mode: 'project', dimensions: {} });
    store.insertHealthScore({ score: 80, mode: 'infrastructure', dimensions: {} });
    store.insertHealthScore({ score: 60, mode: 'project', dimensions: {} });

    const projectScores = store.getHealthScores({ mode: 'project' });
    expect(projectScores).toHaveLength(2);
    expect(projectScores.every(s => s.mode === 'project')).toBe(true);

    const infraScores = store.getHealthScores({ mode: 'infrastructure' });
    expect(infraScores).toHaveLength(1);
    expect(infraScores[0].score).toBe(80);
  });

  test('getHealthScores returns empty for no data', () => {
    const scores = store.getHealthScores();
    expect(scores).toEqual([]);
  });

  test('health_scores table survives rebuild', () => {
    store.insertHealthScore({ score: 75, mode: 'project', dimensions: { x: 1 } });

    const { mkdirSync } = require('node:fs');
    const sessionsDir = join(tmpdir(), `pos-health-sessions-${Date.now()}`);
    mkdirSync(sessionsDir, { recursive: true });
    store.rebuild(sessionsDir);

    const scores = store.getHealthScores();
    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBe(75);

    const { rmSync } = require('node:fs');
    try { rmSync(sessionsDir, { recursive: true }); } catch {}
  });
});
