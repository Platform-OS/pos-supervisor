# Changelog

## 0.8.2 — 2026-05-20

Windows path-handling — three classes of latent bug surfaced when CI
first ran on Windows in 0.8.1. All three caused silent test failures
(no exceptions, wrong-but-plausible behaviour) and only manifested on
Windows; Linux and macOS were unaffected. No user-visible API changes
on the platforms that worked in 0.8.1.

### Fixed — `toUri` produced malformed Windows file URIs

`src/core/utils.js` `toUri` was `\`file://${p}\`` — correct on Unix,
broken on Windows where it emitted `file://C:\Users\…` instead of the
LSP-required `file:///C:/Users/…` (three slashes, forward slashes,
drive letter after the third slash). The pos-cli LSP silently rejected
the malformed URI and returned zero diagnostics, which collapsed every
`validate_code`, `LSP contract:*`, `Enrichment:*`, structural-warnings,
diff-aware, and force-disable test on Windows.

Rewritten to delegate to Node's `pathToFileURL` / `fileURLToPath` from
`node:url` — the canonical, platform-correct converter. New `fromUri`
helper for symmetry; replaced four ad-hoc `.replace('file://', '')`
strip sites in `src/tools/analyze-project.js` and `src/tools/lookup.js`
that were producing the inverse-direction garbage on Windows
(`/C:/path` instead of `C:\path`).

New unit suite `tests/unit/utils-uri.test.js` — 10 tests pinning
round-trip behaviour, pass-through for already-formed URIs, defensive
handling of malformed inputs, percent-encoding of spaces / non-ASCII.

### Fixed — project-scanner used OS-native separators in identifier keys

`src/core/project-scanner.js` populated `result.graphql['blog_posts/search']`,
`result.partials['blog_posts/card']`, `result.pages['blog_posts:get']`,
etc. by passing `readdir(dir, { recursive: true })` output verbatim as
keys. On Windows that produced `result.graphql['blog_posts\\search']`,
which broke every key-based lookup downstream (tests, intent validator
cross-ref resolution, scaffold `adapted_from`, module_info classifier,
analyze_project integrity checks, scaffold pattern detection).

Added `toPosixPath()` to `src/core/utils.js` and applied at every
boundary where a path becomes an identifier:

- `src/core/project-scanner.js` — `globFiles`, `globLiquidFiles`,
  `scanAssets`, `scanAround` normalize at the `readdir` /
  `relative` boundary so every downstream key is POSIX.
- `src/core/module-scanner.js` — five `relative()` sites
  (`scanLib` partials walk + lib walk, `scanGraphQL`,
  `scanTranslations`, `scanPages`).
- `src/core/scaffold-generator.js` — `adapted_from` derivation
  (was using `replace(projectDir + '/', '')` which doesn't match on
  Windows in either direction).
- `src/core/diagnostic-pipeline.js` — `hasRenderReferenceOnDisk`
  normalizes the constructed relPath against `selfPath`.
- `src/tools/analyze-project.js` — `join('app', 'schema', entry)`
  for the schema-validator file label.

### Fixed — getDomainFromPath returned null for every file on Windows

`src/core/domain-detector.js` `getDomainFromPath(absPath)` matched the
domain via `absPath.includes('/views/pages/')` etc. — forward slashes
hardcoded. On Windows `absPath` was native (`C:\…\app\views\pages\
home.html.liquid`); every match returned null. `scanLiquidFiles`
then dropped every file (line 287 `if (!domain) return;`), the
project_map index was empty, and every downstream consumer
(`ProjectFactGraph`, `scaffold` page counts, `invalidateProjectMap`,
`scanProject: pages keyed by {slug}:{method}`, scaffold pattern
detection, relative-render resolution) saw zero entries. Single
biggest cluster in the 0.8.2 Windows unit run — 20+ tests cascaded
from this one false negative.

Normalize the input with `toPosixPath()` at function entry, then
match against POSIX-anchored substrings. The match logic itself stays
identical and Linux paths are unaffected (the strip is a no-op there).

### Fixed — check-runner unit test used non-portable spawn targets

`tests/unit/check-runner.test.js` spawned `echo` and `false` directly —
both are cmd.exe builtins on Windows, not standalone binaries.
Replaced with `process.execPath -e '…'` which works under Bun, Node,
on Linux, macOS, and Windows. Test directory swapped from `/tmp` to
`os.tmpdir()` so the cwd resolves to a valid path on every host.
Same assertions, same parser code under test — purely a test-harness
portability fix.

### Fixed — check-runner filtered out every diagnostic on Windows

`src/core/check-runner.js:30` did `filterFile.endsWith(file.path) ||
file.path === filterFile` to attribute pos-cli diagnostics to the
requested file. pos-cli emits POSIX-separated `file.path`; on Windows
`filterFile` was native (`C:\…\app\views\pages\test.html.liquid`),
so both comparisons failed and every diagnostic was dropped silently.

Normalized both sides with `toPosixPath()` before comparing. Same
treatment for `diagnostic._filePath` so downstream consumers see a
POSIX-style attribute regardless of host. Also replaced
`filePath.startsWith('/')` in `checkContent` with `path.isAbsolute()`
— the former returned false for Windows drive-letter absolute paths
and then `join`d them under `directory`, producing nonsense.

`src/tools/analyze-project.js` `matchesFile()` updated to normalize
both `_filePath` and the caller-provided paths before comparison.

### Notes

- The CI workflow added in 0.8.1 surfaced these issues exactly as
  designed. Without the multi-shell Windows matrix none of this would
  have been observable on a Linux-only dev box.
- Linux baseline unchanged: full suite holds the pre-fix pass count
  (`bun test tests/` = 2412 pass / 5 fail, all pre-existing flakes).
- No new runtime dependencies. The path-normalization helpers are
  ~10 lines total in `src/core/utils.js`.

## 0.8.1 — 2026-05-20

Windows support — pos-cli and Node.js resolution now works on Linux,
macOS, and Windows (including Git Bash, cmd.exe, and PowerShell). No
behaviour change on platforms where 0.8.0 already worked.

### Fixed — pos-cli resolution failed on Windows

The 0.8.0 resolver in `server.js` shelled out to `which pos-cli` /
`which node` and called `fs.realpath`. That chain fails on Windows for
three independent reasons: (1) Git Bash's `which` returns MSYS paths
like `/c/Users/.../pos-cli` that Node's realpath interprets as relative
paths under cwd, raising `ENOENT`; (2) `where.exe` returns the npm
`.cmd` shim which is not executable as JS via `node <shim>`; (3) shims
aren't symlinks on Windows so realpath is a no-op. The net effect was
`pos_cli.found=false`, LSP never initialized, and only static-mode
tools were available.

Resolution is now done by `src/core/pos-cli-resolver.js`, which exposes
two pure async functions:

- `resolvePosCli()` — three ordered strategies:
  1. `npm root -g` → probe `<root>/@platformos/pos-cli/bin/pos-cli.js`.
     Most reliable, works on every OS because the npm wrapper is
     portable.
  2. PATH walk — enumerate `process.env.PATH` and probe per-platform
     candidates (`pos-cli`, `pos-cli.cmd`, `pos-cli.ps1`, `pos-cli.bat`).
     For each hit: try `realpath` (Unix symlinks) then fall back to
     parsing the npm cmd-shim content. The parser strips `%dp0%` /
     `$basedir` variable references, walks every path-like token
     ending in `pos-cli.js`, normalizes separators, and returns the
     first that exists.
  3. `createRequire` — local node_modules fallback for monorepo
     installs.
- `resolveNode()` — returns `process.execPath` when running under Node,
  PATH-walks for `node` / `node.exe` when running under Bun (since
  `process.execPath` is then Bun, not Node — pos-cli requires Node).

Both functions are non-throwing — every external interaction is wrapped
so a missing tool, broken PATH entry, unreadable shim, or 64 KB+ file
masquerading as a shim cannot crash server startup.

### Changed — files touched

- `src/server.js` — replaced the inline `which`/`realpath` block with
  `await Promise.all([resolvePosCli(), resolveNode()])`. The
  `pos_cli_found` event now carries `source` (`npm-root` / `path-walk`
  / `local-require`) for diagnostics, and the log line names both the
  resolver strategy and the Node binary path.
- `src/http-server.js` — `handlePosCliCommand()` now takes `nodeBin`
  alongside `posCliPath`. The previous `spawn('node', [posCliPath, …])`
  is now `spawn(nodeBin, [posCliPath, …])` — the literal `'node'`
  would fail on Windows if Node was not on the spawning shell's
  resolved-name table, and would invoke Bun if the host runtime was
  Bun. `startHttp({…, nodeBin})` plumbed through from `server.js`.
- `tests/integration/pos-cli/guard.js` — uses the resolver instead of
  bare `spawnSync('pos-cli', ['--version'])`. The previous guard
  silently reported "not found" on Windows even when pos-cli was
  installed, because Node's spawn cannot auto-resolve a `.cmd` shim
  without `shell: true` (which would mangle stderr for the version
  check). Honest skip on Windows when pos-cli is truly missing,
  honest run when it's installed as a `.cmd` shim.

### Added — tests

- `tests/unit/pos-cli-resolver.test.js` — 12 tests covering shim
  parsing for real Windows `.cmd`, PowerShell `.ps1`, and Unix
  `/bin/sh` wrapper content; symlink resolution; oversize / garbage
  rejection; non-throwing contract for `resolveNode()`. Fixtures are
  real npm-cmd-shim text written to a tmpdir tree mirroring the
  global-install layout.

## 0.8.0 — 2026-05-20

Runtime switches from Node.js to Bun, and the lone colon-named hint file
is normalized to a Windows-portable name. No user-visible behaviour
change beyond install prerequisites; runtime check IDs (including
`pos-supervisor:NonGetRenderingPage`) are unchanged.

### Changed — Bun runtime

`bin/pos-supervisor.js` shebang is now `#!/usr/bin/env bun`. `npm link`
still produces the `pos-supervisor` PATH binary; the symlink target's
shebang dispatches to Bun. `package.json` updates: `start` script uses
`bun`, `engines.bun >= 1.0` replaces `engines.node >= 18`. Claude Code
and OpenCode configs need no change — they keep invoking
`pos-supervisor` and pick up Bun via the shebang.

Existing users must install Bun once
(`curl -fsSL https://bun.sh/install | bash`). The existing
`node_modules` tree (all deps are pure JS) and the existing `npm link`
symlink keep working — no re-install, no re-link.

### Changed — `src/data/hints/pos-supervisor:NonGetRenderingPage.md` → `NonGetRenderingPage.md`

