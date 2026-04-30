/**
 * CAC predictor — opt-in 4th gating axis for the diagnostic emit cascade.
 *
 * Given a diagnostic produced by the existing pipeline (severity → static
 * confidence → adaptive-mode kill-switch → force-disable), this module
 * predicts the probability that an agent will adopt the proposed fix and
 * decides whether to:
 *   - allow the emit (prediction non-blocking),
 *   - downgrade its severity (de-emphasize without removing it), or
 *   - suppress it (drop entirely).
 *
 * The "neural" backend is a hierarchical empirical-Bayes scorer over the
 * analytics store. It is INTENTIONALLY simple for the prototype:
 *
 *   1. Look up historical (rule_id, file_domain) outcomes — most specific.
 *   2. Fall back to (rule_id) if (1) has fewer than `min_samples` outcomes.
 *   3. Fall back to (severity) if (2) is also under-sampled.
 *   4. If all three are under-sampled → allow (prediction has no signal).
 *
 * At each level we compute Beta(α, β) posteriors over `adopted / total`
 * with a uniform prior (α = β = 2). The decision uses the posterior mean.
 * The 95% credible interval is exposed for downstream telemetry / UI.
 *
 * The scorer is decoupled from the integration via a `historyProvider`
 * dependency: the real provider queries the analytics store; tests inject a
 * deterministic stub. This makes the gate logic unit-testable without a
 * SQLite fixture.
 *
 * Safety contract — load-bearing:
 *   - Predictor only ever SUPPRESSES or DOWNGRADES; it never adds, mutates
 *     fix proposals, or alters params. If the gate is disabled, validate_code
 *     behavior is bit-identical to a build without this module.
 *   - When the gate raises (history provider crash, store unavailable), the
 *     diagnostic is allowed through unchanged. Failures degrade open.
 *   - In `shadow` mode, decisions are recorded for analysis but no
 *     diagnostic is mutated. Used to A/B-validate a threshold before
 *     flipping to `active`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { betaPosterior } from './analytics-queries.js';
import { getDomainFromPath } from './domain-detector.js';
import { readEvent } from './session-events.js';

const MAX_RECENT_DECISIONS = 200;
const PRIOR_A = 2;
const PRIOR_B = 2;

const recentDecisions = [];

/**
 * The empirical-Bayes scorer. Pure function.
 *
 * @param {object} input
 * @param {string} input.rule_id - Diagnostic rule_id (post-stamping).
 * @param {string} input.severity - 'error' | 'warning' | 'info'.
 * @param {string|null} input.file_domain - Output of getDomainFromPath, or null.
 * @param {number} input.min_samples - Threshold below which a feature level is rejected.
 * @param {(ruleId: string, fileDomain: string|null) => {adopted:number,total:number}} input.historyProvider
 * @returns {{
 *   p_adopted: number,
 *   p_lower: number,
 *   p_upper: number,
 *   n_samples: number,
 *   adopted: number,
 *   feature: 'rule_id+domain'|'rule_id'|'severity'|'prior',
 *   model: 'empirical_bayes_v1'
 * }}
 */
export function scoreFixHelpfulness({
  rule_id,
  severity,
  file_domain,
  min_samples,
  historyProvider,
  severityProvider,
}) {
  const tries = [];

  if (rule_id && file_domain) {
    const h = safeProvide(historyProvider, rule_id, file_domain);
    tries.push({ feature: 'rule_id+domain', ...h });
  }
  if (rule_id) {
    const h = safeProvide(historyProvider, rule_id, null);
    tries.push({ feature: 'rule_id', ...h });
  }
  if (severity && severityProvider) {
    const h = safeProvide(severityProvider, severity);
    tries.push({ feature: 'severity', ...h });
  }

  // Pick the most specific feature with enough samples; the order in `tries`
  // reflects the hierarchy.
  const chosen = tries.find(t => t.total >= min_samples);
  if (!chosen) {
    // No level passed min_samples — no signal. Fall back to the prior, which
    // for Beta(2, 2) is mean = 0.5. The decision layer treats `prior` as a
    // pass-through (allow).
    return {
      p_adopted: 0.5,
      p_lower: 0.0,
      p_upper: 1.0,
      n_samples: 0,
      adopted: 0,
      feature: 'prior',
      model: 'empirical_bayes_v1',
    };
  }

  const { mean, lower95, upper95 } = betaPosterior(chosen.adopted, chosen.total, PRIOR_A, PRIOR_B);
  return {
    p_adopted: mean,
    p_lower: lower95,
    p_upper: upper95,
    n_samples: chosen.total,
    adopted: chosen.adopted,
    feature: chosen.feature,
    model: 'empirical_bayes_v1',
  };
}

