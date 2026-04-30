import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scoreFixHelpfulness,
  decideAction,
  applyCac,
  getRecentCacDecisions,
  clearRecentCacDecisions,
  loadRecentCacDecisions,
  rehydrateRecentCacDecisions,
} from '../../src/core/cac-predictor.js';
import { defaultCacConfig } from '../../src/core/cac-config.js';
import { makeEvent } from '../../src/core/session-events.js';

beforeEach(() => {
  clearRecentCacDecisions();
});

// ── scoreFixHelpfulness ────────────────────────────────────────────────────

describe('scoreFixHelpfulness: hierarchy', () => {
  test('uses (rule_id, file_domain) when its sample count meets min_samples', () => {
    const historyProvider = (ruleId, domain) => {
      if (ruleId === 'A.x' && domain === 'pages') return { adopted: 8, total: 10 };
      if (ruleId === 'A.x' && domain === null)    return { adopted: 5, total: 50 };
      return { adopted: 0, total: 0 };
    };
    const r = scoreFixHelpfulness({
      rule_id: 'A.x',
      severity: 'error',
      file_domain: 'pages',
      min_samples: 5,
      historyProvider,
      severityProvider: () => ({ adopted: 0, total: 0 }),
    });
    expect(r.feature).toBe('rule_id+domain');
    expect(r.n_samples).toBe(10);
    expect(r.p_adopted).toBeGreaterThan(0.5);
  });

  test('falls back to (rule_id) when (rule_id+domain) is under-sampled', () => {
    const historyProvider = (ruleId, domain) => {
      if (ruleId === 'A.x' && domain === 'pages') return { adopted: 1, total: 2 };
      if (ruleId === 'A.x' && domain === null)    return { adopted: 30, total: 100 };
      return { adopted: 0, total: 0 };
    };
    const r = scoreFixHelpfulness({
      rule_id: 'A.x',
      severity: 'warning',
      file_domain: 'pages',
      min_samples: 5,
      historyProvider,
      severityProvider: () => ({ adopted: 0, total: 0 }),
    });
    expect(r.feature).toBe('rule_id');
    expect(r.n_samples).toBe(100);
  });

  test('falls back to severity when both rule levels are under-sampled', () => {
    const r = scoreFixHelpfulness({
      rule_id: 'A.x',
      severity: 'error',
      file_domain: 'pages',
      min_samples: 5,
      historyProvider: () => ({ adopted: 1, total: 2 }),
      severityProvider: (sev) => sev === 'error' ? { adopted: 100, total: 500 } : { adopted: 0, total: 0 },
    });
    expect(r.feature).toBe('severity');
    expect(r.n_samples).toBe(500);
  });

  test('returns prior with feature="prior" when nothing has signal', () => {
    const r = scoreFixHelpfulness({
      rule_id: 'A.x',
      severity: 'error',
      file_domain: 'pages',
      min_samples: 5,
      historyProvider: () => ({ adopted: 0, total: 0 }),
      severityProvider: () => ({ adopted: 0, total: 0 }),
    });
    expect(r.feature).toBe('prior');
    expect(r.p_adopted).toBe(0.5);
    expect(r.n_samples).toBe(0);
  });

  test('handles missing rule_id without throwing', () => {
    const r = scoreFixHelpfulness({
      rule_id: null,
      severity: 'error',
      file_domain: 'pages',
      min_samples: 5,
      historyProvider: () => ({ adopted: 0, total: 0 }),
      severityProvider: (sev) => ({ adopted: 50, total: 100 }),
    });
    expect(r.feature).toBe('severity');
    expect(r.n_samples).toBe(100);
  });

  test('history provider that throws is treated as zero samples', () => {
    const r = scoreFixHelpfulness({
      rule_id: 'A.x',
      severity: 'error',
      file_domain: 'pages',
      min_samples: 5,
      historyProvider: () => { throw new Error('db down'); },
      severityProvider: () => ({ adopted: 0, total: 0 }),
    });
    expect(r.feature).toBe('prior');
  });
});

// ── decideAction ───────────────────────────────────────────────────────────