The `:` in the original filename is reserved on Windows / NTFS and
broke clones on every Windows-hosted developer machine. The hint
filename is now bare `NonGetRenderingPage.md`, matching the rest of
`src/data/hints/`. The runtime check ID emitted by the rule engine and
structural-warnings layer stays `pos-supervisor:NonGetRenderingPage` —
nothing in telemetry, test fixtures, or downstream consumers needs to
change.

The filename ↔ check ID mapping is now: bare filename ←→ runtime ID
with optional `pos-supervisor:` prefix. The prefix is stripped in:

- `src/core/hint-loader.js` `getHint()` — cache lookup
- `src/http-server.js` `handleGetHints()` — `GET /api/hints?name=`
  filename resolution + static/rule name canonicalization for the
  unfiltered list so dedup merges both sources
- `src/dashboard.js` — the three `src/data/hints/<X>.md` display paths
- `src/core/analytics-queries.js` `recommendations()` — the
  "rewrite hint in …" recommendation string

All other hint files are unaffected (their check IDs have no prefix, so
the strip is a no-op).

## 0.7.3 — 2026-04-30

Reporting baseline + sample-size-gated labels — operator-set checkpoint
that filters every dashboard widget and exported Markdown report by a
chosen "stats since" timestamp, plus a presentation-layer label gate
that replaces nonsense `AT RISK -100%` / `HARMFUL` headlines on N<5
samples with `INSUFFICIENT_DATA`. Engine state (auto-disable, case-base
scoring, CAC predictor, adaptive-mode probation) is **never** baselined
— it always sees full history. Default behaviour with no baseline set
is identical to 0.7.2.

### Added — `src/core/analytics-store.js` baseline helpers

Two new meta keys (`analytics_baseline_ts`, `analytics_baseline_set_at`)
plus four helpers: `getBaselineTs()`, `getBaselineMeta()`,
`setBaselineTs(iso | null)`, `clearBaseline()`. Stored in the existing
`meta` table — no schema migration. `setBaselineTs` validates ISO input
and rejects malformed strings with `TypeError` so the HTTP layer can
return 400 cleanly. The baseline survives `rebuild()` (rebuild only
clears derived data, not meta).

### Added — `src/core/analytics-labels.js`

Pure, side-effect-free presentation module owning the GOOD / OK / LOW /
HARMFUL, AT RISK / UNMATCHED, and INSUFFICIENT_DATA labels. The
`LABEL_MIN_OUTCOMES = 5` gate is the load-bearing change: a rule with a
single regression no longer headlines as AT RISK -100%, it lands in
INSUFFICIENT_DATA. Exports `checkLabel`, `ruleLabel`, `harmfulSummary`,
`withCheckLabels`, `withRuleLabels`. The HTTP layer wraps every
scorecard / rule-performance response with `withCheckLabels` /
`withRuleLabels` so the dashboard reads `.label` directly without
recomputing client-side. Inline label calculations in dashboard.js are
preserved as fallbacks for un-labelled responses.

### Added — `since` parameter across reporting queries

Tri-state contract on every reporting query in
`src/core/analytics-queries.js` (`checkScorecards`, `rulePerformance`,
`fixRulePerformance`, `fixAdoptionFunnel`, `knowledgeGaps`,
`confidenceCalibration`, `ruleScoresByCategory`, `sessionSummaries`,
`toolSequenceBigrams`, `diagnosticJourney`, `ruleDrilldown`,
`recommendations`) and the reporting paths in `src/core/case-base.js`
(`retrieveCases`, `retrieveCasesByCheck`, `ruleScores`, `suggestedRules`,
`synthesizeGuardPredicate`):

- `since: undefined` → reads the operator-set baseline from
  `meta.analytics_baseline_ts`. Absent meta ⇒ no filter ⇒ full history.
  This is the dashboard / report default.
- `since: null` → explicit bypass. Reserved for engine-state callers
  that must see full history regardless of baseline.
  `server.js:syncDisabledRules` and `tools/server-status.js` were
  updated to pass this. `scoreRule` and `cac-predictor` providers and
  `resolveProbation` keep no `since` parameter at all — they cannot
  accept a baseline argument by design.
- `since: '<ISO>'` → explicit override. Used by the dashboard's "Stats
  since" dropdown for 24h / 7d / custom selections.

### Added — HTTP endpoints + `?since=` parameter

Two new endpoints on `src/http-server.js`:

- `GET /api/analytics/baseline` → `{ baseline_ts, set_at }`.
- `POST /api/analytics/baseline` body `{ baseline_ts: ISO | null }` →
  sets / clears, echoes the resolved meta. 400 on malformed ISO.

Every existing analytics endpoint accepts `?since=<ISO>` (explicit
override), `?since=all` (engine bypass), or omits `since` (meta
default). The exported `parseSinceParam` helper has unit-test coverage
pinning the tri-state contract. Responses include a `since` echo field
so the dashboard renders the "Stats since" status pill without a
separate roundtrip.

### Added — Dashboard "Stats since" controls

The Analytics tab's refresh bar gains a select + "Set baseline now" /
"Clear baseline" buttons + an inline state pill. The dropdown's
"Since baseline (default)" option mirrors the report's behaviour;
"All time" bypasses; "Last 24 hours" / "Last 7 days" / "Custom" do what
they say. Custom takes a free-form ISO string. Setting / clearing the
baseline triggers a full analytics refresh so every widget reflects the
change. The Markdown report header gains a "Stats since: …" field that
echoes whichever filter the report was generated under, so an old
export remains self-documenting.

### Changed — Sample-size gate replaces inline label calcs

Three Markdown-report rendering sites in `src/dashboard.js` (executive
summary HARMFUL list, scorecard table, rule-performance table) and the
live HTML rule-performance table now read `.label` from the server
response and fall back to inline calculations only when the server
didn't attach one. The previous behaviour of computing labels from raw
effectiveness without a sample-size guard is gone.

### Engine state — explicit bypass

`src/server.js:syncDisabledRules` and `src/tools/server-status.js`
auto-disable / disabled-rules snapshot now pass `since: null`
explicitly. `resolveSince` recognises `null` as the engine bypass
marker and returns it unchanged regardless of any operator baseline.
This keeps the auto-disable loop and case-base scoring stable across
baseline edits — operators can experiment with reporting windows
without affecting the runtime engine state.

### Tests

- `tests/unit/analytics-store.test.js` — 7 new tests covering
  baseline get / set / clear / persistence / rebuild-survival /
  validation.
- `tests/unit/analytics-labels.test.js` (new) — 27 tests pinning the
  label contract, the sample-size gate at the threshold boundary, the
  `unmatched` precedence, and the `withCheckLabels` / `withRuleLabels`
  immutability.
- `tests/unit/analytics-queries.test.js` — 14 new `since`-variant
  tests, one per filterable function plus precedence cases.
- `tests/unit/case-base.test.js` — 8 new tests covering the case-base
  reporting paths plus a deliberate test that `scoreRule` has no
  `since` parameter (engine-path invariant).
- `tests/unit/http-since-param.test.js` (new) — 8 tests pinning the
  HTTP-layer `?since=` parser tri-state contract.

Total: 64 new tests. Full unit suite passes (1 pre-existing failure
in `load-development-guide` expectation drift, unrelated to this
change).

## 0.7.2 — 2026-04-28