function safeProvide(provider, ...args) {
  try {
    const out = provider(...args);
    return {
      adopted: Number.isFinite(out?.adopted) ? out.adopted : 0,
      total: Number.isFinite(out?.total) ? out.total : 0,
    };
  } catch {
    return { adopted: 0, total: 0 };
  }
}

/**
 * Decide what to do with a diagnostic given a prediction and config.
 * Pure function, separate from the prediction step so it can be unit-tested
 * independently and tweaked without touching the scorer.
 *
 * Returns `{ decision, reason }` where decision is one of:
 *   - 'allow':     emit unchanged
 *   - 'downgrade': emit but reduce severity (error→warning, warning→info)
 *   - 'suppress':  drop emit entirely
 */
export function decideAction(prediction, config) {
  // No signal → always allow. The predictor refuses to gate when it's flying
  // blind — early in adoption, before enough outcomes accumulate, this is
  // the safe default.
  if (prediction.feature === 'prior') {
    return { decision: 'allow', reason: 'no_signal' };
  }
  if (prediction.p_adopted >= config.threshold) {
    return { decision: 'allow', reason: 'above_threshold' };
  }
  // Below threshold — apply the configured action.
  return {
    decision: config.action === 'suppress' ? 'suppress' : 'downgrade',
    reason: 'below_threshold',
  };
}

/**
 * Real history provider over the analytics store. Returns
 * `{ adopted, total }` for a rule_id, optionally segmented by file_domain.
 *
 * `adopted` = count of outcomes where fix_applied = 'verbatim'.
 * `total`   = count of outcomes for this rule_id (any fix_applied value).
 *
 * The file_domain filter uses LIKE patterns on `diagnostics.file` matching
 * the same path heuristics as `domain-detector.js`. Only segments we can
 * express cheaply in SQL are supported; unknown domains return `(0, 0)`.
 */
export function buildHistoryProvider(analyticsStore) {
  if (!analyticsStore) {
    return () => ({ adopted: 0, total: 0 });
  }
  return function historyProvider(ruleId, fileDomain) {
    if (!ruleId) return { adopted: 0, total: 0 };
    const pattern = fileDomain ? domainLikePattern(fileDomain) : null;
    if (fileDomain && !pattern) return { adopted: 0, total: 0 };
    try {
      const sql = pattern
        ? `SELECT o.fix_applied, COUNT(*) as cnt
             FROM outcomes o
             WHERE EXISTS (
               SELECT 1 FROM diagnostics d
               WHERE d.fp = o.fp
                 AND d.hint_rule_id = ?
                 AND d.suppressed = 0
                 AND d.file LIKE ?
             )
             GROUP BY o.fix_applied`
        : `SELECT o.fix_applied, COUNT(*) as cnt
             FROM outcomes o
             WHERE EXISTS (
               SELECT 1 FROM diagnostics d
               WHERE d.fp = o.fp
                 AND d.hint_rule_id = ?
                 AND d.suppressed = 0
             )
             GROUP BY o.fix_applied`;
      const rows = pattern
        ? analyticsStore.query(sql, [ruleId, pattern])
        : analyticsStore.query(sql, [ruleId]);
      let total = 0;
      let adopted = 0;
      for (const row of rows) {
        total += row.cnt;
        if (row.fix_applied === 'verbatim') adopted += row.cnt;
      }
      return { adopted, total };
    } catch {
      return { adopted: 0, total: 0 };
    }
  };
}