describe('decideAction', () => {
  const cfg = (overrides = {}) => ({ ...defaultCacConfig(), ...overrides });

  test('feature=prior always allows', () => {
    const d = decideAction(
      { p_adopted: 0.0, feature: 'prior', n_samples: 0 },
      cfg({ threshold: 0.99, action: 'suppress' }),
    );
    expect(d.decision).toBe('allow');
    expect(d.reason).toBe('no_signal');
  });

  test('p_adopted >= threshold → allow', () => {
    const d = decideAction(
      { p_adopted: 0.7, feature: 'rule_id', n_samples: 30 },
      cfg({ threshold: 0.5 }),
    );
    expect(d.decision).toBe('allow');
    expect(d.reason).toBe('above_threshold');
  });

  test('p_adopted < threshold + action=suppress → suppress', () => {
    const d = decideAction(
      { p_adopted: 0.1, feature: 'rule_id', n_samples: 30 },
      cfg({ threshold: 0.3, action: 'suppress' }),
    );
    expect(d.decision).toBe('suppress');
  });

  test('p_adopted < threshold + action=downgrade → downgrade', () => {
    const d = decideAction(
      { p_adopted: 0.1, feature: 'rule_id', n_samples: 30 },
      cfg({ threshold: 0.3, action: 'downgrade' }),
    );
    expect(d.decision).toBe('downgrade');
  });
});

// ── applyCac: integration ──────────────────────────────────────────────────

function makeResult(diags) {
  const result = { errors: [], warnings: [], infos: [] };
  for (const d of diags) {
    if (d.severity === 'error')        result.errors.push(d);
    else if (d.severity === 'warning') result.warnings.push(d);
    else                                result.infos.push(d);
  }
  return result;
}

describe('applyCac: gating', () => {
  test('disabled config → no-op (result unchanged, no decisions)', () => {
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'm' },
    ]);
    const decisions = applyCac(result, {
      config: { ...defaultCacConfig(), enabled: false },
      historyProvider: () => ({ adopted: 0, total: 100 }),
    });
    expect(result.errors).toHaveLength(1);
    expect(decisions).toHaveLength(0);
  });

  test('shadow mode: records decision but never modifies result', () => {
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'm' },
    ]);
    const decisions = applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'shadow', threshold: 0.5, action: 'suppress', min_samples: 5 },
      historyProvider: (rid, dom) => rid === 'X.bad' ? { adopted: 0, total: 100 } : { adopted: 0, total: 0 },
      severityProvider: () => ({ adopted: 0, total: 0 }),
      filePath: 'app/views/pages/index.html.liquid',
    });
    expect(result.errors).toHaveLength(1);                  // not suppressed
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision.decision).toBe('suppress'); // would-be decision
    const recorded = getRecentCacDecisions();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].mode).toBe('shadow');
  });

  test('active mode + suppress: drops below-threshold diagnostic', () => {
    const result = makeResult([
      { severity: 'error',   check: 'X', rule_id: 'X.bad',  message: 'a' },
      { severity: 'error',   check: 'Y', rule_id: 'Y.good', message: 'b' },
      { severity: 'warning', check: 'Z', rule_id: 'Z.unk',  message: 'c' },
    ]);
    const decisions = applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'active', threshold: 0.4, action: 'suppress', min_samples: 5 },
      historyProvider: (rid, dom) => {
        if (rid === 'X.bad')  return { adopted: 1,  total: 100 }; // ~0.03 → suppress
        if (rid === 'Y.good') return { adopted: 80, total: 100 }; // ~0.79 → allow
        return { adopted: 0, total: 0 };
      },
      severityProvider: () => ({ adopted: 0, total: 0 }), // Z.unk falls to prior → allow
      filePath: 'app/views/pages/index.html.liquid',
    });
    const remainingChecks = [...result.errors, ...result.warnings, ...result.infos].map(d => d.check);
    expect(remainingChecks).not.toContain('X');
    expect(remainingChecks).toContain('Y');
    expect(remainingChecks).toContain('Z');
    const xDec = decisions.find(d => d.check === 'X').decision.decision;
    expect(xDec).toBe('suppress');
  });

  test('active mode + downgrade: reduces severity and rebalances buckets', () => {
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' },
    ]);
    applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'active', threshold: 0.5, action: 'downgrade', min_samples: 5 },
      historyProvider: () => ({ adopted: 1, total: 100 }),
      severityProvider: () => ({ adopted: 0, total: 0 }),
      filePath: 'app/views/pages/index.html.liquid',
    });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].cac_downgraded).toBe(true);
    expect(result.warnings[0].severity).toBe('warning');
  });

  test('active mode: error → warning → info on repeated downgrade', () => {
    // Simulate two passes (pretend a rule fires twice on consecutive runs).
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' },
    ]);
    const cfg = { ...defaultCacConfig(), enabled: true, mode: 'active', threshold: 1.0, action: 'downgrade', min_samples: 5 };
    const provider = () => ({ adopted: 0, total: 100 });
    applyCac(result, { config: cfg, historyProvider: provider, severityProvider: () => ({ adopted: 0, total: 0 }), filePath: 'app/views/pages/i.liquid' });
    expect(result.warnings[0].severity).toBe('warning');
    applyCac(result, { config: cfg, historyProvider: provider, severityProvider: () => ({ adopted: 0, total: 0 }), filePath: 'app/views/pages/i.liquid' });
    expect(result.infos[0].severity).toBe('info');
  });

  test('predictor failure does not throw — diagnostic passes through', () => {
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' },
    ]);
    let logged = '';
    const decisions = applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'active', threshold: 0.5, action: 'suppress' },
      historyProvider: () => { throw new Error('db down'); },
      severityProvider: () => { throw new Error('db down'); },
      filePath: 'app/views/pages/i.liquid',
      log: (m) => { logged = m; },
    });
    // Even though both providers throw, scorer falls back to prior (allow) so
    // the diagnostic survives. Predictor-level failure is caught at the
    // scoring boundary via safeProvide.
    expect(result.errors).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });

  test('uses check fallback when rule_id missing — synthesizes <Check>.unmatched', () => {
    const result = makeResult([
      { severity: 'error', check: 'OrphanedPartial', message: 'a' /* no rule_id */ },
    ]);
    const seen = [];
    applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'active', threshold: 0.5, action: 'suppress', min_samples: 5 },
      historyProvider: (rid, dom) => { seen.push([rid, dom]); return { adopted: 50, total: 100 }; },
      severityProvider: () => ({ adopted: 0, total: 0 }),
      filePath: 'app/views/partials/foo.liquid',
    });
    expect(seen.some(([rid]) => rid === 'OrphanedPartial.unmatched')).toBe(true);
    expect(seen.some(([, dom]) => dom === 'partials')).toBe(true);
  });

  test('passes file_domain derived from filePath to the provider', () => {
    const result = makeResult([
      { severity: 'warning', check: 'X', rule_id: 'X.y', message: 'm' },
    ]);
    const calls = [];
    applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'shadow', threshold: 0.5, min_samples: 5 },
      historyProvider: (rid, dom) => { calls.push([rid, dom]); return { adopted: 0, total: 0 }; },
      severityProvider: () => ({ adopted: 0, total: 0 }),
      filePath: 'app/lib/queries/blog_posts/search.graphql',
    });
    expect(calls).toContainEqual(['X.y', 'queries']);
    expect(calls).toContainEqual(['X.y', null]);
  });
});

