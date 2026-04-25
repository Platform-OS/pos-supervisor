/**
 * Named constants — single source of truth for magic numbers used across modules.
 *
 * Only includes values that affect tool behavior (timeouts, thresholds).
 * Presentation limits (slice sizes for previews) stay local to their call sites.
 */

// ── Timeouts ────────────────────────────────────────────────────────────────

/** How long to wait for LSP to be ready (initialization + warm-up). */
export const LSP_READY_TIMEOUT_MS = 30_000;

/** How long to wait for per-document LSP diagnostics. */
export const LSP_DIAGNOSTICS_TIMEOUT_MS = 5_000;

/** Cap on the barrier wait within awaitDiagnostics. */
export const LSP_BARRIER_TIMEOUT_MS = 3_000;

/** How long to wait for pos-cli check subprocess. */
export const CHECK_TIMEOUT_MS = 60_000;

/** Time to wait for diagnostics to settle before resolving. */
export const DIAGNOSTICS_SETTLE_MS = 500;

/** TTL for the project_map cache before a fresh scan is triggered. */
export const PROJECT_MAP_CACHE_TTL_MS = 30_000;

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Max character distance for fuzzy position matching in AST lookups. */
export const POSITION_FUZZY_TOLERANCE = 3;

/** Max Levenshtein distance for "did you mean?" filter suggestions. */
export const FILTER_MATCH_MAX_DISTANCE = 2;

/** After this many consecutive non-decreasing error counts, warn the agent. */
export const CONSECUTIVE_ERROR_THRESHOLD = 3;

// ── Confidence defaults ─────────────────────────────────────────────────────

/**
 * Default confidence for a diagnostic when the rule engine did not set one.
 *
 * These are coarse priors: errors are high-confidence (the linter is usually
 * right about real bugs), warnings are mid-confidence (more stylistic / context
 * dependent), infos are low-confidence (advisory).
 *
 * A populated confidence — even a default — lets confidenceCalibration bucket
 * every diagnostic instead of silently dropping ones where no rule matched.
 * Case-base scoring can still override for rule-matched diagnostics.
 */
export const DEFAULT_CONFIDENCE_BY_SEVERITY = {
  error:   0.9,
  warning: 0.7,
  info:    0.5,
};

/**
 * Default confidence for pos-supervisor structural warnings (check names
 * prefixed with `pos-supervisor:`). These are AST-derived, not LSP-derived,
 * and are more deterministic than severity alone suggests — they only fire
 * when the structural rule is actually hit.
 */
export const STRUCTURAL_DEFAULT_CONFIDENCE = 0.75;

// ── Limits ──────────────────────────────────────────────────────────────────

/** Max subprocess output buffer (pos-cli check). */
export const CHECK_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/** Max HTTP request body size. */
export const HTTP_MAX_BODY = 2 * 1024 * 1024; // 2 MB