/**
 * Severity-level fallback provider. Less segmentation, more samples.
 * Used when both rule_id+domain and rule_id alone are under-sampled.
 */
export function buildSeverityProvider(analyticsStore) {
  if (!analyticsStore) {
    return () => ({ adopted: 0, total: 0 });
  }
  return function severityProvider(severity) {
    try {
      const rows = analyticsStore.query(
        `SELECT o.fix_applied, COUNT(*) as cnt
           FROM outcomes o
           WHERE EXISTS (
             SELECT 1 FROM diagnostics d
             WHERE d.fp = o.fp
               AND d.severity = ?
               AND d.suppressed = 0
           )
           GROUP BY o.fix_applied`,
        [severity],
      );
      let total = 0;
      let adopted = 0;
      for (const row of rows) {
        total += row.cnt;
        if (row.fix_applied === 'verbatim') adopted += row.cnt;
      }
      return { adopted, total };
    } catch {
      return { adopted: 0, total: 0 };
    }
  };
}

function domainLikePattern(domain) {
  switch (domain) {
    case 'commands':     return '%/lib/commands/%';
    case 'queries':      return '%/lib/queries/%';
    case 'pages':        return '%/views/pages/%';
    case 'layouts':      return '%/views/layouts/%';
    case 'partials':     return '%/views/partials/%';
    case 'graphql':      return '%/graphql/%';
    case 'schema':       return '%/schema/%';
    case 'translations': return '%/translations/%';
    default:             return null;
  }
}

const SEVERITY_RANK = ['info', 'warning', 'error'];

function downgradeSeverity(s) {
  const i = SEVERITY_RANK.indexOf(s);
  if (i <= 0) return 'info';
  return SEVERITY_RANK[i - 1];
}

/**
 * Apply the gate to a validate_code result. Mutates `result.errors`,
 * `result.warnings`, `result.infos` in place when the gate is in `active`
 * mode. In `shadow` mode the result is left untouched and decisions are
 * appended to the session bus + recent-decisions ring buffer for later
 * inspection.
 *
 * NEVER throws. If the predictor or store fails, the result passes through.
 *
 * @returns {Array} list of decisions emitted in this call (one per diagnostic
 *                  considered). Order matches input order; useful for tests.
 */
export function applyCac(result, {
  config,
  analyticsStore,
  filePath,
  sessionBus,
  log,
  historyProvider,
  severityProvider,
} = {}) {
  if (!config?.enabled) return [];
  if (!result) return [];

  const provider = historyProvider ?? buildHistoryProvider(analyticsStore);
  const sevProvider = severityProvider ?? buildSeverityProvider(analyticsStore);
  const fileDomain = filePath ? getDomainFromPath(filePath) : null;
  const decisions = [];

  const buckets = [
    { name: 'errors',   arr: result.errors ?? [] },
    { name: 'warnings', arr: result.warnings ?? [] },
    { name: 'infos',    arr: result.infos ?? [] },
  ];

  for (const bucket of buckets) {
    const kept = [];
    for (const d of bucket.arr) {
      let decision;
      try {
        const rule_id = d.rule_id || (d.check ? `${d.check}.unmatched` : null);
        const severity = d.severity || bucketToSeverity(bucket.name);
        const prediction = scoreFixHelpfulness({
          rule_id,
          severity,
          file_domain: fileDomain,
          min_samples: config.min_samples,
          historyProvider: provider,
          severityProvider: sevProvider,
        });
        decision = decideAction(prediction, config);
        recordDecision({
          file: filePath,
          rule_id,
          check: d.check,
          severity,
          file_domain: fileDomain,
          prediction,
          decision,
          mode: config.mode,
        }, sessionBus);
        decisions.push({ rule_id, check: d.check, prediction, decision });
      } catch (e) {
        log?.(`cac-predictor: scoring failed (${e?.message ?? e}); allowing diagnostic`);
        kept.push(d);
        continue;
      }

      // Shadow mode: never modifies the result.
      if (config.mode !== 'active') {
        kept.push(d);
        continue;
      }

      if (decision.decision === 'suppress') {
        // drop — do not push
        continue;
      }
      if (decision.decision === 'downgrade') {
        const next = downgradeSeverity(d.severity || bucketToSeverity(bucket.name));
        if (next !== d.severity) {
          d.severity = next;
          d.cac_downgraded = true;
        }
        kept.push(d);
        continue;
      }
      kept.push(d);
    }
    bucket.arr.length = 0;
    bucket.arr.push(...kept);
  }

  // Active-mode downgrades may have flipped severities; rebalance the
  // buckets so an error→warning downgrade actually moves into result.warnings
  // and not just gets stamped with severity:'warning' in result.errors.
  if (config.mode === 'active') {
    rebalanceBuckets(result);
  }

  return decisions;
}

