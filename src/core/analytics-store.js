/**
 * SQLite analytics cache — derived from session NDJSON event logs.
 *
 * The DB at `.pos-supervisor/analytics.db` is disposable: it can be
 * rebuilt from event logs at any time via `rebuild()`. Never write
 * truth here — only derived data.
 *
 * Uses WAL mode for concurrent reads during long writes (rebuild).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readEventLog } from './session-events.js';
import { classifySession, computeCollateral } from './window-classifier.js';

let _Database = null;
function getDatabase() {
  if (!_Database) {
    try {
      _Database = require('bun:sqlite').Database;
    } catch {
      throw new Error('bun:sqlite not available — analytics store requires Bun runtime');
    }
  }
  return _Database;
}

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    ts         TEXT    NOT NULL,
    payload    TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_kind    ON events(kind);
  CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);

  CREATE TABLE IF NOT EXISTS diagnostics (
    fp           TEXT NOT NULL,
    template_fp  TEXT,
    session_id   TEXT NOT NULL,
    file         TEXT NOT NULL,
    check_name   TEXT NOT NULL,
    severity     TEXT,
    ts           TEXT NOT NULL,
    hint_rule_id TEXT,
    content_hash TEXT,
    suppressed   INTEGER DEFAULT 0,
    confidence   REAL
  );
  CREATE INDEX IF NOT EXISTS idx_diag_fp       ON diagnostics(fp);
  CREATE INDEX IF NOT EXISTS idx_diag_session  ON diagnostics(session_id);
  CREATE INDEX IF NOT EXISTS idx_diag_check    ON diagnostics(check_name);
  CREATE INDEX IF NOT EXISTS idx_diag_file     ON diagnostics(file);

  CREATE TABLE IF NOT EXISTS proposed_fixes (
    fp            TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    ts            TEXT NOT NULL,
    range_json    TEXT,
    new_text_hash TEXT,
    kind          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fixes_fp ON proposed_fixes(fp);

  CREATE TABLE IF NOT EXISTS windows (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id         TEXT NOT NULL,
    file               TEXT NOT NULL,
    idx                INTEGER NOT NULL,
    ts_start           TEXT NOT NULL,
    ts_end             TEXT NOT NULL,
    content_hash_start TEXT,
    content_hash_end   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_windows_session ON windows(session_id);
  CREATE INDEX IF NOT EXISTS idx_windows_file    ON windows(session_id, file);

  CREATE TABLE IF NOT EXISTS outcomes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fp              TEXT NOT NULL,
    window_id       INTEGER NOT NULL REFERENCES windows(id),
    outcome         TEXT NOT NULL,
    fix_applied     TEXT,
    collateral_added INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_outcomes_fp     ON outcomes(fp);
  CREATE INDEX IF NOT EXISTS idx_outcomes_window ON outcomes(window_id);

  CREATE TABLE IF NOT EXISTS rule_promotions (
    rule_id     TEXT PRIMARY KEY,
    check_name  TEXT NOT NULL,
    template_fp TEXT NOT NULL,
    promoted_at TEXT NOT NULL,
    probation   INTEGER DEFAULT 1,
    resolved_at TEXT,
    resolution  TEXT
  );

  CREATE TABLE IF NOT EXISTS health_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT    NOT NULL,
    score      INTEGER NOT NULL,
    mode       TEXT    NOT NULL,
    dimensions TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_health_ts ON health_scores(ts);
`;

export function openAnalyticsStore(dbPath, { readonly = false } = {}) {
  if (!dbPath) throw new Error('openAnalyticsStore: dbPath required');
  mkdirSync(dirname(dbPath), { recursive: true });

  const Database = getDatabase();
  const dbOpts = readonly ? { readonly: true } : { create: true, readwrite: true };
  const db = new Database(dbPath, dbOpts);
  if (!readonly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    setMeta(db, 'schema_version', String(SCHEMA_VERSION));
  }

  const stmts = readonly ? {} : prepareStatements(db);

  function close() {
    try { db.close(); } catch {}
  }

  function ingestEvent(event) {
    const { v, session_id, ts, kind, ...payload } = event;
    stmts.insertEvent.run(session_id, kind, ts, JSON.stringify(payload));

    if (kind === 'validator_emit') {
      ingestValidatorEmit(event, stmts);
    }
  }

  function ingestSession(sessionDir) {
    const eventsPath = join(sessionDir, 'events.ndjson');
    if (!existsSync(eventsPath)) return 0;
    const events = readEventLog(eventsPath);
    db.exec('BEGIN');
    try {
      for (const event of events) {
        ingestEvent(event);
      }
      classifyAndStoreWindows(events);
      db.exec('COMMIT');
      return events.length;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function classifyAndStoreWindows(events) {
    const windowResults = classifySession(events);
    for (const { window: w, outcomes } of windowResults) {
      const collateral = computeCollateral(outcomes);
      const windowId = insertWindow(w);
      for (const o of outcomes) {
        insertOutcome({
          fp: o.fp,
          window_id: windowId,
          outcome: o.outcome,
          fix_applied: null,
          collateral_added: o.outcome === 'regressed' ? collateral : 0,
        });
      }
    }
  }

  function rebuild(sessionsDir) {
    if (!existsSync(sessionsDir)) return { sessions: 0, events: 0 };
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM outcomes');
      db.exec('DELETE FROM windows');
      db.exec('DELETE FROM proposed_fixes');
      db.exec('DELETE FROM diagnostics');
      db.exec('DELETE FROM events');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    let totalEvents = 0;
    let totalSessions = 0;
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = join(sessionsDir, entry.name);
      const count = ingestSession(sessionDir);
      if (count > 0) totalSessions++;
      totalEvents += count;
    }
    setMeta(db, 'last_rebuild', new Date().toISOString());
    return { sessions: totalSessions, events: totalEvents };
  }

  function insertWindow(row) {
    return stmts.insertWindow.run(
      row.session_id, row.file, row.idx,
      row.ts_start, row.ts_end,
      row.content_hash_start ?? null,
      row.content_hash_end ?? null,
    ).lastInsertRowid;
  }

  function insertOutcome(row) {
    stmts.insertOutcome.run(
      row.fp, row.window_id, row.outcome,
      row.fix_applied ?? null,
      row.collateral_added ?? 0,
    );
  }

  function query(sql, params = []) {
    return db.prepare(sql).all(...params);
  }

  function queryOne(sql, params = []) {
    return db.prepare(sql).get(...params);
  }

  function getMeta(key) {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  function stats() {
    const events = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
    const diagnostics = db.prepare('SELECT COUNT(*) as count FROM diagnostics').get().count;
    const windows = db.prepare('SELECT COUNT(*) as count FROM windows').get().count;
    const outcomes = db.prepare('SELECT COUNT(*) as count FROM outcomes').get().count;
    const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM events').get().count;
    return { events, diagnostics, windows, outcomes, sessions, schema_version: SCHEMA_VERSION };
  }

  function recordPromotion({ rule_id, check_name, template_fp }) {
    stmts.insertPromotion.run(
      rule_id, check_name, template_fp,
      new Date().toISOString(), 1, null, null,
    );
  }

  function resolvePromotion(rule_id, resolution) {
    db.prepare(
      `UPDATE rule_promotions SET probation = 0, resolved_at = ?, resolution = ? WHERE rule_id = ?`,
    ).run(new Date().toISOString(), resolution, rule_id);
  }

  function getPromotion(rule_id) {
    return db.prepare('SELECT * FROM rule_promotions WHERE rule_id = ?').get(rule_id) ?? null;
  }

  function getPromotionsOnProbation() {
    return db.prepare('SELECT * FROM rule_promotions WHERE probation = 1').all();
  }

  function insertHealthScore({ score, mode, dimensions }) {
    stmts.insertHealthScore.run(
      new Date().toISOString(), score, mode,
      JSON.stringify(dimensions),
    );
  }

  function getHealthScores({ limit = 30, mode } = {}) {
    const sql = mode
      ? 'SELECT * FROM health_scores WHERE mode = ? ORDER BY ts DESC LIMIT ?'
      : 'SELECT * FROM health_scores ORDER BY ts DESC LIMIT ?';
    const params = mode ? [mode, limit] : [limit];
    const rows = db.prepare(sql).all(...params);
    return rows.reverse().map(r => ({
      ...r,
      dimensions: JSON.parse(r.dimensions),
    }));
  }

  return {
    close,
    ingestEvent,
    ingestSession,
    rebuild,
    insertWindow,
    insertOutcome,
    query,
    queryOne,
    getMeta,
    stats,
    recordPromotion,
    resolvePromotion,
    getPromotion,
    getPromotionsOnProbation,
    insertHealthScore,
    getHealthScores,
    get db() { return db; },
    get path() { return dbPath; },
  };
}

function prepareStatements(db) {
  return {
    insertEvent: db.prepare(
      'INSERT INTO events (session_id, kind, ts, payload) VALUES (?, ?, ?, ?)',
    ),
    insertDiag: db.prepare(
      `INSERT INTO diagnostics (fp, template_fp, session_id, file, check_name, severity, ts, hint_rule_id, content_hash, suppressed, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertFix: db.prepare(
      `INSERT INTO proposed_fixes (fp, session_id, ts, range_json, new_text_hash, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    insertWindow: db.prepare(
      `INSERT INTO windows (session_id, file, idx, ts_start, ts_end, content_hash_start, content_hash_end)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertOutcome: db.prepare(
      `INSERT INTO outcomes (fp, window_id, outcome, fix_applied, collateral_added)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    insertPromotion: db.prepare(
      `INSERT OR REPLACE INTO rule_promotions (rule_id, check_name, template_fp, promoted_at, probation, resolved_at, resolution)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertHealthScore: db.prepare(
      `INSERT INTO health_scores (ts, score, mode, dimensions)
       VALUES (?, ?, ?, ?)`,
    ),
  };
}

function ingestValidatorEmit(event, stmts) {
  stmts.insertDiag.run(
    event.fp,
    event.template_fp ?? null,
    event.session_id,
    event.file,
    event.hint_rule_id ?? 'unknown',
    null,
    event.ts,
    event.hint_rule_id ?? null,
    event.content_hash ?? null,
    0,
    event.confidence ?? null,
  );

  if (event.proposed_fixes?.length) {
    for (const fix of event.proposed_fixes) {
      stmts.insertFix.run(
        event.fp,
        event.session_id,
        event.ts,
        fix.range ? JSON.stringify(fix.range) : null,
        fix.new_text_hash ?? null,
        fix.kind ?? null,
      );
    }
  }
}

function setMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}
