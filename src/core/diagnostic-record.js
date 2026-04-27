/**
 * DiagnosticRecord — typed, fingerprinted, projection-friendly representation
 * of one warning or error from the LSP / structural / symbolic layer.
 *
 * Why this exists (roadmap §3.1, gap #3 + #4):
 *   - Today every consumer (error-enricher, fix-generator, analyze-project)
 *     re-parses the human-readable LSP `message` with its own regex to pull
 *     out a partial name / variable name / translation key. Those regexes
 *     drift, the boundary explodes whenever the LSP message format shifts,
 *     and analytics has no stable identity to track resolution across calls.
 *   - DiagnosticRecord builds the structured form ONCE at the layer that
 *     produced the diagnostic. Downstream code reads `diag.params.partial`
 *     instead of grepping a string. Fingerprints (`fp`, `template_fp`) give
 *     the analytics layer stable identifiers.
 *
 * Stability contract:
 *   - `template_fp = sha1(check + ":" + messageTemplate)` — same across files,
 *     locales, and instances. Used for "how often does this *kind* of error
 *     fire?" cross-file analytics.
 *   - `fp = sha1(check + ":" + file + ":" + messageTemplate)` — same record
 *     across calls if the file/check/template don't change. Used to detect
 *     "has this exact diagnostic been resolved?" between consecutive
 *     validate_code calls.
 *   - Both EXCLUDE position fields. A page edit that shifts a diagnostic from
 *     line 12 to line 14 is still the same diagnostic; the fingerprint must
 *     not flip.
 *   - Pinning test: tests/upstream/diagnostic-fingerprint.test.js. If you
 *     change the masking algorithm or the param extractor for a check,
 *     the pin will scream — that's intentional, the schema bumps.
 */

import { createHash } from 'node:crypto';

export const DIAGNOSTIC_RECORD_VERSION = 1;

/**
 * Build a DiagnosticRecord from a raw diagnostic produced by the LSP, the
 * structural-warnings layer, or a future symbolic-rule engine.
 *
 * @param {object} raw          - { check, severity, message, line, column, end_line?, end_character? }
 * @param {object} opts
 * @param {string} opts.file    - Project-relative path (NOT a file:// uri).
 * @param {'lsp'|'structural'|'symbolic'} opts.source
 * @param {object} [opts.origin] - { check_runner_version?, lsp_version? }
 * @returns {object} frozen DiagnosticRecord
 */
export function makeDiagnosticRecord(raw, { file, source, origin = {} } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('makeDiagnosticRecord: raw diagnostic required');
  }
  if (!raw.check) throw new Error('makeDiagnosticRecord: raw.check required');
  if (!file) throw new Error('makeDiagnosticRecord: file required');
  if (!source) throw new Error('makeDiagnosticRecord: source required');

  const message = typeof raw.message === 'string' ? raw.message : '';
  const messageTemplate = templateOf(raw.check, message);
  const params = extractParams(raw.check, message);

  const position = {
    line: numberOr(raw.line, 0),
    character: numberOr(raw.column, 0),
    end_line: numberOr(raw.end_line, numberOr(raw.line, 0)),
    end_character: numberOr(raw.end_character, numberOr(raw.column, 0)),
  };

  return Object.freeze({
    v: DIAGNOSTIC_RECORD_VERSION,
    fp: fingerprint(raw.check, file, messageTemplate),
    template_fp: templateFingerprint(raw.check, messageTemplate),
    check: raw.check,
    severity: normalizeSeverity(raw.severity),
    file,
    position: Object.freeze(position),
    message,
    message_template: messageTemplate,
    params: Object.freeze(params),
    source,
    origin: Object.freeze({
      check_runner_version: origin.check_runner_version ?? null,
      lsp_version: origin.lsp_version ?? null,
    }),
  });
}

// ── Fingerprint helpers ──────────────────────────────────────────────────────

export function fingerprint(check, file, messageTemplate) {
  return sha1(`${check}:${file}:${messageTemplate}`);
}

export function templateFingerprint(check, messageTemplate) {
  return sha1(`${check}:${messageTemplate}`);
}

function sha1(input) {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}

// ── Message template (identifier mask) ───────────────────────────────────────
//
// Goal: two diagnostics with the same SHAPE but different identifiers (file
// names, variable names, translation keys) collapse to the same template
// string. The mask is intentionally minimal — we replace only the things
// that vary across instances of the same check, never things that
// discriminate distinct check shapes.
//
// Substitutions, in order:
//   1. Quoted identifiers ('x', "x", `x`)            → <id>
//   2. Bare ASCII numbers (12, 0xff, 1.5)            → <n>
//   3. Run-of-whitespace                             → single space
//   4. Trim leading/trailing whitespace
//
// We do NOT lowercase — case can be load-bearing in some checks.