function bucketToSeverity(name) {
  if (name === 'errors')   return 'error';
  if (name === 'warnings') return 'warning';
  return 'info';
}

function rebalanceBuckets(result) {
  const all = [
    ...((result.errors ?? []).map(d => ({ d, defaultBucket: 'errors' }))),
    ...((result.warnings ?? []).map(d => ({ d, defaultBucket: 'warnings' }))),
    ...((result.infos ?? []).map(d => ({ d, defaultBucket: 'infos' }))),
  ];
  result.errors = [];
  result.warnings = [];
  result.infos = [];
  for (const { d, defaultBucket } of all) {
    const sev = d.severity || bucketToSeverity(defaultBucket);
    if (sev === 'error')        result.errors.push(d);
    else if (sev === 'warning') result.warnings.push(d);
    else                        result.infos.push(d);
  }
}

function recordDecision(entry, sessionBus) {
  // The session-bus envelope owns `ts` (it's a reserved envelope key — see
  // `session-events.js::ENVELOPE_KEYS`). Compute it once, pass it as the
  // emit's third arg, and keep a copy on the ring entry so consumers of
  // `getRecentCacDecisions()` see a single self-contained record without
  // re-querying the bus.
  const ts = new Date().toISOString();
  const payload = {
    file: entry.file ?? null,
    rule_id: entry.rule_id ?? null,
    check: entry.check ?? null,
    severity: entry.severity,
    file_domain: entry.file_domain ?? null,
    p_adopted: entry.prediction?.p_adopted ?? null,
    p_lower: entry.prediction?.p_lower ?? null,
    p_upper: entry.prediction?.p_upper ?? null,
    n_samples: entry.prediction?.n_samples ?? 0,
    feature: entry.prediction?.feature ?? 'prior',
    decision: entry.decision?.decision ?? 'allow',
    reason: entry.decision?.reason ?? '',
    mode: entry.mode,
  };
  pushRingEntry({ ts, ...payload });
  if (sessionBus?.emit) {
    try {
      sessionBus.emit('cac_decision', payload, ts);
    } catch {
      // Persistence is best-effort. The in-memory ring already received the
      // entry, so the dashboard still shows it within this session.
    }
  }
}

function pushRingEntry(entry) {
  recentDecisions.push(entry);
  if (recentDecisions.length > MAX_RECENT_DECISIONS) {
    recentDecisions.splice(0, recentDecisions.length - MAX_RECENT_DECISIONS);
  }
}

export function getRecentCacDecisions(limit = MAX_RECENT_DECISIONS) {
  const start = Math.max(0, recentDecisions.length - limit);
  return recentDecisions.slice(start);
}

export function clearRecentCacDecisions() {
  recentDecisions.length = 0;
}

/**
 * Reconstruct an in-memory ring entry from a persisted `cac_decision`
 * envelope. The persisted shape places the timestamp on the envelope
 * (`event.ts`) and every other field as a top-level payload key (validated
 * by the registry). The ring entry collapses both back into a single flat
 * object so consumers of `getRecentCacDecisions()` see a uniform record
 * regardless of whether it came from the live emit path or from disk.
 */
