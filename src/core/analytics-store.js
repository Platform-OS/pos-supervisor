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
import { classifySession, computeCollateral, buildEmitIndex, classifyFixAdoption } from './window-classifier.js';

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

const SCHEMA_VERSION = 6;

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
    hint_md_hash TEXT,
    content_hash TEXT,
    suppressed   INTEGER DEFAULT 0,
    confidence   REAL
  );
  CREATE INDEX IF NOT EXISTS idx_diag_fp       ON diagnostics(fp);
  CREATE INDEX IF NOT EXISTS idx_diag_session  ON diagnostics(session_id);
  CREATE INDEX IF NOT EXISTS idx_diag_check    ON diagnostics(check_name);
  CREATE INDEX IF NOT EXISTS idx_diag_file     ON diagnostics(file);
  -- One diagnostic row per (session, file, fp). Re-validations of the same
  -- file in the same session are ignored — first emit is the canonical one.
  -- See migrate_v2_to_v3 for the upgrade path on existing DBs.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_diag_sff ON diagnostics(session_id, file, fp);

  CREATE TABLE IF NOT EXISTS proposed_fixes (
    fp            TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    ts            TEXT NOT NULL,
    range_json    TEXT,
    new_text_hash TEXT,
    kind          TEXT,
    rule_id       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fixes_fp ON proposed_fixes(fp);
  CREATE INDEX IF NOT EXISTS idx_fixes_rule ON proposed_fixes(rule_id);

  CREATE TABLE IF NOT EXISTS windows (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id         TEXT NOT NULL,
    file               TEXT NOT NULL,
    idx                INTEGER NOT NULL,
    ts_start           TEXT NOT NULL,
    ts_end             TEXT NOT NULL,
    content_hash_start TEXT,
    content_hash_end   TEXT,
    is_draft           INTEGER DEFAULT 0,
    closed_by          TEXT DEFAULT 'validate'
  );
  CREATE INDEX IF NOT EXISTS idx_windows_session ON windows(session_id);
  CREATE INDEX IF NOT EXISTS idx_windows_file    ON windows(session_id, file);

  CREATE TABLE IF NOT EXISTS outcomes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fp              TEXT NOT NULL,
    window_id       INTEGER NOT NULL REFERENCES windows(id),
    outcome         TEXT NOT NULL,
    fix_applied     TEXT,
    collateral_added INTEGER DEFAULT 0,
    session_id      TEXT,
    file            TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_outcomes_fp     ON outcomes(fp);
  CREATE INDEX IF NOT EXISTS idx_outcomes_window ON outcomes(window_id);
  -- One outcome per (session, file, fp). Terminal state wins via INSERT OR REPLACE.
  -- See migrate_v1_to_v2 for the upgrade path on existing DBs.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_sff ON outcomes(session_id, file, fp);

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

export function openAnalyticsStore(dbPath, { readonly = false, blobStore = null } = {}) {
  if (!dbPath) throw new Error('openAnalyticsStore: dbPath required');
  mkdirSync(dirname(dbPath), { recursive: true });

  const Database = getDatabase();
  const dbOpts = readonly ? { readonly: true } : { create: true, readwrite: true };
  const db = new Database(dbPath, dbOpts);
  if (!readonly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    // Migrations run BEFORE SCHEMA_SQL so existing tables can be reshaped
    // without tripping IF-NOT-EXISTS guards (e.g. adding a UNIQUE INDEX
    // over already-duplicated rows would fail if SCHEMA_SQL ran first).
    migrate(db);
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
    // Per-fp index of validator_emit events → we pull proposed_fixes off the
    // latest emit in the window's time range below. Built once per session.
    const emitIndex = buildEmitIndex(events);

    for (const { window: w, outcomes } of windowResults) {
      const collateral = computeCollateral(outcomes);
      const windowId = insertWindow(w);

      // Resolve window content blobs once per window. classifyFixAdoption is
      // a hot-ish path inside rebuilds — avoid re-reading per outcome.
      const startContent = blobStore && w.content_hash_start
        ? blobStore.getText(w.content_hash_start) : null;
      const endContent = blobStore && w.content_hash_end
        ? blobStore.getText(w.content_hash_end) : null;

      for (const o of outcomes) {
        insertOutcome({
          fp: o.fp,
          window_id: windowId,
          outcome: o.outcome,
          fix_applied: classifyOutcomeFixAdoption(
            o, w, emitIndex, startContent, endContent,
          ),
          collateral_added: o.outcome === 'regressed' ? collateral : 0,
          session_id: w.session_id,
          file: w.file,
        });
      }
    }
  }

  /**
   * Map a window outcome to a fix_applied label ('verbatim' | 'partial' |
   * 'ignored' | null). Skipped for:
   *   - regressed  — the fp is *new* at window end, so there's no "fix that
   *     was proposed before and then applied"; classification is meaningless.
   *   - write_unverified — no end state to compare against.
   *   - missing content blobs — can't reconstruct start/end text.
   *   - no proposed fix in the window — no adoption to classify.
   */
  function classifyOutcomeFixAdoption(outcome, w, emitIndex, startContent, endContent) {
    if (!blobStore) return null;
    if (outcome.outcome === 'regressed') return null;
    if (outcome.outcome === 'write_unverified') return null;
    if (!startContent || !endContent) return null;

    // Pick the emit that the agent actually saw at window start — that's the
    // proposal-set the agent could have adopted. Falling back to "latest at or
    // before ts_end" is wrong: it can capture a newer proposal the agent never
    // saw (e.g. a rule whose `apply()` output changed between re-validations).
    const emits = emitIndex.get(outcome.fp) ?? [];
    let chosen = null;
    for (const e of emits) {
      if (e.session_id !== w.session_id) continue;
      if (e.file !== w.file) continue;
      if (e.ts > w.ts_start) continue;
      if (!chosen || e.ts > chosen.ts) chosen = e;
    }
    // If no emit at or before ts_start exists, fall back to the earliest in
    // the window — this covers ingestion paths where the emit and the
    // tool_call share a timestamp and strict `<=` excludes the right row.
    if (!chosen) {
      for (const e of emits) {
        if (e.session_id !== w.session_id) continue;
        if (e.file !== w.file) continue;
        if (e.ts > w.ts_end) continue;
        if (!chosen || e.ts < chosen.ts) chosen = e;
      }
    }
    const fixes = chosen?.proposed_fixes ?? [];
    if (fixes.length === 0) return null;

    return classifyFixAdoption(startContent, endContent, fixes, blobStore);
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
      row.is_draft ? 1 : 0,
      row.closed_by ?? 'validate',
    ).lastInsertRowid;
  }

  function insertOutcome(row) {
    let session_id = row.session_id ?? null;
    let file = row.file ?? null;
    if ((!session_id || !file) && row.window_id != null) {
      const w = stmts.selectWindowById.get(row.window_id);
      if (w) {
        session_id = session_id || w.session_id;
        file = file || w.file;
      }
    }
    stmts.insertOutcome.run(
      row.fp, row.window_id, row.outcome,
      row.fix_applied ?? null,
      row.collateral_added ?? 0,
      session_id,
      file,
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
      `INSERT OR IGNORE INTO diagnostics (fp, template_fp, session_id, file, check_name, severity, ts, hint_rule_id, hint_md_hash, content_hash, suppressed, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertFix: db.prepare(
      `INSERT INTO proposed_fixes (fp, session_id, ts, range_json, new_text_hash, kind, rule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertWindow: db.prepare(
      `INSERT INTO windows (session_id, file, idx, ts_start, ts_end, content_hash_start, content_hash_end, is_draft, closed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    // INSERT OR REPLACE + UNIQUE(session_id, file, fp) is the dedup mechanism:
    // as classifySession walks windows chronologically, each replace stamps
    // the terminal (session, file, fp) classification.
    insertOutcome: db.prepare(
      `INSERT OR REPLACE INTO outcomes
         (fp, window_id, outcome, fix_applied, collateral_added, session_id, file)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectWindowById: db.prepare(
      `SELECT session_id, file FROM windows WHERE id = ?`,
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
    event.check ?? event.hint_rule_id ?? 'unknown',
    null,
    event.ts,
    event.hint_rule_id ?? null,
    event.hint_md_hash ?? null,
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
        fix.rule_id ?? null,
      );
    }
  }
}

function setMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Schema migrations. Called before SCHEMA_SQL so existing tables can be
 * reshaped (e.g. adding columns, dedup, adding UNIQUE INDEX) without the
 * CREATE … IF NOT EXISTS guards masking stale shape.
 *
 * New DBs skip migrations — meta.schema_version is absent (treated as 0) but
 * the tables SCHEMA_SQL creates already match SCHEMA_VERSION. A fresh DB
 * hits migrate_v1_to_v2 as a no-op because the outcomes table doesn't
 * exist yet. Safe.
 */
function migrate(db) {
  // Meta table must exist before we can read schema_version.
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
  const current = row ? Number(row.value) : 0;

  if (current < 2) migrate_v1_to_v2(db);
  if (current < 3) migrate_v2_to_v3(db);
  if (current < 4) migrate_v3_to_v4(db);
  if (current < 5) migrate_v4_to_v5(db);
  if (current < 6) migrate_v5_to_v6(db);
}

function migrate_v1_to_v2(db) {
  // No-op for fresh DBs: the outcomes table doesn't exist yet.
  const outcomesExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outcomes'`,
  ).get();
  if (!outcomesExists) return;

  const cols = db.prepare(`PRAGMA table_info(outcomes)`).all().map(r => r.name);
  if (!cols.includes('session_id')) {
    db.exec(`ALTER TABLE outcomes ADD COLUMN session_id TEXT`);
  }
  if (!cols.includes('file')) {
    db.exec(`ALTER TABLE outcomes ADD COLUMN file TEXT`);
  }

  // Backfill from windows via window_id. Correlated subquery works across all
  // SQLite versions (UPDATE FROM requires 3.33+).
  db.exec(`
    UPDATE outcomes
    SET
      session_id = COALESCE(session_id, (SELECT w.session_id FROM windows w WHERE w.id = outcomes.window_id)),
      file       = COALESCE(file,       (SELECT w.file       FROM windows w WHERE w.id = outcomes.window_id))
    WHERE session_id IS NULL OR file IS NULL
  `);

  // Dedup: keep the highest-id row per (session_id, file, fp). classifySession
  // walks windows chronologically, so the highest id is the terminal state.
  // Rows with NULL session_id or file are orphans (missing window); drop them.
  db.exec(`
    DELETE FROM outcomes
    WHERE session_id IS NULL OR file IS NULL
  `);
  db.exec(`
    DELETE FROM outcomes
    WHERE id NOT IN (
      SELECT MAX(id) FROM outcomes
      GROUP BY session_id, file, fp
    )
  `);

  // UNIQUE INDEX goes up after dedup; SCHEMA_SQL's IF-NOT-EXISTS guard then
  // becomes a no-op on the next open.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_sff
    ON outcomes(session_id, file, fp)
  `);
}

function migrate_v2_to_v3(db) {
  // No-op for fresh DBs: the diagnostics table doesn't exist yet.
  const diagExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'diagnostics'`,
  ).get();
  if (!diagExists) return;

  // Dedup: keep the earliest row per (session_id, file, fp). The first emit
  // is canonical; later re-validations of the same file in the same session
  // carry the same diagnostic and add no new information.
  db.exec(`
    DELETE FROM diagnostics
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM diagnostics
      GROUP BY session_id, file, fp
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_diag_sff
    ON diagnostics(session_id, file, fp)
  `);
}