CAC predictor — opt-in 4th gating axis for the diagnostic emit
cascade (Cohen's Agentic Conjecture). Introduces a hierarchical
empirical-Bayes scorer over the analytics store that predicts the
probability an agent will adopt the proposed fix for a given
diagnostic, and either suppresses or downgrades emits whose
predicted adoption falls below a configured threshold. **Disabled
by default**; behavior is bit-identical to 0.7.1 until an operator
explicitly enables it from the dashboard.

### Added — `src/core/cac-config.js`

Persisted config at `<projectDir>/.pos-supervisor/cac-config.json`.
Mirrors the `rule-overrides.js` pattern (atomic temp+rename writes,
tolerant reads, never throws). Schema:
`{ version: 1, enabled: false, mode: 'shadow' | 'active', threshold:
0.30, action: 'downgrade' | 'suppress', min_samples: 5 }`.
Out-of-range values are coerced to defaults — invalid mode strings,
threshold outside `[0, 1]`, negative `min_samples`, etc. all silently
fall back instead of throwing. Public API: `loadCacConfig`,
`saveCacConfig`, `updateCacConfig`, `defaultCacConfig`,
`VALID_MODES`, `VALID_ACTIONS`.

### Added — `src/core/cac-predictor.js`

Pure scoring + decision functions, decoupled from the integration
via dependency injection (`historyProvider` / `severityProvider`):

- `scoreFixHelpfulness({ rule_id, severity, file_domain, min_samples,
  historyProvider, severityProvider })` — hierarchical
  empirical-Bayes scorer. Tries `(rule_id, file_domain)` first, falls
  back to `(rule_id)` alone, then `(severity)`, then a `Beta(2, 2)`
  prior. Returns `{ p_adopted, p_lower, p_upper, n_samples, adopted,
  feature, model }` where `feature ∈ { 'rule_id+domain', 'rule_id',
  'severity', 'prior' }`. Re-uses `betaPosterior(...)` already
  exported from `analytics-queries.js`.
- `decideAction(prediction, config)` — returns `{ decision, reason }`
  where decision is `'allow' | 'downgrade' | 'suppress'`. The
  `feature: 'prior'` case (no signal) always allows — the predictor
  refuses to gate when flying blind.
- `applyCac(result, { config, analyticsStore, filePath, sessionBus,
  log })` — the gate function. Walks `result.errors / warnings /
  infos`, scores each diagnostic, and either passes through (shadow
  mode) or mutates the result (active mode). Severity downgrades
  trigger a bucket rebalance so `result.errors → result.warnings`
  reflects the new severity. NEVER throws — predictor / store
  failures degrade open. **Predictor only ever suppresses or
  downgrades; never adds, never mutates fix proposals.**
- `buildHistoryProvider(analyticsStore)` /
  `buildSeverityProvider(analyticsStore)` — real implementations
  that issue correlated SQL subqueries against
  `diagnostics × outcomes` and return `{ adopted, total }`. Each
  provider is wrapped in `safeProvide` so a failed query is treated
  as zero samples (falls through the hierarchy).
- In-memory ring buffer of the last 200 decisions
  (`getRecentCacDecisions(limit)`) plus a
  `sessionBus.emit('cac_decision', ...)` event per decision for the
  dashboard's recent-decisions panel.

### Added — validate-code integration (`src/tools/validate-code.js`)

New step 12c, inserted between the existing force-disable filter
(step 12b) and the null-hint strip (step 12). Reads
`ctx.cacConfigState?.current.enabled` — when `false`, the call site
short-circuits and validate-code is bit-identical to 0.7.1. When
enabled, `applyCac(...)` is called inside a try/catch — any
predictor failure is logged and diagnostics pass through unchanged.
Skipped when `ctx.untracked` is set (dashboard live-console calls).

### Added — server wiring (`src/server.js`)

Shared mutable config ref:
`const cacConfigState = { current: loadCacConfig(projectDir, { log })
}`. Threaded through `ctx` so validate-code reads the latest config
on every call. New `syncCacConfig()` callback passed to `startHttp`
as `onCacConfigChanged` — POST to `/api/cac/config` triggers it,
re-reading the file and refreshing the live ref without restart
(mirrors the existing `onOverridesChanged` hot-reload pattern for
rule overrides).

### Added — HTTP endpoints (`src/http-server.js`)

- **`GET /api/cac/config`** — returns
  `{ config, defaults, valid_modes, valid_actions }` for dashboard
  bootstrapping.
- **`POST /api/cac/config`** — body is any subset of
  `{ enabled, mode, threshold, action, min_samples }`. Unknown keys
  are silently dropped; out-of-range values are coerced. Triggers
  `onCacConfigChanged` for live-ref refresh. Returns `{ config }`
  with the persisted state.
- **`GET /api/cac/decisions?limit=N`** — returns
  `{ count, decisions, summary }` from the ring buffer. `summary`
  groups by `decision` (allow / downgrade / suppress), `feature`,
  and `mode` for at-a-glance dashboard stats.

### Added — dashboard CAC Predictor panel (`src/dashboard.js`)

New panel inside the Engine Map tab, sited next to "Adaptive Mode
Impact":

- **Status badge** (OFF / SHADOW / ACTIVE) with color-coded fill.
- **Three-state toggle** — Off / Shadow / Active. Active requires
  `confirm()` (prevents accidental enable). Each click POSTs the
  matching patch and re-renders.
- **Threshold slider** (0–1, step 0.05) with live label.
- **Action selector** (Downgrade / Suppress).
- **min_samples** numeric input.
- **Recent decisions** mini-table — last 30 entries with rule_id,
  file (last two segments), feature, P(adopted), N samples,
  decision, mode. Color-coded decision column.
- Refresh button + auto-fetch when the Engine Map tab is opened.

CSS additions (`.cac-*` classes) follow the existing AMI / em-panel
style. Browser-side dashboard JS verified via inline `Function()`
constructor parse — passes.

### Tests

- `tests/unit/cac-config.test.js` — 13 cases: defaults, missing-file
  load, malformed-JSON tolerance, round-trip, invalid mode coerced,
  out-of-range threshold clamped, negative `min_samples` rejected,
  patch via `updateCacConfig`, unknown-keys dropped.
- `tests/unit/cac-predictor.test.js` — 19 cases covering the scorer
  hierarchy (`rule_id+domain` → `rule_id` → `severity` → `prior`),
  the decision function (prior always allows; threshold gating with
  both `suppress` and `downgrade` actions), the gate (disabled →
  no-op, shadow → records-only, active → mutates result, severity
  downgrade rebalances buckets, predictor failure passes through,
  `<Check>.unmatched` synthesized when rule_id is missing,
  file_domain derived from `filePath`, ring buffer caps at 200,
  `sessionBus.emit('cac_decision', ...)` fires).
- `tests/integration/cac/toggle.test.js` — 8 end-to-end cases
  exercising the full HTTP + validate-code path: defaults at boot,
  disabled is a true no-op, shadow records but doesn't modify,
  active mode is wired without crashing, disabling resets behavior
  immediately, garbage POST returns 400, unknown keys dropped,
  out-of-range threshold coerced.

40 new tests (32 unit + 8 integration), all green. Pre-existing
flakes in `tests/integration/scenarios/` and the `0.7.0`-documented
`load_development_guide` drift are unchanged by this release —
verified by stashing the diff and re-running on a clean tree.

### Safety contract

The CAC layer is fully separable. Disabling it (`enabled: false` in
config — the default) makes validate-code execute the same code path
as 0.7.1: the integration call site is gated by a single `if
(cacConfig?.enabled && !ctx.untracked)` check. Even when enabled,
the predictor only ever suppresses or downgrades — it never adds
diagnostics, never mutates fix proposals, and never throws (every
boundary is wrapped). Schema migrations are not required — the
analytics DB is unchanged.

### Fixed — CAC decisions are now persistent

Two compounding silent failures were dropping every CAC decision on
the floor before reaching disk, leaving the dashboard's "Recent CAC
Decisions" panel empty after every server restart even though the
predictor was firing correctly.

1. **Missing event-kind registration.** `recordDecision` called
   `sessionBus.emit('cac_decision', …)`, but `cac_decision` was
   absent from `KIND_SCHEMAS` in `src/core/session-events.js`.
   `makeEvent` threw `unknown kind "cac_decision"`, the throw was
   swallowed by the `try { sessionBus.emit(…) } catch {}` wrapper,
   and the event never reached the NDJSON writer.
2. **Envelope-key collision in the payload.** Even after registering
   the schema, the in-memory ring entry carried its own `ts` field
   that collided with `ENVELOPE_KEYS` in `makeEvent`, so the next
   gate would have thrown `reserved envelope key "ts"` and been
   swallowed too.

Both fixes are in this release:

- `src/core/session-events.js` — added `CacDecisionPayload` (typed
  enums for `feature` / `decision` / `mode` / `severity`, nullable
  probability fields for the no-signal `prior` case), registered as
  `cac_decision` in `KIND_SCHEMAS`. Pinned by 6 new tests covering
  happy path, the `prior` shape with null probabilities, the `ts`
  envelope-collision regression, an unknown-decision rejection, and
  full NDJSON roundtrip.
- `src/core/cac-predictor.js::recordDecision` — compute `ts` once,
  pass it as the `emit(kind, payload, ts)` third argument, strip
  `ts` from the payload. Refactored ring push into `pushRingEntry`
  shared by live emits and the rehydrator. Added defensive `?? null`
  on optional payload fields so `.nullable()` schema constraints
  hold even for malformed callers. Bus-failure regression test
  asserts a thrown emit no longer drops the in-memory ring entry.

### Added — CAC decision rehydration on startup

The 200-entry `recentDecisions` ring lives in module-level memory and
was previously never read from disk on boot, so the dashboard panel
started empty even when prior sessions' NDJSON logs contained
hundreds of decisions. New layer:

- `loadRecentCacDecisions(sessionsDir, limit)` — pure function. Lists
  `<sessionsDir>/session-*` subdirectories newest-first (session ids
  are ISO timestamps, so lexical sort matches chronological), peeks
  each line via cheap `JSON.parse` for `kind === 'cac_decision'`
  before paying the full `readEvent` Zod cost, sorts the surviving
  entries by `ts` ascending, trims to `limit`. Tolerates corrupt
  JSON, malformed payloads, future-version events, missing files,
  and an absent sessions directory — every error path returns `[]`
  so a broken log can never block server boot. Overscan caps I/O at
  `2 × limit` candidates across recent sessions.
- `rehydrateRecentCacDecisions(sessionsDir, limit)` — replaces the
  ring contents and returns the count. Idempotent; safe to call
  before any live emits.
- `src/server.js` — wired immediately after `syncCacConfig()` (uses
  the existing `sessionsDir` declared above, no new globals). Logs
  `cac-predictor: rehydrated N decision(s) from prior sessions` only
  when N > 0; runs even when the predictor is disabled so flipping
  it on later in the session doesn't show an empty audit trail.
  Try/catch wrapped — boot continues unconditionally on I/O failure.

13 new tests cover missing dir, empty dir, single-session reads,
mixed-kind sessions, corrupt JSON / partial events / future-version
lines, multi-session chronological merge, limit clamp + most-recent
semantics, idempotence, and ring clearing when the sessions dir is
empty.

End-to-end verified on a real project: validate_code on a broken
file produced 2 errors → 2 `cac_decision` lines persisted to
`events.ndjson` → server restart → log line `rehydrated 2
decision(s) from prior sessions` → `/api/cac/decisions` returned
both entries with their original session timestamps preserved.

### Fixed — `function`/`graphql` tag `lib/` prefix is invalid, never optional

platformOS resolves `function` tag paths under the partial search
paths declared by `@platformos/platformos-common`:
`FILE_TYPE_DIRS[Partial] = ['views/partials', 'lib']` joined under
`app/`. So `'commands/X'` resolves to `app/lib/commands/X.liquid`,
and `'lib/commands/X'` resolves to `app/lib/lib/commands/X.liquid`
— a directory that never exists in any sane project. The literal
`lib/` prefix is **invalid**, not optional. The `graphql` tag uses
a different search path (`['graphql', 'graph_queries']` under
`app/`), so `'lib/queries/X'` in a `{% graphql %}` tag is doubly
wrong.

Pos-supervisor was systematically encoding the wrong assumption in
five places — and worse, the fix-generator and rule engine were
**suppressing the LSP's correct `MissingPartial` diagnostic** by
stripping the `lib/` prefix before the disk check, so the agent
saw "no problem" while platformOS would 500 at runtime. Compounded
by ~25 documentation files (hints, references, knowledge.json,
domain-gotchas) that listed `lib/commands/` as the canonical call
form, training every agent reading those docs to write broken code.

#### Code fixes

- `src/core/diagnostic-pipeline.js::resolveMissingPartialPaths` —
  removed the `name.replace(/^lib\//, '')` call. Now mirrors the
  upstream `DocumentsLocator` exactly, returning candidate paths
  under `app/views/partials/` and `app/lib/` verbatim. The LSP's
  `MissingPartial` for `lib/commands/X` is no longer suppressed.
- `src/tools/analyze-project.js` — same `replace(/^lib\//, '')`
  removed from the function-call resolver. `app/lib/${fc.path}.liquid`
  is now constructed directly, so `'lib/commands/X'` correctly
  resolves to `app/lib/lib/commands/X.liquid` in the error message
  and surfaces the bug to the agent. Also extended the iteration to
  `commands` / `queries` / `layouts` `function_calls` (previously
  only `pages` and `partials` were checked, so a wrong call inside
  a multi-phase command's orchestrator slipped through unchecked).
- `src/core/rules/queries.js::classifyPath` — returns
  `{ type: 'invalid_lib_prefix', path: null, correctedName }` for
  `lib/commands/` / `lib/queries/` instead of stripping. Existing
  rules already gate on `path` truthiness, so `file_exists` /
  `suggest_nearest` / `create_file` correctly skip these.
- `src/core/rules/MissingPartial.js` — added rule
  `MissingPartial.invalid_lib_prefix` at priority 5 (beats every
  other branch). Emits a `text_edit` fix using the LSP positions
  to swap the quoted reference for its `lib/`-stripped form, with
  a guidance fallback when position fields are missing.
- `src/core/fix-generator.js::fixMissingPartial` — handles the
  invalid-prefix case before any other branch; emits a `text_edit`
  with original quote-style preserved (`'` or `"`, peeked from the
  source buffer at the diagnostic column). No longer proposes
  creating a phantom file at `app/lib/lib/...`.
- `src/core/error-enricher.js::detectObjectType` /
  `buildCreatePath` — recognize `invalid_lib_prefix` as its own
  type and route the hint renderer to the new variant template
  with the corrected disk path.

#### New hint variant

`src/data/hints/MissingPartial-invalid_lib_prefix.md` — explains the
upstream resolver semantics and prescribes "drop the prefix"
instead of the generic "create the file" template. Renders with
both the wrong call form (so the agent recognizes their input) and
the corrected one, and the disk path the corrected call would
resolve to.

#### Data sweep — ~25 documentation files

Every `function`-tag use of `'lib/commands/X'` and `'lib/queries/X'`
in `src/data/` rewritten to `'commands/X'` / `'queries/X'`. Every
`graphql`-tag use of `'lib/queries/X'` rewritten to `'X'` (graphql
search path is `app/graphql/`, not `app/lib/queries/`). Touched
files include `knowledge.json`, `domain-gotchas.yml`,
`checks/MissingPartial.yml`, all `references/{partials, pages,
commands, authentication, graphql, liquid, modules, forms}/*.md`,
`domains/{commands, queries}.md`. Three teaching-context references
that explicitly cite `lib/commands/X` as the wrong form
(`Do NOT prepend lib/...`) were preserved deliberately. All YAML /
JSON files re-validated after the sweep.

#### Tests

- `tests/integration/analyze-project-lib-prefix.integration.test.js`
  — fully rewritten. The previous version pinned the inverse
  contract (asserting `lib/commands/X` was NOT flagged when the
  bare-form file existed); the rewrite pins the correct one
  (`lib/commands/X` MUST be flagged with the doubled `app/lib/lib/`
  resolution string in the error message; the bare `commands/X`
  form is not flagged).
- `tests/unit/rules/queries.test.js` — `classifyPath` now pinned
  on the new `invalid_lib_prefix` shape with `correctedName`.
- `tests/unit/rules/MissingPartial.test.js` — 7 new tests for the
  `invalid_lib_prefix` rule (text_edit happy path, guidance
  fallback when positions are missing, `lib/queries/` symmetry,
  doesn't fire for bare `commands/X`, doesn't fire for module
  paths, beats `create_file` even when the corrected file doesn't
  exist on disk).
- `tests/unit/diagnostic-pipeline.test.js` — 4 new tests for
  `verifyMissingPartialsOnDisk` (suppresses bare-form cache lag,
  does NOT suppress `lib/`-prefixed errors even when the bare-form
  file exists on disk, symmetric for queries, still suppresses
  legitimate non-`lib/` cache-lag misses).
- `tests/unit/error-enricher.test.js` — 2 existing tests rewritten
  to use canonical syntax; 1 new regression test pinning that the
  invalid-prefix variant fires "drop the prefix" copy and never
  the create-file template, with the single-`lib/` corrected disk
  path always in the hint.

Targeted: 373/373 pass across 22 touched test files. Full suite:
2238/2243 pass — same 5 pre-existing failures from main (CRUD
scenario timeout cascade and `load_development_guide` MANDATORY
WORKFLOW), zero new regressions.

The trigger for this work was a session report on 2026-04-29: an
agent failed repeatedly to call commands from a page, concluded
that path resolution was caller-relative ("two valid styles that
look the same but behave differently"). The diagnosis was wrong
(resolution is global, not caller-relative), but the symptom was
real and ours — agents kept writing `lib/commands/X` because our
docs said to, and our suppression hid the LSP's correct rejection.

### Fixed — Commands domain references contradicted modules/core docs

The `references/modules/core/*.md` docs were modernized for
pos-cli 6.0.7+ (canonical syntax, app-level build/check phases,
validators at `modules/core/lib/validations/<name>`), but the
parallel `references/commands/*.md` docs still showed the **legacy**
API: phantom `modules/core/commands/build` and `modules/core/commands/check`
helpers, an array-of-validators shape (`validators: [{...}]`)
passed to a single check helper, validators called at the wrong
path (`modules/core/validations/<name>` instead of
`modules/core/lib/validations/`), and validator argument order
diverging from the actual `@param` order.

Net effect: `domain_guide(commands, patterns)` returned a fake API
that would 500 at runtime, while `module_info(core, patterns)`
returned the correct one. Agents got opposite advice from the two
tools depending on which they consulted first. A real session
report on 2026-04-29 documented an agent following the wrong
domain_guide and producing a non-working command file.

#### Authoritative pattern (now consistent across both tools)

Three files per command action: orchestrator + sibling
`<action>/build.liquid` + sibling `<action>/check.liquid`. Only
`modules/core/commands/execute` is module-level. Validators chain
individually with `modules/core/lib/validations/<name>` and argument
order `c, field_name, object, [options...]`.

```liquid
{% function object = 'commands/products/create/build', object: params %}
{% function object = 'commands/products/create/check', object: object %}
{% function c = 'modules/core/lib/validations/presence',
   c: c, field_name: 'title', object: object %}
{% function object = 'modules/core/commands/execute',
   mutation_name: 'products/create',
   selection: 'record_create',
   object: object %}
```

#### Files rewritten — `src/data/references/commands/`

- `README.md` — minimal orchestrator example now uses the canonical
  three-file pattern. Removed every legacy build/check reference
  that wasn't an explicit anti-pattern callout.
- `configuration.md` — directory tree shows
  `<action>.liquid` + `<action>/build.liquid` + `<action>/check.liquid`
  per CRUD operation. Naming-conventions table includes the new
  "Phase call" row. Command file template rewritten as the
  three-file canonical layout.
- `api.md` — fully rewritten. Removed the phantom
  `modules/core/commands/build` and `modules/core/commands/check`
  sections. Validator family now keyed at
  `modules/core/lib/validations/<name>` with the modern names
  (`number`, `matches`, `equal`, `included`, …). New "Legacy
  Forms — No Longer Supported" appendix lists every renamed
  validator and the `validators: [...]` shape so existing agents
  reading legacy docs know what to migrate.
- `patterns.md` — fully rewritten. CRUD examples (create / update /
  delete / event-publishing / conditional validation / error
  display / command composition) all use the canonical
  three-file shape with chained `lib/validations/<name>` calls.
- `gotchas.md` — TOP GOTCHA section explicitly framing the
  phantom `modules/core/commands/build` / `…/check` as the most
  common error. New entries for the wrong validator path
  (`modules/core/validations/` vs `modules/core/lib/validations/`),
  the legacy `validators: validators` array shape, and the new
  argument order. Troubleshooting flowchart updated.
- `advanced.md` — transactions / composition / custom validation /
  uniqueness / file uploads / idempotent / debugging — all
  rewritten to the canonical three-file shape. The transaction
  example no longer reaches for a phantom
  `modules/core/commands/build` for line items.

#### Secondary doc sweep

- `references/partials/patterns.md` — Command Partial Pattern
  example rewritten to use `commands/products/create/build` and
  `commands/products/create/check` (was using the phantom helpers).
- `resources/ok-platformos-development-guide.md` and
  `resources/short-platformos-development-guide.md` — Check Stage
  examples updated:
  `modules/core/validations/presence` →
  `modules/core/lib/validations/presence`, with the canonical
  argument order (`c, field_name, object`). The "DEPRECATED — DO
  NOT USE" anti-pattern callout was already correct and was left
  intact.
- `knowledge.json` and `modules-missing-docs.json` — entry
  `modules/core/validations/presence` (used by the
  MetadataParamsCheck false-positive suppression list) corrected
  to `modules/core/lib/validations/presence`. JSON files
  re-validated.

#### What was deliberately NOT changed

Every reference to `modules/core/commands/build` /
`modules/core/commands/check` / `modules/core/validations/` that
remains in the docs is now an **anti-pattern teaching reference**:
either inside a "DO NOT", "✗ WRONG", "Template not found",
"Legacy shape", or `TOP GOTCHA` block. Removing those would lose
the authoritative "this path doesn't exist; here's why" copy
agents need when they hit the error in the wild.

The authoritative `references/modules/core/*.md` docs were
already correct and remain unchanged. The `commands` domain now
mirrors them.

## 0.7.1 — 2026-04-28

Fix for the `GraphQLVariablesCheck.required` regression spiral
reported on 2026-04-27 (4 emits / 100 % regression on
`app/lib/commands/contacts/create.liquid` in DEMO) and the dashboard
404 on rule-driven check drilldowns.

### Fixed — `GraphQLVariablesCheck.required` parser blind spot

Root cause: a `{% graphql %}` call written inside a `{% liquid %}`
block with multi-line `,` continuation. Both `liquid-html-parser` and
pos-cli's LSP truncate the call at the first newline-comma —
`markup.args` ends up empty and LSP fires
`GraphQLVariablesCheck.required` for every named arg past it. The
agent sees the args in source, our `.required` hint says "add the
variable", agent rewrites cosmetically, LSP fires the same errors.
Loop.

Three coordinated changes resolve the spiral:

- **`liquid-parser.js` — graphql call extraction enriched.** Each
  `extracted.graphql` entry now carries `args: [name, …]` (from
  `markup.args`) and `source_kind: 'tag' | 'liquid_inline' |
  'liquid_multiline_truncated'`. Truncation is detected when the
  call's source range starts without `{%` (we are inside `{% liquid
  %}`), ends on `,`, and the file text immediately past the call has
  another `name:` clause on a subsequent line. New
  `classifyGraphqlSourceKind` exported for reuse. Dedup-by-queryName
  preserved; if any duplicate call is truncated, the existing entry's
  `source_kind` upgrades to the most-pessimistic value so downstream
  rules can detect the symptom regardless of which call won the dedup.
- **`rules/GraphQLVariablesCheck.js` — new `parser_blind_spot`
  sub-rule (priority 3, before `.required` at 5, confidence 0.95).**
  Fires when `direction === 'required'` AND the project graph reports
  any graphql call in the file with `source_kind ===
  'liquid_multiline_truncated'`. Hint redirects the agent at the
  syntactic root cause: convert to single-line `{% graphql … %}` tag
  form, or keep it inside `{% liquid %}` but place every named arg on
  the same line as `graphql`. Falls through to `.required` when the
  call is fine — purely additive, no risk of misfire on legitimate
  missing-variable diagnostics.
- **`structural-warnings.js` — new
  `pos-supervisor:GraphqlMultilineInLiquidBlock` (severity: error).**
  Surfaces the syntactic cause once per truncated call, before LSP
  enrichment runs. Reuses `classifyGraphqlSourceKind`. Fires for all
  domains; partials still get the existing `GraphqlInPartial` error
  on top.

### Fixed — Dashboard hint endpoint 404 on rule-driven checks

The dashboard's rule drilldown panel `GET
/api/hints?name=<Check>` 404'd for the 12+ rule-driven checks that
have no `src/data/hints/<X>.md` file (`GraphQLVariablesCheck`,
`PartialCallArguments`, `MissingRenderPartialArguments`,
`UnusedDocParam`, `LiquidHTMLSyntaxError`,
`pos-supervisor:InvalidLayout`, `pos-supervisor:MissingSlug`,
`pos-supervisor:MissingContentForLayout`,
`pos-supervisor:SchemaProperty`, `pos-supervisor:SchemaYAML`,
`pos-supervisor:DeprecatedTag`,
`pos-supervisor:TranslationMissingLocaleKey`). These checks are
served by `src/core/rules/<X>.js` modules, not static markdown — but
the endpoint was hardwired to `readFileSync('<X>.md')`.

- **`http-server.js` — `handleGetHints` now branches.** md file
  present → returns `{ source: 'static', content }`. md missing but
  rule registry has the check → returns `{ source: 'rule', content,
  rule_ids }` with a synthesized markdown reference (per sub-rule:
  `id`, priority, truncated `when()` source, footer pointing at
  `src/core/rules/<X>.js`). Both miss → 404. List endpoint unions md
  filenames with `getAllChecksWithRules()` and adds a `checks: [{
  name, sources: ['static'|'rule', …] }]` companion field. Backward
  compat preserved on the `hints` array.
- **`dashboard.js` — drilldown is source-aware.** The hint panel
  title surfaces `src/core/rules/<X>.js` for rule-driven checks
  instead of the misleading `(src/data/hints/<X>.md)` it always
  showed. Action recommendations ("edit X to rewrite the hint")
  point at whichever file actually owns the hint.
  Knowledge-browser `loadHint` renders a `[RULE-DRIVEN]` /
  `[STATIC]` source badge above the body and a readable `404`
  message instead of an empty `<pre>`. Strips `pos-supervisor:`
  prefix from the rule module path — the rule files are not
  namespaced.

### Tests

- `tests/unit/liquid-parser.test.js` — 7 new cases covering `args` +
  `source_kind` for tag, `liquid_inline`,
  `liquid_multiline_truncated` forms; the
  comma-ending-without-trailing guard; and the dedup-upgrade path.
- `tests/unit/rules/Tier3RulesPhase3.test.js` — 5 new cases covering
  `parser_blind_spot` priority, fall-through to `.required` when not
  truncated, fall-through when file is unindexed, and fall-through
  when no graph is available.
- `tests/unit/structural-warnings.test.js` — 5 new cases covering
  the `GraphqlMultilineInLiquidBlock` detector against truncated,
  tag-form, single-line liquid-block, multi-line tag-form, and
  multiple-occurrence inputs.
- `tests/unit/http-server.test.js` — 6 new cases covering list
  union, static md retrieval, rule synthesis, unknown-check 404,
  prefixed (`pos-supervisor:…`) rule round-trip, and the
  static-wins-over-rule precedence.

23 new tests, all green. Browser-side dashboard JS verified via
inline `Function()`-constructor parse.

## 0.7.0 — 2026-04-27

Rule-engine and hint quality overhaul driven by the
2026-04-27 DEMO performance report (`docs/rule-performance-plan.md`):
123 diagnostics across 17 sessions, fix-proposal rate 24 %, six rules
flagged AT RISK or HARMFUL. The headline shift after this release: every
high-volume bucket-B `.unmatched` check now lands with a stable rule_id
+ structured guidance fix; AT RISK rules ship locale-aware /
intent-aware hints that converge on the canonical platformOS shape
instead of producing contradictory advice.

### Fixed — AT RISK rules (Bucket A)

- **`MissingPartial.module_path` (was 0 % resolve / 100 % regress).** Hint
  diagnosed the symptom but never named a target. Rule now enumerates
  available module call paths from the filesystem at apply time, runs
  Levenshtein over them, and ships the top-5 candidates inline. Special
  case for `modules/<m>/commands/build` and `…/check` — the hint
  explicitly explains build / check are inline phases of the agent's
  own command and only `execute` is exported by core. Rewrote
  `MissingPartial.md` STEP 1 to remove the misleading "use core's
  execute helper" example that drove the over-generalisation. New
  `src/core/rules/module-paths.js` helper (sync filesystem walk
  mirroring `module-scanner.scanPublicApi`); `projectDir` plumbed
  through `enrichCtx` → facts in `validate-code.js` and
  `error-enricher.js` (both `enrichError` and
  `bridgeRulesOntoUnattributed`).
- **`TranslationKeyExists.suggest_nearest` (was 0 % resolve, 6 / 6 ignored).**
  Three distinct failure modes uncovered, all fixed:
  - **Locale-prefix double-up.** `flattenYaml` over a properly-rooted
    `en.yml` produces keys like `en.app.user.title` (the YAML root IS
    the locale). The rule was suggesting `en.app.user.title` for an
    agent's `app.usr.title` typo; agents wrote `'en.app.user.title' | t`
    which Liquid resolved to `en.en.app.user.title` — adopting the fix
    re-broke the lookup. `translationKeysForLocale` now strips leading
    `<locale>.`; `array_index_misuse` and `create_key` strip from the
    agent's key before computing `arrayKey` / YAML snippets;
    `suggest_nearest` matches against bare AND prefixed forms, picks
    closer. New `stripLocalePrefix(key, locale)` exported from
    `queries.js`. Hint and fix descriptions now explicitly warn against
    including the `en.` prefix.
  - **Levenshtein threshold too loose for dotted keys.** Shared helper's
    `length * 0.6` admitted distance-10 matches on 20-char keys. Local
    bound `min(5, length / 3)` per call site — brand-new keys fall
    through to `create_key` instead of attracting bogus "did you mean"s.
  - **Defensive `[N]` gate.** Every subrule (`array_index_misuse`,
    `suggest_nearest`, `create_key`) now gates on raw `diag.message` in
    addition to `params.key`. Belt-and-suspenders against extractor drift.
- **`pos-supervisor:NonGetRenderingPage` (was 20 % resolve / 20 %
  regress, 25 outcomes).** Per the
  `docs/rule-performance-plan.md` gist analysis: split into three
  intent-aware subrules + defensive default. `validatePageMethodAndForms`
  in `structural-warnings.js` (renamed from
  `validateNonGetRenderingPage`) emits discriminator-prefixed messages;
  the rule layer routes by regex.
  - `api_renders_html` — slug under `/api/`, `/_/`, `/internal/` + non-GET
    method + (HTML present OR `format: json` missing). Hint ships the
    canonical `format: json` + GraphQL JSON body shape.
  - `html_on_post` — non-API slug + non-GET method + HTML rendering. Hint
    disambiguates "landing page" vs "API handler" intents with
    copy-pasteable Liquid for both.
  - `get_form_target` — GET page hosts `<form method="post" action="X">`
    where X isn't under API prefixes and isn't the page's own slug. Hint
    routes the agent to `/api/<X>` + auto-creates the API page path.
  - Form parsing: attribute-order-independent regex; supports single,
    double, and unquoted attribute values; self-post detection
    (`action == own slug`) prevents false positives for sanctioned
    self-post pages. API page emit policy: only layout / partials /
    HTML tags count as HTML rendering — bare `{{ … }}` in `format: json`
    pages is the intended JSON serialization, NOT flagged.
- **`pos-supervisor:InvalidLayout` and `ValidFrontmatter.layout_missing`
  duplicate-emit + wrong path.** Two checks fired on the same root
  cause with diverging line numbers (line-only dedup let both through),
  and the structural emitter hardcoded `.html.liquid` for the create_file
  proposal — DEMO uses `.liquid`, so agents accepted the fix and the
  file landed at the wrong path.
  - `validateLayout` in `structural-warnings.js` now calls
    `detectLayoutExtension(projectDir, moduleName)` to sample existing
    layouts and pick `.liquid` vs `.html.liquid` (defaults to `.liquid`
    when the layouts dir is empty — modern convention).
  - `extractLayoutPath` in `fix-generator.js` lifts the path verbatim
    from the message's `Expected file: \`...\`` clause — single source
    of truth, no per-file re-derivation.
  - `suppressUpstreamFrontmatterDup` now matches by **layout name** in
    addition to line — same root cause regardless of line drift.
  - New `src/core/rules/InvalidLayout.js` rule attaches stable rule_id
    + matching create_file fix at the corrected path.

### Added — Bucket B `.unmatched` promotions (rule modules)

13 new rule modules covering every bucket-B `.unmatched` check from the
performance report. Each ships stable rule_id + structured guidance;
where a heuristic text_edit already exists in `fix-generator.js`, the
rule emits `guidance` only and the heuristic stays as the actionable
diff. End-to-end attribution verified via `bridgeRulesOntoUnattributed`.

- **`DeprecatedTag` (covers both upstream LSP and `pos-supervisor:DeprecatedTag`).**
  Subrules `include` (route to `{% render %}` w/ isolated-scope
  caveat), `hash_assign` (`{% assign x["k"] = v %}`), `parse_json`
  (`| parse_json` filter form), default. Defensive when-gates check
  both `params.tag` and raw message regex (the structural variant has
  no extractor).
- **`UnrecognizedRenderPartialArguments`.** Extracts argument + partial
  from message; emits 3-option decision tree (drop / declare / rename).
  Disables option B for module partials (read-only).
- **`SchemaProperty` (8 sub-IDs)** — routes `pos-supervisor:SchemaProperty`
  emits by regex into `builtin_conflict` / `duplicate_name` /
  `invalid_identifier` / `snake_case` / `upload_options` /
  `missing_field` / `misleading_key` / `default`.
- **`SchemaYAML`, `MissingSlug`, `MissingContentForLayout`** —
  promotions of existing fix-generator heuristics; rule emits guidance,
  heuristic still owns the text_edit.
- **`ParserBlockingScript`** — defer / async / end-of-body decision tree.
- **`TranslationMissingLocaleKey`** — extracts locale from message,
  emits before/after YAML wrap recipe.
- **`MissingAsset` (3 subrules)** —
  `missing_subdir_prefix` (high confidence: bare `logo.png` matches
  existing `images/logo.png`) → `suggest_nearest` (Levenshtein) →
  `create_file`. Replaces the heuristic's blind-create proposal.
- **`OrphanedPartial`** — emits `delete_file` fix when graph has 0
  callers; softer guidance for layouts; cites `pending_files`
  workflow for in-progress refactors.
- **`MissingPage` (2 subrules)** — `typo` (Levenshtein vs graph page
  slugs) → `default` (3-option decision tree + create_file at inferred
  path). Handles root route correctly (omit `slug:`).
- **`LiquidHTMLSyntaxError` (5 subrules)** — `unknown_tag` (Levenshtein
  vs `tagsIndex.platformOSTags()`) → `for_loop_args` →
  `missing_assign` → `inline_literal` → `default`.
- **`PartialCallArguments` (4 subrules)** — highest-volume bucket-B
  check (28 emits in DEMO). New extractor parses both
  `Required parameter X must be passed to (render|function) call` and
  `Unknown parameter X passed to ...` shapes. Subrules
  `required_render`, `required_function`, `unknown_render`,
  `unknown_function` ship copy-pasteable forwarding patterns + the
  canonical drop / declare / rename resolution. Cross-references the
  sibling `MissingRenderPartialArguments` /
  `UnrecognizedRenderPartialArguments` checks (which carry the partial
  path when they co-fire).
- **`GraphQLVariablesCheck` (2 subrules + default)** — new extractor
  for `Required parameter X must be passed to GraphQL call` /
  `Unknown parameter X passed to GraphQL call`. Hint surfaces a
  per-call **signature block** when the file's `graphql_calls` are
  indexed — lists every operation invoked + its declared
  `$var: Type` list parsed from the .graphql operation header.
- **`UnusedDocParam`** — caller-aware confidence: 0.8 when graph shows
  zero callers (option B = remove `@param` is safe); 0.65 when callers
  exist (removing the declaration becomes a contract change). Hint
  references the pipeline's `suppressUnusedDocParams` so agents
  understand surviving emits aren't the named-arg false positive.
  No text_edit — contract change with cross-file blast radius is not
  safe for the rule layer to automate.

### Added — query helpers

- `assetNames(graph)` — list every indexed asset path
  (`MissingAsset.suggest_nearest`).
- `stripLocalePrefix(key, locale)` — translation-key normalisation.
- `parseModulePath(name)` exported from `MissingPartial.js` —
  splits `modules/<name>/<category>/<rest>` for analytics callers.

### Changed — graph plumbing

- `project-scanner.js` and `project-fact-graph.js` now propagate
  `graphql_calls` to **pages, partials, AND layouts** (previously
  commands/queries only). Without this, `GraphQLVariablesCheck`'s
  signature block was empty for the most common caller — API pages
  emitting JSON.

### Changed — extractors

- New `extractParams` entries for `PartialCallArguments`,
  `GraphQLVariablesCheck`, `UnusedDocParam` in `diagnostic-record.js`.

### Tests

130 new unit tests across 7 new rule-test files
(`module-paths.test.js`, extended `MissingPartial.test.js`,
`TranslationKeyExists.test.js`, `Tier3Rules.test.js`,
`Tier3RulesPhase2.test.js`, `Tier3RulesPhase3.test.js`,
`DeprecatedTag.test.js`, `NonGetRenderingPage.test.js`,
`InvalidLayout.test.js`). Existing
`error-enricher-bridge.test.js`, `Tier1Rules.test.js`, and
`structural-rule-attribution.test.js` updated to match the
three-subrule shape.

Total rule entries: **86 (vs 47 at 0.6.0)**. Full suite at release:
1802 / 1803 unit pass (the lone failure is a pre-existing
`load_development_guide` drift unrelated to this release); 88 / 88
targeted integration pass.

## 0.6.0 — 2026-04-24

Analytics pipeline overhaul + neuro-symbolic engine rounds out. Headline numbers on the DEMO project between 2026-04-23 and 2026-04-24: fix-proposal rate rose from effectively 0 (the emit loop was reading the wrong field) to 45 / 99 (45%); classified fix adoption rose from 0 to 31; confidence coverage from 0% to 89% of emits; rule performance table from 3 entries at baseline to 30+; health score from 91 to 95/100.

### Fixed — three critical analytics bugs

- **`outcomes.fix_applied` was always null.** The classifier (`classifyFixAdoption`) existed in `window-classifier.js` but no call site. Wired it into `analytics-store.classifyAndStoreWindows()` using `buildEmitIndex` + blobStore content lookup. Start-of-window emit picks the proposed-fix set the agent actually saw; `regressed` / `write_unverified` outcomes skipped (no semantic meaning). `openAnalyticsStore(dbPath, { blobStore })` now accepts the blob store; `server.js` and `scripts/rebuild-analytics.js` pass it through.
- **`hint_md_hash` emitted but dropped on ingest.** No column existed on `diagnostics`. Schema bumped to v5 with `migrate_v4_to_v5` adding the column; ingestion persists the hash; `diagnosticJourney` + `ruleDrilldown` surface it; dashboard code-context panel renders the hint blob alongside the file window.
- **Heuristic fix-generator fixes never reached analytics.** Emit loop read `d.fixes` (rule-engine channel) but the heuristic generator writes to `d.fix` (singular). Unioned both channels; every fix now persisted with its attribution.

### Added — Phases A1–A4 (analytics integrity)

- **A1 — outcome dedup.** `outcomes` table carries UNIQUE(session_id, file, fp); `INSERT OR REPLACE` stamps terminal state as `classifySession` walks windows. Migration `migrate_v1_to_v2` dedups existing rows by MAX(id), drops orphans, adds the index. Resolution > Emit mismatch eliminated.
- **A2 — confidence defaults.** `DEFAULT_CONFIDENCE_BY_SEVERITY = { error: 0.9, warning: 0.7, info: 0.5 }` + `STRUCTURAL_DEFAULT_CONFIDENCE = 0.75`. New pipeline step `populateDefaultConfidence` (step 17) fills any missing confidence and stamps `${check}.unmatched` rule_id fallback. Exported as `stampDefaultsOn(result)` for validate-code to re-run after late structural-warning pushes.
- **A3 — `_source: 'dashboard_live'` untracked gate.** Live Diagnostic Console calls no longer pollute analytics. `tools.js` sets `ctx.untracked = true` on a per-call context copy (restore-in-finally); `validate-code.js` gates `sessionBus.emit('validator_emit', ...)` on `!ctx.untracked`. One-off cleanup script for pre-A3 pollution in `scripts/cleanup-live-console-rows.js`.
- **A4 — rule attribution.** `${check}.unmatched` fallback lands in rule_id when no rule fires. `rulePerformance(store, { minEmitted = 1 })` separate reporting-view query, groups on rule_id including `.unmatched`, exposes `source` and `unmatched` flag. `ruleScores()` stays at minEmitted=5 with `.unmatched` excluded for promotion gating.

### Added — I1 heuristic + rule fix attribution

- Schema v6 + `proposed_fixes.rule_id` column + `idx_fixes_rule` index + `migrate_v5_to_v6`.
- Central stamp in `fix-generator.js`: every heuristic fix tagged `heuristic:<Check>.<fix_type>` in one place (no per-branch boilerplate).
- Emit loop propagates fix-level rule_id with `f.rule_id ?? d.rule_id ?? null` fallback — rule-engine rules attach rule_id to the HintResult rather than each fix, so fixes inherit from the diagnostic.
- New `fixRulePerformance(store, { minProposed = 1 })` query groups on `proposed_fixes.rule_id`, returns `{ rule_id, source, fix_kind, proposed, outcomes, adopted_verbatim, adopted_partial, adoption_rate, resolution_rate }`.
- HTTP endpoint `GET /api/analytics/fix-rule-performance`.

### Added — Part G adaptive-mode impact panel

- `adaptiveModeImpact(store, { windowMs = 86400000 })` returns window-scoped emit counts, rule-matched counts, confidence stats, and an `emits_by_rule` map for counterfactual calculation.
- HTTP `GET /api/engine/impact` merges the query with live engine state (`getDisabledRuleDetails`, force-enable/disable sets) and computes `suppressed_by_disabled` counterfactual.
- Dashboard — new "Adaptive Mode Impact" section in the Engine Map tab: summary stat tiles, disabled-rules table with per-row action buttons, force-enabled / force-disabled chip lists.

### Added — I4 manual rule overrides

- `src/core/rule-overrides.js` module. Persists `.pos-supervisor/rule-overrides.json` (atomic write via temp + rename, tolerant read). API: `loadOverrides`, `saveOverrides`, `addForceEnable`, `addForceDisable`, `removeOverride`, `overrideSets`.
- Engine — `_forceEnabled` and `_forceDisabled` sets. `ruleIsActive()` precedence: `force_disable > force_enable > _disabledRules`. New `isCheckForceDisabled(checkName)` also gates structural / LSP-only checks by name.
- Validate-code filter step drops diagnostics whose `check` or `rule_id` is in the force-disable set — structural checks like `pos-supervisor:HtmlInPage` can be killed without waiting for the auto-disable threshold.
- HTTP `GET` and `POST /api/engine/rule-overrides` with `{ action, rule_id, reason }` where action is `force_enable | force_disable | clear`. `onOverridesChanged` hook refreshes the engine without restart.
- Dashboard — override-add form (input + reason + FE/FD buttons) with HTML5 `<datalist>` autocomplete populated from rule-performance data + derived check names.

### Added — late-push attribution bridge

- `bridgeRulesOntoUnattributed(result, ctx)` in `error-enricher.js`. Runs `runRules` on any diagnostic whose `rule_id` is still unset and whose `check` has a registered rule module. Copies `rule_id`, `hint_md`, `confidence`, `see_also`, `fixes`, `case_base_signal` onto the diagnostic. Idempotent. Rule failures non-fatal.
- Called from `validate-code.js` after all late-push sources (structural warnings, schema/translation validators, diff-aware checks, new-partial caller check) and before `stampDefaultsOn`. Structural `pos-supervisor:*` rules now get their canonical rule_id instead of landing in `<Check>.unmatched`.

### Added — engine-map write-closed windows + draft detection

- `classifyWriteWindow(validateCall, writeEvent)` and `extractWriteEvents(events)` in `window-classifier.js`.
- Schema v4 adds `windows.is_draft` and `windows.closed_by ∈ {'validate','write'}`. Validate-to-validate windows with no intervening disk write are tagged `is_draft = 1` (measures thinking, not effectiveness).
- `fs-watcher.js` emits `rel_path` alongside `path` so the classifier can match writes to validated files.

### Added — Tier 1 rule modules

- `src/core/rules/ImgLazyLoading.js` (rule_id `ImgLazyLoading.recommended`).
- `src/core/rules/ImgWidthAndHeight.js` (rule_id `ImgWidthAndHeight.recommended`).
- `src/core/rules/ConvertIncludeToRender.js` (rule_id `ConvertIncludeToRender.default`).

Each provides attribution + an action-oriented hint. Fix text stays with the heuristic generator (single source of truth on AST position math); the rules return `fixes: []` and rely on the `heuristic:<Check>.text_edit` channel. Registered via `src/core/rules/index.js`.

### Added — new structural checks

- **`pos-supervisor:NonGetRenderingPage`** — warns when a page has `method: post/put/delete/patch` AND renders HTML (layout, partials, `{{ }}` output, or HTML tags present). Catches the agent-confusion pattern of setting `method: post` on landing pages, which makes them 404 on browser GET. Suppressed when slug starts with `/api/`, `/_/`, `/internal/` OR the body has no UI signals (pure JSON/redirect endpoint). Rule module `NonGetRenderingPage.default` + hint file `src/data/hints/pos-supervisor:NonGetRenderingPage.md` with a landing-page vs API-endpoint decision tree.
- **`verifyMissingPartialsOnDisk`** pipeline step — cross-check `MissingPartial` diagnostics against the real filesystem; suppress when the partial exists on disk but the LSP hasn't re-indexed yet (handles scaffold write → re-validate timing race).

### Changed

- **`pos-supervisor:HtmlInPage` guard** — suppress when the page renders at least one partial (composite landing-page pattern). Production showed 100% regression on this rule before the guard.
- **`pos-supervisor:MissingDocBlock` scope** — dropped commands branch (production showed 40% regression on `commands/`; many internal helpers legitimately don't need doc blocks). Partials only now.
- **Validate-code emit loop** — propagates `rule_id` on every fix; unions rule + heuristic fixes; re-runs `stampDefaultsOn` after all late-push sources so confidence / rule_id coverage is complete.

### Added — dashboard features

- **Code-context panel in rule drilldown**: fetches content blob (`GET /api/blob?hash=…`), fix blob, and hint blob in parallel; renders a 40-line window around `fix_range` with the error line highlighted; Proposed fix + Hint blocks below. New `/api/blob` endpoint with 64-hex SHA256 validation.
- **Journey timeline clickable nodes**: click a session dot to open the same code-context panel inline.
- **Confidence column** in the rule-drilldown samples table, color-coded (≥0.8 green, ≥0.5 yellow, else red; `n/a` muted).
- **Live-console file picker** stays in sync with validation SSE activity (`addToLivePickerFiles` / `removeFromLivePickerFiles`) — no longer requires an Explorer tab refresh to see newly-validated files.

### Added — scripts

- **`scripts/rebuild-analytics.js`** — rebuild the analytics DB from session event logs. Injects the blob store so fix-adoption classification runs on replay.
- **`scripts/cleanup-live-console-rows.js`** — one-off purge of pre-A3 `__pos_live_console__` rows from events/diagnostics/outcomes/windows/proposed_fixes.

### Added — tests

New unit test files:

- `tests/unit/error-enricher-bridge.test.js` — 6 cases covering bridge idempotency, no-rule-module no-op, missing fact-graph no-op, errors/warnings/infos, rule-throws non-fatal.
- `tests/unit/rule-overrides.test.js` — 7 cases: round-trip, malformed JSON, mutual exclusion.
- `tests/unit/rule-engine-overrides.test.js` — 7 cases: force precedence, check-name gating, engine-state reset.
- `tests/unit/rules/Tier1Rules.test.js` — 4 rule-module tests (ImgLazy, ImgW&H, ConvertInclude, NonGetRenderingPage).

Extended unit files: `analytics-store.test.js`, `analytics-queries.test.js`, `analytics-queries-k.test.js`, `diagnostic-pipeline.test.js`, `structural-warnings.test.js`, `window-classifier.test.js`, `case-base.test.js`.

New integration tests in `tests/integration/analytics/`:

- `untracked.test.js` — A3 gate.
- `fix-rule-attribution.test.js` — I1 follow-up rule-engine inheritance.
- `force-disable-check.test.js` — I4 override semantics end-to-end (POST + clear).
- `structural-rule-attribution.test.js` — bridge end-to-end (NonGetRenderingPage lands as `.default`, not `.unmatched`).

**Suite totals: 1635 unit + 25 analytics/http/workflows integration, all green.**

### Changed — plan doc

- `docs/new-task/implementation-plan.md` — new "Addendum — 2026-04-23" section: I1 (heuristic rule attribution), I2 (see_also_followed outcome), I3 (soak fresh data), I4 (manual rule re-enable + dashboard visibility). Revised short-term order with Part G + I4 bumped up.

### Migrations

DB schema: **v1 → v6** via five numbered, idempotent steps. No backfills write data — only reshape tables. A `store.rebuild(sessionsDir)` against the existing event log repopulates the new columns.

- **v1 → v2**: dedup outcomes + add UNIQUE(session, file, fp) index + add `session_id` / `file` columns + backfill from windows.
- **v2 → v3**: dedup diagnostics + add UNIQUE(session, file, fp) index.
- **v3 → v4**: add `windows.is_draft` + `windows.closed_by`.
- **v4 → v5**: add `diagnostics.hint_md_hash`.
- **v5 → v6**: add `proposed_fixes.rule_id` + `idx_fixes_rule`.

### Upgrade notes

1. `pkill -f bin/pos-supervisor.js && bun bin/pos-supervisor.js` — new schema migrations run on first open.
2. Optional: `bun scripts/rebuild-analytics.js /path/to/project` — replays the event log into the new columns so historical sessions gain confidence / hint_md_hash / fix rule_id attribution.
3. Optional: `bun scripts/cleanup-live-console-rows.js /path/to/project` — purge pre-A3 live-console pollution if the DB predates this release.

## 0.5.2

### Added

- **Dashboard POS-CLI tab**: New tab in the HTTP dashboard for executing pos-cli commands against project environments.
  - **Data Clean** — runs `pos-cli data clean --auto-confirm --include-schema <env>` with caution warning about permanent data deletion.
  - **Deploy** — runs `pos-cli deploy <env>` with caution warning about remote file overwrite.
  - Environment selector populated from `.pos` file (parsed with js-yaml, matching project-scanner behavior).
  - Live command preview updates on environment change.
  - Result banner with success/failure status, duration, and full command output.
  - New HTTP endpoints: `GET /api/pos-cli/envs`, `POST /api/pos-cli/data-clean`, `POST /api/pos-cli/deploy`.

## 0.5.1

### Added

- **Schema property validation in `validate_code`**: GraphQL files (`.graphql`) are now checked against schema definitions. Two new check types:
  - `pos-supervisor:UnknownSchemaProperty` — warns when `property(name: "X")` or `{ name: "X", value: ... }` references a property not defined in the schema.
  - `pos-supervisor:SchemaPropertyTypeMismatch` — warns when the accessor or value key doesn't match the property's schema type (e.g. `property_int(name: "title")` when `title` is a `string`).
  - Table resolution: extracts `table:` from content, falls back to path-based resolution (`app/graphql/blog_posts/` -> `blog_post`). Skips `modules/`-prefixed tables and built-in fields (`id`, `created_at`, `updated_at`, `deleted_at`, `table`, `type`).

- **Dashboard Project Explorer**: Three new tabs added to the HTTP dashboard:
  - **Explorer** — vertical slice view of each resource (schema properties, GraphQL operations, business logic commands/queries, page routes), with summary stat cards and missing-operation alerts.
  - **Routes** — request flow trace showing every page route with HTTP method badges and the function calls each route triggers.
  - **Health** — project health dashboard with total errors/warnings/files scanned, recommended next step, fix order priority list, dead code listing, integrity issues, blocking files, diff from last run, and modules & assets overview.
  - All tabs lazy-load data via existing `/call` endpoint (project_map + analyze_project tools) and include a Refresh button. Matches existing dashboard dark theme — no external dependencies, no framework, vanilla JS.

- `src/core/schema-property-checker.js` — new module: `checkSchemaProperties(content, filePath, projectDir)`, `extractTableNames`, `resolveTableFromPath`, `loadSchemas`.

- `tests/unit/schema-property-checker.test.js` — 37 tests covering table extraction, path-based resolution, schema loading, accessor checks, mutation value-key checks, edge cases, and zero false-positive verification against all fixture GraphQL files.

## 0.5.0

### Fixed

- **Scaffold 403 on form save — broken authorization**: `can_do_or_unauthorized` checks `requester.roles` against `role_permissions/permissions` which only registers built-in actions (session/user/oauth/admin) — NOT custom resource actions like `posts.create`. Every authenticated non-superadmin got 403 on scaffold-generated create/update/delete pages. Replaced with inline `context.current_user.id == null → response_status 403 → break` guard that works for all authenticated users without requiring role_permissions registry entries.

- **Scaffold no ownership filtering**: Search queries returned all records regardless of user. GraphQL `search` now accepts an owner-field parameter (e.g. `$user_id: String!`) with a `properties` filter; Liquid wrapper passes `context.current_user.id` and returns an empty result set for anonymous callers. Show/update/delete pages verify ownership after fetching the record — non-owners get 404.

- **Scaffold owner field exposed in forms**: Fields like `user_id` were rendered as editable form inputs, allowing any user to spoof ownership by submitting an arbitrary ID. Owner fields (with `role: auth`) are now excluded from form partials.

- **Auto-upgrade of canonical owner fields**: When `include_authorization: true`, properties named `user_id`, `owner_id`, `author_id`, or `created_by` are automatically promoted to `role: auth`. This ensures the ownership pipeline activates even when the agent omits `role: auth` on the owner field. Agents can opt out by using a non-canonical name.

- **Scaffold emitting undeployable files when `properties` omitted**: Calling `scaffold` with `type: crud|api|command` and no `properties` array silently produced broken files: `app/graphql/<plural>/create.graphql` contained `mutation create()` (GraphQL parse error at `[1, 17]`), `app/schema/<name>.yml` had an empty properties list (platformOS schema validation failure), and `create/build.liquid` + `create/check.liquid` had no assignments or validations. Fixed by rejecting these scaffold types at the entry point with an actionable error message listing a concrete `properties:` example, and by adding defense-in-depth guards inside `schemaYml`, `createGql`, `updateGql`, `createBuildCmd`, and `createCheckCmd` that throw if a generator is ever reached with zero non-auth properties. `query`, `partial`, and `page` continue to accept zero properties since none of their templates would produce invalid output.

- **`MetadataParamsCheck` false positives on module partial calls**: Errors like "Required parameter autohide must be passed" on `{% theme_render_rc 'modules/common-styling/toasts' %}` were surfaced as real errors despite `modules/*` being listed in `.platformos-check.yml` `ignore`. Root cause: the ignore rule excludes module *files* from linting, but `MetadataParamsCheck` fires on the *calling* app file — so the ignore rule never applied. Added `suppressModuleTargetParams` as step 5 in the diagnostic pipeline: for each `MetadataParamsCheck` error, the source line is inspected; if it contains a `modules/` path the error is suppressed and replaced with an info diagnostic explaining the root cause. This unblocks layouts and pages using `common-styling/toasts`, `user/helpers/can_do_or_unauthorized`, and `core/validations/presence` without requiring changes to module source files.

- **MissingPage ghost errors**: `validate_code` on a header partial linking to `/`, `/notes`, `/dashboard` triggered MissingPage for each link even though those pages exist in other files. Added `page-route-index.js` which walks `app/views/pages/` once, builds a `Map<route, Set<method>>`, and the diagnostic pipeline cross-checks reported routes against this truth. MissingPage is suppressed when the route + method exist on disk; wrong-method cases get a `.hint` explaining which methods are served.

- **Scaffold workflow contradiction**: Scaffold's dry-run `next_step` said "MUST call validate_intent before writing" while the tool itself supports `write: true`. Reframed: `scaffold(write: true)` is the default single-shot path; `validate_intent` is optional for review of dry-run output only.

### Changed

- **Canonical workflow rewrite**: The shared `CANONICAL_WORKFLOW_BLOCK` (used by scaffold and validate_intent descriptions) now defines two tracks: Track A for scaffold-generated files (preferred, single-shot `write: true`) and Track B for hand-drafted files (validate_intent required, then validate_code per file). `validate_intent` on scaffold output is explicitly labeled OPTIONAL.

- **Tool descriptions clarified**: `validate_code` description now specifies when it IS and IS NOT required (not needed after scaffold write:true; required for hand-drafted and manually-edited files). `validate_intent` mode 1 reframed as optional scaffold review, mode 2 as required for manual plans.

- **`load_development_guide` moved to tool registry**: Previously registered directly on McpServer (bypassing the registry). Now a standard tool in `src/tools/load-development-guide.js`, visible in the dashboard, HTTP `/tools`, and playground.

- **Development guide updated**: Section 0 mandatory workflow rewritten to match the new canonical workflow — scaffold(write:true) is the default path, validate_intent is optional for scaffold.

- Diagnostic pipeline extended from 9 to 10 steps. New step 5 (`suppressModuleTargetParams`) inserts after `deduplicateArgChecks` and before `suppressModuleHelpers`.

### Added

- **`src/core/page-route-index.js`**: Builds a route index from `app/views/pages/` for MissingPage suppression. Exports `buildPageRouteIndex`, `normalizeRoute`, `parseMissingPageMessage`, `resolvePageRoute`.

- `tests/unit/page-route-index.test.js` — 19 tests covering path-derived routes, frontmatter slug overrides, index collapse, multi-method merge, non-liquid skip, and message parsing.

- `tests/unit/diagnostic-pipeline.test.js` — extended with `verifyPageRoutesOnDisk` tests (6 cases: multi-page suppression, wrong-method hint enrichment, genuine miss passthrough, missing-projectDir bypass, pendingPages coexistence) and `suppressModuleTargetParams` tests.

- **Scaffold improvements**: `scaffold` tool now generates correct HTML structure using design system classes:
  - Index partial uses `feature-grid` / `card` layout instead of phantom `pos-table` / `pos-table-content` classes that have no CSS definition in common-styling
  - "New" button on index partial is auth-gated (`{% if context.current_user.id %}`)
  - Edit/delete buttons on index partial are ownership-gated using the schema's auth-role field (e.g. `{% if context.current_user.id == item.author_id %}`)
  - Show partial displays the record's title/name field as an `<h1 class="pos-heading-1">` instead of `{{ object.id }}`
  - New/edit partials use `col-8` centered wrapper with `pos-heading-1` heading
  - Edit partial no longer appends `{{ object.name }}` to the heading (most models have no `.name` field)
  - `error_input_handler` and `error_list` calls now include the required `name:` param — fixes broken ARIA `aria-describedby` linkage and eliminates real `MetadataParamsCheck` errors on scaffold output
  - Form submit button uses a translation key (`app.{plural}.save`) instead of hardcoded "Submit"
  - Form includes a cancel link using `app.{plural}.cancel` translation key
  - Empty state partial now includes `{% doc %}` block and auth-gates the "New" CTA
  - Translation file now includes `save`, `cancel`, and `list.delete` keys

- **Design system reference docs**: Added `src/data/references/design-system/common-styling-migration.md` — coexistence guide for projects using both `modules/common-styling` and the custom CSS design system. Covers load order, which common-styling classes to keep, design system layout classes, the accepted inline-style exception for flex containers, the header partial pattern with correct auth URLs, and the toasts linter noise note.

- **Improvement roadmap and dashboard concepts**: Added `docs/improvement-roadmap.md` (10 actionable items from blog evaluation session) and `docs/dashboard-concepts.md` (9 creative dashboard concepts including live dependency health graph, session cockpit, false positive manager, translation coverage heatmap, scaffold approval flow, loop detector, deploy pipeline panel, agent replay, and module inspector).

## 0.4.0

### Fixed

- **`validate_code` hiding TranslationKeyExists errors**: The diagnostic pipeline was unconditionally downgrading all `TranslationKeyExists` diagnostics from errors to infos (with an "advisory" message). Files with missing translation keys reported `status: ok`, masking real issues that `pos-cli check` and `analyze_project` would catch. Removed `downgradeTranslationKeys` entirely — `TranslationKeyExists` is now always surfaced as an error.

- **`validate_code` mode-inconsistent MissingPartial behavior**: `downgradePreWrite` was converting `MissingPartial` from error to warning only in `mode: 'full'` + `isPreWrite: true`, causing different `status` values for the same file content depending on mode. Removed `downgradePreWrite` entirely — `MissingPartial` is now consistently an error in all modes. Use `pending_files` (from `validate_intent`) to suppress cross-file false positives during multi-file creation.

- **`validate_intent` scaffold track returning empty `pending_translations`**: When given scaffold output, `validate_intent` always returned `pending_translations: []` because the scaffold normalizer discarded file content before translation keys could be extracted. CRUD scaffold workflows would then call `validate_code` with no pending translations, triggering `TranslationKeyExists` errors on every file that used scaffold-generated translation keys. Fixed by adding `extractScaffoldTranslationKeys` which parses scaffold translation YML files and flattens keys to dot-notation (stripping the locale prefix), so `pending_translations` is correctly populated for scaffold-based workflows.

- **LSP contract test for MissingPartial severity**: The contract test "severity is warning (2)" was not testing the LSP's native severity — it was testing the `downgradePreWrite` pipeline behavior. MissingPartial is an error (`DiagnosticSeverity.Error = 1`) from the LSP. Updated test to check `result.errors` and renamed to "severity is error (1) from LSP".

### Changed

- Diagnostic pipeline reduced from 11 to 9 steps. The `isPreWrite` and `mode` options are no longer consumed by `runDiagnosticPipeline` (both were only used by the removed steps).

## 0.3.0

### Fixed

- **Shopify object detection**: `pos-supervisor:ShopifyObject` structural warnings now include a `suggestion` field with Shopify-specific replacement guidance (e.g. "`cart` is a Shopify object. Use: `context.session`"). Previously only the enricher path via `UndefinedObject` provided suggestions; structural warnings had `message` only.
- **UndefinedObject enrichment test**: Updated to include `{% doc %}` block, matching upstream behavior change in `@platformos/platformos-check-common@0.0.17` where `UndefinedObject` is only reported for partials that declare expected params.
- **Performance test threshold**: `validate_code` quick mode threshold raised from 3s to 5s to reduce flakiness in CI/slower environments.

### Added

- **Upstream contract test suite** (`tests/upstream/`): 103 tests across 4 files that pin the behavior of upstream dependencies and detect regressions or opportunities when they change.
  - `parser-contract.test.js` — verifies `@platformos/liquid-html-parser` API surface (NodeTypes, NamedTags, AST shapes).
  - `data-contract.test.js` — verifies pos-cli bundled data file structures (objects.json, filters.json, tags.json, graphql.graphql).
  - `lsp-diagnostic-contract.test.js` — pins LSP check behavior (which checks fire for which inputs, message formats, severities). Would have caught the `UndefinedObject` behavior change immediately.
  - `lsp-coverage-map.test.js` — detects when the LSP starts covering checks that pos-supervisor handles via structural warnings, logging overlap opportunities.

### Breaking Changes

- **MCP SDK migration**: Replaced hand-rolled JSON-RPC stdio server with the official `@modelcontextprotocol/sdk`. The stdio transport now uses `McpServer` + `StdioServerTransport` from the SDK. Clients must send `notifications/initialized` after `initialize` per the MCP protocol spec.
- **HTTP `/mcp` endpoint removed**: MCP protocol is now handled exclusively via stdio (SDK transport). HTTP server retains REST endpoints (`/health`, `/tools`, `/call`, `/resources`, `/resources/read`).
- **Input validation via Zod**: Tool input schemas are now defined with Zod. Missing required parameters are caught at the protocol level by the SDK before reaching tool handlers. Error format for invalid inputs may differ from previous versions.

### Added

- `@modelcontextprotocol/sdk` and `zod` as dependencies.
- Tool annotations support via `McpServer.registerTool()`.
- Resources registered on McpServer for stdio consumers (previously only available via HTTP).
- `GET /resources` endpoint on HTTP server.
- `POST /resources/read` endpoint on HTTP server.
- Version number sourced from `package.json` for server identification.

### Changed

- **Tool descriptions**: Converted from `[...].join('\n')` arrays to template literal strings for readability.
- **Tool input schemas**: Converted from raw JSON Schema objects to Zod shapes. The registry converts them to JSON Schema for HTTP consumers via `zod-to-json-schema`.
- **Architecture**: `tools.js` now accepts an optional `McpServer` parameter in `createToolRegistry()`. When provided, tools are registered on both the internal Map registry (for HTTP) and the McpServer (for stdio).
- Session tracking bug fix: `validatedFiles.add()` now conditional on `result?.status === 'ok'` (was unconditional).
- `null` param guidance: All 4 knowledge.json entries that said "null/nil is compatible with any type" replaced with strict "NEVER pass null — use matching empty value" guidance, aligned with MetadataParamsCheck.md.
- `LiquidHTMLSyntaxError.md`: Replaced deprecated `parse_json` workaround with modern `{% assign %}` hash/array literal syntax.

### Removed

- `src/stdio-server.js` — replaced by SDK's `StdioServerTransport`.
- Dead export `getDomainFromPath` from `src/core/utils.js` (the one in `domain-detector.js` is used everywhere).
- 2 failing tests in `lsp-stale-diagnostics.test.js` that expected pre-barrier diagnostics to be stored (implementation correctly discards them).

## 0.2.0

- Initial public release with validate_code, enrich_error, domain_guide, analyze_project, lookup, server_status, project_map, scaffold, module_info, validate_intent tools.
- Hand-rolled JSON-RPC stdio and HTTP transports.
- LSP integration with pos-cli.
- Session tracking and plan enforcement.