function eventToRingEntry(event) {
  return {
    ts: event.ts,
    file: event.file ?? null,
    rule_id: event.rule_id ?? null,
    check: event.check ?? null,
    severity: event.severity,
    file_domain: event.file_domain ?? null,
    p_adopted: event.p_adopted,
    p_lower: event.p_lower,
    p_upper: event.p_upper,
    n_samples: event.n_samples,
    feature: event.feature,
    decision: event.decision,
    reason: event.reason,
    mode: event.mode,
  };
}

/**
 * Scan one NDJSON file for `cac_decision` events and return ring-shape
 * entries. Tolerates malformed lines (skipped silently — we don't want a
 * single corrupt event to nuke the rehydration of an otherwise valid log).
 *
 * Performance shortcut: most lines won't be `cac_decision`, so peek at the
 * `kind` field via cheap JSON.parse before paying the full Zod validation
 * cost in `readEvent`.
 */
function extractCacDecisionsFromFile(filePath) {
  if (!existsSync(filePath)) return [];
  let content;
  try { content = readFileSync(filePath, 'utf-8'); }
  catch { return []; }
  const out = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let raw;
    try { raw = JSON.parse(line); }
    catch { continue; }
    if (!raw || raw.kind !== 'cac_decision') continue;
    try {
      const event = readEvent(line);
      out.push(eventToRingEntry(event));
    } catch {
      // Malformed payload (e.g. older shape from a pre-schema version of
      // this code). Skip — the dashboard would rather see fewer entries
      // than crash the predictor on a corrupt line.
    }
  }
  return out;
}

/**
 * Read recent session NDJSON logs and return the last `limit`
 * `cac_decision` entries in chronological order (oldest → newest).
 *
 * Scans `<sessionsDir>/<session-*>/events.ndjson`, sorted by directory
 * name DESC (session ids are ISO timestamps so lexical order = chronological).
 * Stops as soon as we have ≥ `2 × limit` candidates collected — overscan
 * guards against the same event appearing twice across boundary cases
 * (e.g. an in-flight session being scanned both by us and the live writer)
 * while still bounding the I/O at the most recent few sessions.
 *
 * Returns [] for any non-fatal failure (missing dir, unreadable, etc.).
 * Never throws — server startup must not be blocked by a broken sessions
 * directory.
 *
 * @param {string} sessionsDir
 * @param {number} [limit=MAX_RECENT_DECISIONS]
 * @returns {Array<object>}
 */
export function loadRecentCacDecisions(sessionsDir, limit = MAX_RECENT_DECISIONS) {
  if (!sessionsDir || limit <= 0) return [];
  let entries;
  try { entries = readdirSync(sessionsDir, { withFileTypes: true }); }
  catch { return []; }

  const sessionDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse(); // newest session first (lexical = chronological)

  const collected = [];
  const overscanCap = limit * 2;
  for (const name of sessionDirs) {
    if (collected.length >= overscanCap) break;
    const filePath = join(sessionsDir, name, 'events.ndjson');
    const fromFile = extractCacDecisionsFromFile(filePath);
    for (const e of fromFile) collected.push(e);
  }

  // Final ordering and trim. The bus envelope stamps `ts` as an ISO string;
  // lexical compare matches chronological order. Stable: same-ts entries
  // keep their original (file scan) order.
  collected.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return collected.slice(Math.max(0, collected.length - limit));
}

/**
 * Replace the in-memory ring with the most recent `cac_decision` entries
 * persisted on disk. Returns the number of entries loaded so callers can
 * log a one-line "rehydrated N from disk" startup message.
 *
 * Idempotent — calling twice produces the same end state. Safe to call
 * before any live emits (server boot) but not while emits are in flight,
 * since this overwrites the ring rather than merging.
 */
export function rehydrateRecentCacDecisions(sessionsDir, limit = MAX_RECENT_DECISIONS) {
  const loaded = loadRecentCacDecisions(sessionsDir, limit);
  recentDecisions.length = 0;
  for (const e of loaded) recentDecisions.push(e);
  return loaded.length;
}