function migrate_v3_to_v4(db) {
  // No-op for fresh DBs: windows table doesn't exist yet (created by SCHEMA_SQL).
  const windowsExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'windows'`,
  ).get();
  if (!windowsExists) return;

  const cols = db.prepare('PRAGMA table_info(windows)').all().map(c => c.name);
  if (!cols.includes('is_draft')) {
    db.exec('ALTER TABLE windows ADD COLUMN is_draft INTEGER DEFAULT 0');
  }
  if (!cols.includes('closed_by')) {
    db.exec("ALTER TABLE windows ADD COLUMN closed_by TEXT DEFAULT 'validate'");
  }
}

function migrate_v4_to_v5(db) {
  // No-op for fresh DBs: diagnostics table doesn't exist yet.
  const diagExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'diagnostics'`,
  ).get();
  if (!diagExists) return;

  const cols = db.prepare('PRAGMA table_info(diagnostics)').all().map(c => c.name);
  if (!cols.includes('hint_md_hash')) {
    db.exec('ALTER TABLE diagnostics ADD COLUMN hint_md_hash TEXT');
  }
  // No backfill: the event log still carries `hint_md_hash` in each
  // validator_emit payload — a subsequent store.rebuild(sessionsDir) replays
  // it correctly into the new column. Migration alone just unblocks future
  // writes; operators that want historical hints must run a rebuild.
}

function migrate_v5_to_v6(db) {
  // No-op for fresh DBs: proposed_fixes table doesn't exist yet.
  const tblExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proposed_fixes'`,
  ).get();
  if (!tblExists) return;

  const cols = db.prepare('PRAGMA table_info(proposed_fixes)').all().map(c => c.name);
  if (!cols.includes('rule_id')) {
    db.exec('ALTER TABLE proposed_fixes ADD COLUMN rule_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_fixes_rule ON proposed_fixes(rule_id)');
  // Existing rows stay at NULL rule_id (pre-I1 events don't carry attribution).
  // A store.rebuild(sessionsDir) backfills from newer events; older events are
  // genuinely un-attributed and will remain that way.
}
