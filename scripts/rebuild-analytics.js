#!/usr/bin/env node
/**
 * Rebuild the analytics DB from session event logs.
 *
 * Usage:
 *   node scripts/rebuild-analytics.js /path/to/project
 *
 * The project must have a .pos-supervisor/ directory with sessions/ and analytics.db.
 * The server must NOT be running when this script executes (WAL mode allows reads
 * but schema migrations can conflict with a live server).
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openAnalyticsStore } from '../src/core/analytics-store.js';
import { openBlobStore } from '../src/core/blob-store.js';

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('Usage: node scripts/rebuild-analytics.js /path/to/project');
  process.exit(1);
}

const supervisorDir = join(projectDir, '.pos-supervisor');
const dbPath        = join(supervisorDir, 'analytics.db');
const sessionsDir   = join(supervisorDir, 'sessions');
const blobsDir      = join(supervisorDir, 'blobs');

if (!existsSync(supervisorDir)) {
  console.error(`No .pos-supervisor directory found at: ${supervisorDir}`);
  process.exit(1);
}
if (!existsSync(sessionsDir)) {
  console.error(`No sessions directory found at: ${sessionsDir}`);
  process.exit(1);
}

console.log(`DB:       ${dbPath}`);
console.log(`Sessions: ${sessionsDir}`);
console.log(`Blobs:    ${blobsDir}`);
console.log('Rebuilding...');

// Blob store is required for fix-adoption classification (reads start/end file
// snapshots and proposed-fix texts). Without it, every outcome row lands with
// fix_applied = null. Fine if the blobs dir doesn't exist yet — classification
// just degrades to null for that session.
let blobStore = null;
try {
  blobStore = openBlobStore(blobsDir);
} catch (e) {
  console.warn(`Blob store unavailable (${e.message}); fix adoption will not be classified.`);
}

const store = openAnalyticsStore(dbPath, { blobStore });
const { sessions, events } = store.rebuild(sessionsDir);

console.log(`Done. Replayed ${events} events across ${sessions} sessions.`);