describe('applyCac: telemetry ring buffer', () => {
  test('records up to MAX_RECENT_DECISIONS most-recent entries', () => {
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' },
    ]);
    const cfg = { ...defaultCacConfig(), enabled: true, mode: 'shadow', threshold: 0.5, min_samples: 5 };
    for (let i = 0; i < 250; i++) {
      applyCac(result, {
        config: cfg,
        historyProvider: () => ({ adopted: 1, total: 100 }),
        severityProvider: () => ({ adopted: 0, total: 0 }),
        filePath: `app/views/pages/p${i}.liquid`,
      });
    }
    const recorded = getRecentCacDecisions();
    expect(recorded.length).toBeLessThanOrEqual(200);
    expect(recorded.at(-1).file).toContain('p249');
  });

  test('emits cac_decision events to sessionBus when provided', () => {
    const events = [];
    const sessionBus = { emit: (kind, payload, ts) => events.push({ kind, payload, ts }) };
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' },
    ]);
    applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'shadow', threshold: 0.5, min_samples: 5 },
      historyProvider: () => ({ adopted: 1, total: 100 }),
      severityProvider: () => ({ adopted: 0, total: 0 }),
      sessionBus,
      filePath: 'app/views/pages/p.liquid',
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('cac_decision');
    expect(events[0].payload.decision).toBe('downgrade');
    // Regression: the payload MUST NOT carry a `ts` field — that key is
    // reserved by the session-bus envelope (ENVELOPE_KEYS in
    // session-events.js). When it slipped through, makeEvent threw and the
    // try/catch in recordDecision dropped the event silently. The bus arg
    // is the timestamp's only home.
    expect(events[0].payload.ts).toBeUndefined();
    expect(typeof events[0].ts).toBe('string');
    expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('emit failure does not break the in-memory ring', () => {
    // The session bus may throw on its own (writer closed, fsync error,
    // misconfigured kind). The predictor's audit trail in memory is the
    // dashboard's primary source within a session — it must survive.
    const sessionBus = {
      emit: () => { throw new Error('writer closed'); },
    };
    const result = makeResult([
      { severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' },
    ]);
    expect(() => applyCac(result, {
      config: { ...defaultCacConfig(), enabled: true, mode: 'shadow', threshold: 0.5, min_samples: 5 },
      historyProvider: () => ({ adopted: 1, total: 100 }),
      severityProvider: () => ({ adopted: 0, total: 0 }),
      sessionBus,
      filePath: 'app/views/pages/p.liquid',
    })).not.toThrow();
    expect(getRecentCacDecisions()).toHaveLength(1);
  });
});