export function messageTemplate(message) {
  if (typeof message !== 'string' || message === '') return '';
  let out = message;
  // Quoted strings (single, double, backtick). Greedy stops at the next
  // matching quote without crossing newlines so multi-message blobs survive.
  out = out.replace(/`([^`\n]*)`/g, '<id>');
  out = out.replace(/'([^'\n]*)'/g, '<id>');
  out = out.replace(/"([^"\n]*)"/g, '<id>');
  // Bare numbers (decimal, hex, float). Word-boundary anchored so we don't
  // chew "v1" → "v<n>" or "html5" → "html<n>".
  out = out.replace(/\b\d+(?:\.\d+)?\b/g, '<n>');
  out = out.replace(/\b0x[0-9a-fA-F]+\b/g, '<n>');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// Per-check template override hook. Today the generic mask is sufficient for
// every check we ship. If a check's message format ever requires a custom
// mask (e.g. the LSP starts emitting timestamps inside the message), wire it
// here rather than hard-coding inside the generic mask.
const TEMPLATE_OVERRIDES = Object.freeze({
  // Example shape — keep commented as a contract for future authors:
  // 'GraphQLCheck': (msg) => msg.replace(/at line \d+/, 'at line <n>'),
});

export function templateOf(check, message) {
  const override = TEMPLATE_OVERRIDES[check];
  return override ? override(messageTemplate(message)) : messageTemplate(message);
}

// ── Param extraction (typed, per check) ──────────────────────────────────────
//
// Each extractor returns a flat string-keyed object. The `params` field on
// DiagnosticRecord is the contract downstream consumers code against —
// changes here are observable to enrichers, fix generators, and analytics.

const QUOTED = /[`'"]([^`'"]+)[`'"]/;

function firstQuoted(message) {
  const m = message.match(QUOTED);
  return m ? m[1] : null;
}

