# Changelog

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
