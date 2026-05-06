#!/usr/bin/env bun
/**
 * One-off cleanup — remove analytics rows that originated from the dashboard
 * Live Diagnostic Console before A3 introduced the `untracked` gate.
 *
 * Symptom those rows caused: `__pos_live_console__` files appearing in the
 * `OrphanedPartial` and `pos-supervisor:MissingDocBlock` file distributions
 * of the supervisor report. Every live-console validation wrote a
 * `validator_emit` that the store replayed into diagnostics/outcomes.
 *
 * Usage:
 *   bun scripts/cleanup-live-console-rows.js [/path/to/project]
 *
 * Project path defaults to POS_SUPERVISOR_PROJECT_DIR or the current working
 * directory. Runs against `.pos-supervisor/analytics.db` under that project.
 *
 * Safe to re-run — purely a DELETE of rows whose file column matches the
 * live-console sentinel. No schema changes.
 */

import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openAnalyticsStore } from '../src/core/analytics-store.js';

const LIVE_CONSOLE_NEEDLE = '__pos_live_console__';

function parseArgs() {
  const projectArg = process.argv[2];
  const projectDir = resolve(projectArg ?? process.env.POS_SUPERVISOR_PROJECT_DIR ?? process.cwd());
  return { projectDir };
}

function main() {
  const { projectDir } = parseArgs();
  const dbPath = join(projectDir, '.pos-supervisor', 'analytics.db');

  if (!existsSync(dbPath)) {
    console.error(`No analytics DB at ${dbPath}. Nothing to clean.`);
    process.exit(0);
  }

  const store = openAnalyticsStore(dbPath);
  const db = store.db;

  const beforeCounts = {
    events: db.prepare(`SELECT COUNT(*) AS n FROM events WHERE payload LIKE ?`).get(`%${LIVE_CONSOLE_NEEDLE}%`).n,
    diagnostics: db.prepare(`SELECT COUNT(*) AS n FROM diagnostics WHERE file LIKE ?`).get(`%${LIVE_CONSOLE_NEEDLE}%`).n,
    outcomes: db.prepare(`SELECT COUNT(*) AS n FROM outcomes WHERE file LIKE ?`).get(`%${LIVE_CONSOLE_NEEDLE}%`).n,
    windows: db.prepare(`SELECT COUNT(*) AS n FROM windows WHERE file LIKE ?`).get(`%${LIVE_CONSOLE_NEEDLE}%`).n,
    proposed_fixes: db.prepare(
      `SELECT COUNT(*) AS n FROM proposed_fixes pf
       WHERE EXISTS (SELECT 1 FROM diagnostics d WHERE d.fp = pf.fp AND d.file LIKE ?)`,
    ).get(`%${LIVE_CONSOLE_NEEDLE}%`).n,
  };

  db.exec('BEGIN');
  try {
    db.prepare(
      `DELETE FROM proposed_fixes
       WHERE fp IN (SELECT fp FROM diagnostics WHERE file LIKE ?)`,
    ).run(`%${LIVE_CONSOLE_NEEDLE}%`);

    db.prepare(
      `DELETE FROM outcomes WHERE file LIKE ?`,
    ).run(`%${LIVE_CONSOLE_NEEDLE}%`);

    db.prepare(
      `DELETE FROM windows WHERE file LIKE ?`,
    ).run(`%${LIVE_CONSOLE_NEEDLE}%`);

    db.prepare(
      `DELETE FROM diagnostics WHERE file LIKE ?`,
    ).run(`%${LIVE_CONSOLE_NEEDLE}%`);

    db.prepare(
      `DELETE FROM events WHERE payload LIKE ?`,
    ).run(`%${LIVE_CONSOLE_NEEDLE}%`);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Cleanup failed; rolled back.');
    throw e;
  }

  console.log(`Removed live-console rows from ${dbPath}:`);
  for (const [table, count] of Object.entries(beforeCounts)) {
    console.log(`  ${table.padEnd(16)} ${count}`);
  }

  store.close();
}

main();