// ── loadRecentCacDecisions / rehydrateRecentCacDecisions ─────────────────────

const SID = 'session-2026-04-29T00-00-00-000Z';

function writeSessionLog(dir, sessionName, events) {
  const sessionDir = join(dir, sessionName);
  mkdirSync(sessionDir, { recursive: true });
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(sessionDir, 'events.ndjson'), lines, 'utf8');
}

function cacDecisionEvent({ session = SID, ts, ...payload }) {
  return makeEvent({
    session_id: session,
    ts,
    kind: 'cac_decision',
    payload: {
      file: 'app/views/pages/p.liquid',
      rule_id: 'X.y',
      check: 'X',
      severity: 'warning',
      file_domain: 'pages',
      p_adopted: 0.18,
      p_lower: 0.05,
      p_upper: 0.45,
      n_samples: 7,
      feature: 'rule_id',
      decision: 'downgrade',
      reason: 'below_threshold',
      mode: 'shadow',
      ...payload,
    },
  });
}

describe('loadRecentCacDecisions', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cac-load-'));
  });

  test('returns [] when sessions dir is missing', () => {
    expect(loadRecentCacDecisions(join(dir, 'absent'))).toEqual([]);
  });

  test('returns [] when sessions dir is empty', () => {
    mkdirSync(join(dir, 'sessions'));
    expect(loadRecentCacDecisions(join(dir, 'sessions'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads cac_decision events from one session and returns ring-shape entries', () => {
    const events = [
      cacDecisionEvent({ ts: '2026-04-29T01:00:00.000Z', file: 'a.liquid', rule_id: 'A.x' }),
      cacDecisionEvent({ ts: '2026-04-29T01:00:01.000Z', file: 'b.liquid', rule_id: 'B.y' }),
    ];
    writeSessionLog(dir, SID, events);

    const out = loadRecentCacDecisions(dir);
    expect(out).toHaveLength(2);
    expect(out[0].ts).toBe('2026-04-29T01:00:00.000Z');
    expect(out[0].file).toBe('a.liquid');
    expect(out[0].rule_id).toBe('A.x');
    // Ring shape: ts is on the entry, payload fields are flattened
    expect(out[1].decision).toBe('downgrade');
    expect(out[1].feature).toBe('rule_id');
    rmSync(dir, { recursive: true, force: true });
  });

  test('skips non-cac_decision lines without crashing', () => {
    const mixed = [
      makeEvent({ session_id: SID, ts: '2026-04-29T01:00:00.000Z', kind: 'server_start',
        payload: { project_dir: '/x', version: '0.0.0', started_at: '2026-04-29T01:00:00.000Z' } }),
      cacDecisionEvent({ ts: '2026-04-29T01:00:01.000Z' }),
      makeEvent({ session_id: SID, ts: '2026-04-29T01:00:02.000Z', kind: 'log',
        payload: { level: 'info', message: 'hi' } }),
    ];
    writeSessionLog(dir, SID, mixed);

    const out = loadRecentCacDecisions(dir);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe('2026-04-29T01:00:01.000Z');
    rmSync(dir, { recursive: true, force: true });
  });

  test('tolerates malformed JSON lines and partial events', () => {
    const valid = cacDecisionEvent({ ts: '2026-04-29T01:00:00.000Z' });
    const sessionDir = join(dir, SID);
    mkdirSync(sessionDir, { recursive: true });
    const content = [
      '{not-json',
      JSON.stringify(valid),
      '',
      '{"v":1,"session_id":"x","ts":"2026-04-29T01:00:00.000Z","kind":"cac_decision"}', // missing payload fields
      '{"v":99,"kind":"cac_decision"}', // unsupported version
    ].join('\n');
    writeSessionLog(dir, SID, []); // ensure dir exists; we then overwrite the file
    writeFileSync(join(sessionDir, 'events.ndjson'), content, 'utf8');

    const out = loadRecentCacDecisions(dir);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe('2026-04-29T01:00:00.000Z');
    rmSync(dir, { recursive: true, force: true });
  });

  test('merges decisions across multiple sessions in chronological order', () => {
    writeSessionLog(dir, 'session-2026-04-28T00-00-00-000Z', [
      cacDecisionEvent({ session: 'session-2026-04-28T00-00-00-000Z',
        ts: '2026-04-28T01:00:00.000Z', file: 'old.liquid' }),
    ]);
    writeSessionLog(dir, 'session-2026-04-29T00-00-00-000Z', [
      cacDecisionEvent({ session: 'session-2026-04-29T00-00-00-000Z',
        ts: '2026-04-29T01:00:00.000Z', file: 'new.liquid' }),
    ]);

    const out = loadRecentCacDecisions(dir);
    expect(out).toHaveLength(2);
    expect(out[0].file).toBe('old.liquid');
    expect(out[1].file).toBe('new.liquid');
    rmSync(dir, { recursive: true, force: true });
  });

  test('respects the limit, keeping the most recent entries', () => {
    const events = [];
    for (let i = 0; i < 50; i++) {
      const tsMs = Date.UTC(2026, 3, 29, 1, 0, i, 0); // sequential second granularity
      events.push(cacDecisionEvent({
        ts: new Date(tsMs).toISOString(),
        file: `f${i}.liquid`,
      }));
    }
    writeSessionLog(dir, SID, events);

    const out = loadRecentCacDecisions(dir, 10);
    expect(out).toHaveLength(10);
    // Most recent kept, oldest dropped
    expect(out[0].file).toBe('f40.liquid');
    expect(out[9].file).toBe('f49.liquid');
    rmSync(dir, { recursive: true, force: true });
  });

  test('limit <= 0 returns empty without I/O', () => {
    expect(loadRecentCacDecisions(dir, 0)).toEqual([]);
    expect(loadRecentCacDecisions(dir, -5)).toEqual([]);
  });
});

describe('rehydrateRecentCacDecisions', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cac-rehydrate-'));
    clearRecentCacDecisions();
  });

  test('replaces the in-memory ring with decisions from disk', () => {
    writeSessionLog(dir, SID, [
      cacDecisionEvent({ ts: '2026-04-29T01:00:00.000Z', file: 'a.liquid' }),
      cacDecisionEvent({ ts: '2026-04-29T01:00:01.000Z', file: 'b.liquid' }),
    ]);

    const n = rehydrateRecentCacDecisions(dir);
    expect(n).toBe(2);
    const ring = getRecentCacDecisions();
    expect(ring).toHaveLength(2);
    expect(ring[0].file).toBe('a.liquid');
    expect(ring[1].file).toBe('b.liquid');
    rmSync(dir, { recursive: true, force: true });
  });

  test('is idempotent — repeated calls produce the same ring', () => {
    writeSessionLog(dir, SID, [
      cacDecisionEvent({ ts: '2026-04-29T01:00:00.000Z' }),
    ]);
    rehydrateRecentCacDecisions(dir);
    rehydrateRecentCacDecisions(dir);
    expect(getRecentCacDecisions()).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('clears the ring when the sessions dir is empty (no carry-over)', () => {
    // Pre-seed via a live emit so the ring has content
    applyCac(makeResult([{ severity: 'error', check: 'X', rule_id: 'X.bad', message: 'a' }]), {
      config: { ...defaultCacConfig(), enabled: true, mode: 'shadow', threshold: 0.5, min_samples: 5 },
      historyProvider: () => ({ adopted: 1, total: 100 }),
      severityProvider: () => ({ adopted: 0, total: 0 }),
      filePath: 'app/views/pages/p.liquid',
    });
    expect(getRecentCacDecisions().length).toBeGreaterThan(0);

    rehydrateRecentCacDecisions(dir);
    expect(getRecentCacDecisions()).toHaveLength(0);
  });

  test('handles missing sessions dir without throwing', () => {
    expect(() => rehydrateRecentCacDecisions(join(dir, 'never-existed'))).not.toThrow();
    expect(getRecentCacDecisions()).toHaveLength(0);
  });
});