function pairQuoted(message) {
  // Two distinct quoted spans, in order of appearance.
  const bt = message.match(/`([^`]+)`[^`]*`([^`]+)`/);
  const dq = message.match(/"([^"]+)"[^"]*"([^"]+)"/);
  const sq = message.match(/'([^']+)'[^']*'([^']+)'/);
  const m = bt || dq || sq;
  return m ? [m[1], m[2]] : null;
}

const EXTRACTORS = Object.freeze({
  UnknownFilter(message) {
    const filter = firstQuoted(message);
    return filter ? { filter } : {};
  },

  UndefinedObject(message) {
    // LSP message: "The object 'foo' is undefined". Earlier the codebase
    // used a dedicated extractVarName regex; we keep the same first-quoted
    // contract so existing tests pass without touching the enricher yet.
    const variable = firstQuoted(message);
    return variable ? { variable } : {};
  },

  UnusedAssign(message) {
    const variable = firstQuoted(message);
    return variable ? { variable } : {};
  },

  MissingPartial(message) {
    const partial = firstQuoted(message);
    return partial ? { partial } : {};
  },

  TranslationKeyExists(message) {
    const key = firstQuoted(message);
    if (!key) return {};
    const params = { key };
    if (/did you mean/i.test(message)) params.has_typo_suggestion = 'true';
    return params;
  },

  UnknownProperty(message) {
    const pair = pairQuoted(message);
    if (!pair) return {};
    return { property: pair[0], object: pair[1] };
  },

  DeprecatedTag(message) {
    // Tag is the first identifier; replacement (when present) follows
    // "replaced by" or "use".
    const tag = (message.match(/[`'"](\w+)[`'"]/) || message.match(/\btag\s+[`'"]?(\w+)[`'"]?/i) || [])[1] ?? null;
    const replMatch = message.match(/replaced\s+by\s+\[?[`'"](\w+)[`'"]\]?/i)
      || message.match(/\buse\s+[`'"](\w+)[`'"]/i);
    const replacement = replMatch ? replMatch[1] : (tag === 'include' ? 'render' : null);
    const params = {};
    if (tag) params.tag = tag;
    if (replacement) params.replacement = replacement;
    return params;
  },

  MissingRenderPartialArguments(message) {
    const partialMatch = message.match(/[`'"]([^`'"]+\/[^`'"]+)[`'"]/);
    const paramMatch = message.match(/\bargument\s+['"`](\w+)['"`]/i);
    const params = {};
    if (partialMatch) params.partial = partialMatch[1];
    if (paramMatch) params.missing_param = paramMatch[1];
    return params;
  },

  MetadataParamsCheck(message) {
    return { is_function_call: /function call/i.test(message) ? 'true' : 'false' };
  },

  ValidFrontmatter(message) {
    // pos-cli 6.0.7 ships a single check that emits eight distinct shapes.
    // We classify into a `category` so the rule engine can route to a
    // category-specific hint without re-parsing the message itself.
    //
    // Categories:
    //   home_deprecated, missing_required, unknown_field, deprecated_field,
    //   invalid_enum, layout_false, layout_missing, association_missing,
    //   unknown (fallback — surfaces as `.unmatched` if it ever fires).
    if (/'home\.html\.liquid' is deprecated/i.test(message)) {
      return { category: 'home_deprecated' };
    }
    let m = message.match(/^Missing required frontmatter field [`'"]([^`'"]+)[`'"] in (.+?) file$/);
    if (m) return { category: 'missing_required', field: m[1], file_type: m[2] };
    m = message.match(/^Unknown frontmatter field [`'"]([^`'"]+)[`'"] in (.+?) file$/);
    if (m) return { category: 'unknown_field', field: m[1], file_type: m[2] };
    if (/^`layout: false`/.test(message)) return { category: 'layout_false' };
    m = message.match(/^Layout [`'"]([^`'"]+)[`'"] does not exist$/);
    if (m) return { category: 'layout_missing', layout: m[1] };
    m = message.match(/^Invalid value [`'"]([^`'"]+)[`'"] for [`'"]([^`'"]+)[`'"]\. Must be one of: (.+)$/);
    if (m) return { category: 'invalid_enum', value: m[1], field: m[2], allowed: m[3] };
    m = message.match(/^[`'"]([^`'"]+)[`'"] is deprecated/);
    if (m) return { category: 'deprecated_field', field: m[1] };
    if (/deprecated/i.test(message)) {
      // Custom deprecation messages from per-field schemas — extract the first
      // quoted token as a best-effort field hint.
      const f = firstQuoted(message);
      return f ? { category: 'deprecated_field', field: f } : { category: 'deprecated_field' };
    }
    m = message.match(/^(.+?) [`'"]([^`'"]+)[`'"] does not exist$/);
    if (m) return { category: 'association_missing', label: m[1], name: m[2] };
    return { category: 'unknown' };
  },

  JsonLiteralQuoteStyle(_message) {
    // Single-shot message — no params extracted. The category is implicit
    // (always "single quote inside JSON literal"). Returning {} keeps the
    // bag JSON-safe and lets the rule engine fire on `check` alone.
    return {};
  },

  DuplicateFunctionArguments(message) {
    // "Duplicate argument 'x' in render tag for partial 'p'."
    // "Duplicate argument 'x' in function tag for partial 'p'."
    const m = message.match(/^Duplicate argument [`'"]([^`'"]+)[`'"] in (\w+) tag for partial [`'"]([^`'"]+)[`'"]\.?$/);
    if (m) return { argument: m[1], tag_kind: m[2], partial: m[3] };
    return {};
  },

  GraphQLCheck(message) {
    const unused = message.match(/Variable\s+["']?\$(\w+)["']?\s+is never used/i);
    if (unused) return { category: 'unused_variable', variable: unused[1] };

    const fieldMatch = message.match(/Cannot query field\s+["']?(\w+)["']?\s+on type\s+["']?(\w+)["']?/i);
    if (fieldMatch) {
      return {
        category: fieldMatch[2] === 'Record' ? 'unknown_field_record' : 'unknown_field_other',
        field: fieldMatch[1],
        type: fieldMatch[2],
      };
    }

    const typeMismatch = message.match(/Variable\s+["']?\$(\w+)["']?\s+of type\s+["']?([^"']+)["']?\s+used in position expecting(?: type)?\s+["']?([^"'.]+)["']?/i);
    if (typeMismatch) {
      const expected = typeMismatch[3].trim();
      return {
        category: /filter/i.test(expected) ? 'type_mismatch_filter' : 'type_mismatch_other',
        variable: typeMismatch[1],
        actual_type: typeMismatch[2],
        expected_type: expected,
      };
    }

    const filterMatch = message.match(/Expected value of type\s+["']?(\w+)["']?,?\s+found\s+["']?([^"'.]+)["']?/i);
    if (filterMatch) {
      return {
        category: /filter/i.test(filterMatch[1]) ? 'type_mismatch_filter' : 'type_mismatch_other',
        actual_type: `"${filterMatch[2].trim()}"`,
        expected_type: filterMatch[1],
      };
    }

    return { category: 'generic' };
  },
});

export function extractParams(check, message) {
  const fn = EXTRACTORS[check];
  if (!fn) return {};
  try {
    const out = fn(message ?? '');
    // Defensive: stringify everything so the params bag is JSON-safe and the
    // analytics SQL layer (Phase B) can index without column-type drift.
    const safe = {};
    for (const [k, v] of Object.entries(out)) {
      if (v == null) continue;
      safe[k] = typeof v === 'string' ? v : String(v);
    }
    return safe;
  } catch {
    return {};
  }
}

export const KNOWN_EXTRACTOR_CHECKS = Object.freeze(Object.keys(EXTRACTORS));

// ── Internal helpers ─────────────────────────────────────────────────────────

function numberOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

function normalizeSeverity(s) {
  if (s === 'error' || s === 'warning' || s === 'info') return s;
  // LSP DiagnosticSeverity codes (1-4) sometimes leak through.
  if (s === 1) return 'error';
  if (s === 2) return 'warning';
  if (s === 3 || s === 4) return 'info';
  return 'warning';
}
