/**
 * Diagnostic post-processing pipeline.
 *
 * Extracted from validate-code.js for testability and clear ordering.
 * Each filter is a named function that mutates result.{errors, warnings, infos}
 * and is documented with its purpose and ordering dependencies.
 *
 * ORDERING CONTRACT:
 *   0a. suppressLspKnownFalsePositives — must run FIRST (after raw user suppressions) so
 *       downstream enrichment, fix generation, and the must_fix_before_write gate
 *       never see the spurious LSP error. Currently covers the pos-cli LSP
 *       "Syntax is not supported" regression on `assign x = a <op> b`.
 *   1. suppressDocParams               — must run before Shopify elevation (doc params may look like Shopify objects)
 *   2. suppressUnusedDocParams         — depends on content, independent of other filters
 *   3. elevateShopify                  — must run after enrichment (needs .suggestion field)
 *   4. deduplicateArgChecks            — must run after linting (needs MissingRenderPartialArguments + MetadataParamsCheck)
 *   5. suppressUndocumentedTargetParams — must run after deduplicateArgChecks (only suppress what wasn't already removed)
 *   6. suppressRequiredParamsWithDefault — must run after 5 (the two cover disjoint cases, but 5 may remove diagnostics we would otherwise re-process)
 *   7. suppressModuleHelpers           — independent
 *   8. suppressOrphanedPartial         — independent
 *   9. suppressByPending (files)       — MissingPartial for files being created in the same plan
 *  10. suppressByPending (pages)       — MissingPage for pages being created in the same plan
 *  11. suppressByPending (translations)— TranslationKeyExists for keys being created in the same plan
 *  12. verifyMissingAssets             — independent (filesystem check)
 *  13. verifyTranslationKeysOnDisk     — independent (filesystem check) — must run AFTER 11 so
 *      pending suppression handles the in-plan case first; the disk check then
 *      catches keys that were ALREADY written but the LSP hasn't re-indexed.
 *  14. verifyPageRoutesOnDisk          — independent (filesystem check) — must run AFTER 10
 *      so pending suppression handles in-plan pages first; the disk check then
 *      catches pages that exist in OTHER files than the one being analysed
 *      (validate_code is single-file; the LSP cannot see neighbours).
 *  15. verifyOrphanedPartialOnDisk     — independent (filesystem check) — must run AFTER 8
 *      so pending-plan suppression runs first; this catches the post-write case where
 *      the files ARE on disk but the checker hasn't re-indexed (scaffold write:true).
 *  16. verifyMissingPartialsOnDisk     — independent (filesystem check) — must run AFTER 9
 *      so pending suppression handles in-plan partials first; the disk check then
 *      catches partials that ARE on disk but the LSP hasn't re-indexed yet.
 *  17. populateDefaultConfidence       — must run LAST (after all suppressions/verifications)
 *      so it only stamps diagnostics that actually survive to the agent. The rule
 *      engine sets confidence and rule_id when a rule matches; this step covers
 *      everything else with a severity-based default confidence and a stable
 *      `${check}.unmatched` rule_id fallback (A4) so confidenceCalibration can bucket
 *      every row and the Rule Performance table attributes every emit to some rule.
 *
 * NOTE: MissingPartial, MissingPage and TranslationKeyExists are real errors — do NOT downgrade
 * them based on isPreWrite or other implicit state. Use pending_files / pending_pages /
 * pending_translations (populated by validate_intent and session.pending) to suppress
 * false positives during multi-file creation.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { getKnownModulesMissingDocs } from './knowledge-loader.js';
import { buildAssetIndex, resolveAssetPath } from './asset-index.js';
import { buildTranslationIndex } from './translation-index.js';
import { buildPageRouteIndex, parseMissingPageMessage, resolvePageRoute } from './page-route-index.js';
import { DEFAULT_CONFIDENCE_BY_SEVERITY, STRUCTURAL_DEFAULT_CONFIDENCE } from './constants.js';

/**
 * Run the full diagnostic post-processing pipeline.
 *
 * @param {object} result — { errors: [], warnings: [], infos: [] } (mutated in place)
 * @param {object} opts
 * @param {string} opts.filePath — relative file path
 * @param {string} opts.content — file content
 * @param {Set<string>} opts.docParamNames — declared @param names
 * @param {string[]} opts.pendingFiles — files being created soon (suppresses MissingPartial)
 * @param {string[]} opts.pendingPages — page paths being created soon (suppresses MissingPage)
 * @param {string[]} opts.pendingTranslations — translation keys being created soon (suppresses TranslationKeyExists)
 * @param {string} opts.projectDir — project root directory
 */
export function runDiagnosticPipeline(result, opts) {
  const {
    filePath,
    content,
    docParamNames = new Set(),
    pendingFiles = [],
    pendingPages = [],
    pendingTranslations = [],
    projectDir,
  } = opts;

  // Pipeline trace (D2 — pipeline step inspector). Each step records what changed.
  const trace = [];
  function traceStep(name, fn) {
    const eBefore = result.errors.length;
    const wBefore = result.warnings.length;
    fn();
    const eRemoved = eBefore - result.errors.length;
    const wRemoved = wBefore - result.warnings.length;
    const eAdded = result.errors.length - (eBefore - eRemoved);
    trace.push({
      step: name,
      errorsRemoved: eRemoved,
      warningsRemoved: wRemoved,
      errorsAfter: result.errors.length,
      warningsAfter: result.warnings.length,
    });
  }

  // Accumulate suppression summaries into one info diagnostic — the agent sees a single line.
  const suppressionNotes = [];

  // 0. Apply user-defined suppressions from .pos-supervisor-ignore.yml (A3)
  if (projectDir) {
    traceStep('userSuppressions', () => applyUserSuppressions(result, filePath, projectDir));
  }

  // 0a. Suppress known pos-cli LSP false positives. Currently covers the
  //     "Syntax is not supported" regression on `assign x = a <op> b` boolean
  //     comparisons. Runs first so downstream enrichment, fix generation,
  //     and the must_fix_before_write gate never see the spurious error.
  traceStep('suppressLspKnownFalsePositives', () => suppressLspKnownFalsePositives(result, content));

  // 1. Suppress UndefinedObject for declared @param names
  if (docParamNames.size > 0) {
    traceStep('suppressDocParams', () => suppressDocParams(result, docParamNames));
  }

  // 2. Suppress UnusedDocParam when param is used as named argument
  if (docParamNames.size > 0) {
    traceStep('suppressUnusedDocParams', () => suppressUnusedDocParams(result, docParamNames, content));
  }

  // 3. Elevate Shopify contamination from warning to error
  traceStep('elevateShopify', () => elevateShopify(result));

  // 4. Deduplicate MissingRenderPartialArguments + MetadataParamsCheck
  traceStep('deduplicateArgChecks', () => deduplicateArgChecks(result));

  // 5. Suppress MetadataParamsCheck when the called target has no {% doc %} block.
  traceStep('suppressUndocumentedTargetParams', () => suppressUndocumentedTargetParams(result, content, projectDir));

  // 6. Suppress required-param diagnostics whose target partial defaults the param.
  traceStep('suppressRequiredParamsWithDefault', () => suppressRequiredParamsWithDefault(result, content, projectDir));

  // 7. Suppress DeprecatedTag for module helper includes
  traceStep('suppressModuleHelpers', () => suppressModuleHelpers(result, content));

  // 8. Suppress OrphanedPartial for commands/queries and pending plans
  traceStep('suppressOrphanedPartial', () => suppressOrphanedPartial(result, filePath, pendingFiles, pendingPages));

  // 9. Suppress MissingPartial for pending files
  if (pendingFiles.length > 0) {
    traceStep('suppressPendingPartials', () => {
      const n = suppressByPending(result, {
        check: 'MissingPartial',
        pendingSet: buildPendingPartialNames(pendingFiles),
        extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
      });
      if (n > 0) suppressionNotes.push(`${n} MissingPartial(s) for pending files`);
    });
  }

  // 10. Suppress MissingPage for pending pages
  if (pendingPages.length > 0) {
    traceStep('suppressPendingPages', () => {
      const n = suppressByPending(result, {
        check: 'MissingPage',
        pendingSet: buildPendingPageKeys(pendingPages),
        extractKey: (d) => {
          const m = d.message?.match(/['"]([^'"]+)['"]/);
          return m ? m[1] : null;
        },
      });
      if (n > 0) suppressionNotes.push(`${n} MissingPage(s) for pending pages`);
    });
  }

  // 11. Suppress TranslationKeyExists for pending translations
  if (pendingTranslations.length > 0) {
    traceStep('suppressPendingTranslations', () => {
      const n = suppressByPending(result, {
        check: 'TranslationKeyExists',
        pendingSet: new Set(pendingTranslations),
        extractKey: (d) => d.message?.match(/['"]([^'"]+)['"]/)?.[1] ?? null,
      });
      if (n > 0) suppressionNotes.push(`${n} TranslationKeyExists for pending translations`);
    });
  }

  if (suppressionNotes.length > 0) {
    result.infos.push({
      check: 'pos-supervisor:PendingSuppressed',
      severity: 'info',
      message: `Suppressed: ${suppressionNotes.join('; ')} — these will be created later in this plan.`,
    });
  }

  // 12. Verify MissingAsset against filesystem
  if (projectDir) {
    traceStep('verifyMissingAssets', () => verifyMissingAssets(result, projectDir));
  }

  // 13. Verify TranslationKeyExists against filesystem
  if (projectDir) {
    traceStep('verifyTranslationKeysOnDisk', () => verifyTranslationKeysOnDisk(result, projectDir));
  }

  // 14. Verify MissingPage against filesystem. The file under validation is
  //     passed as an overlay so its in-memory frontmatter (`slug:`, `method:`)
  //     contributes to the route index — fixes the self-page case where an
  //     agent validating `app/views/pages/index.liquid` with `method: post`
  //     in-memory would otherwise see a stale MissingPage warning for the
  //     very route this page is about to serve.
  if (projectDir) {
    traceStep('verifyPageRoutesOnDisk', () => verifyPageRoutesOnDisk(result, projectDir, { filePath, content }));
  }

  // 15. Verify OrphanedPartial against filesystem
  if (projectDir) {
    traceStep('verifyOrphanedPartialOnDisk', () => verifyOrphanedPartialOnDisk(result, filePath, projectDir));
  }

  // 16. Verify MissingPartial against filesystem
  if (projectDir) {
    traceStep('verifyMissingPartialsOnDisk', () => verifyMissingPartialsOnDisk(result, projectDir));
  }

  // 17. Stamp a default confidence on every surviving diagnostic that the rule
  //     engine did not already score. Runs last so suppressed/downgraded items
  //     are gone by now.
  traceStep('populateDefaultConfidence', () => populateDefaultConfidence(result));

  // Attach pipeline trace for dashboard inspector (D2)
  result._pipelineTrace = trace;
}

// ── Individual filters ──────────────────────────────────────────────────────

/**
 * Suppress known pos-cli LSP false positives.
 *
 * Currently covers ONE pattern: `LiquidHTMLSyntaxError` with the generic
 * upstream message `Syntax is not supported`, fired by pos-cli's LSP on a
 * boolean comparison inside an `assign` tag (e.g. `assign object.valid = c == empty`,
 * `assign x = 1 == 1`). The platformOS Liquid parser
 * (`@platformos/liquid-html-parser`, the same package the runtime parser is
 * derived from) accepts this syntax, and `pos-cli check run` reports no
 * offenses on it. Only the LSP rejects it — a stand-alone regression in the
 * LSP's expression parser, not in the language.
 *
 * Without this suppression, agents are forced to rewrite valid Liquid
 * (typically by lowering `assign x = a == b` to a four-line if/else) just to
 * pass the must_fix_before_write gate. Worse, the diagnostic message
 * "Syntax is not supported" gives no actionable hint, so agents iterate
 * blindly until something passes.
 *
 * Suppression criteria — all must hold:
 *   1. The diagnostic check is `LiquidHTMLSyntaxError`.
 *   2. The message matches the exact upstream phrasing `Syntax is not supported`
 *      (case-insensitive). Other LiquidHTMLSyntaxError messages — unclosed
 *      blocks, malformed tag arguments, etc. — point at real bugs and stay.
 *   3. The file parses cleanly under the strict mode of the platformOS parser.
 *      A genuine syntax error elsewhere in the file would fail strict parse,
 *      and we leave every diagnostic in place to avoid masking it.
 *
 * When all three hold, the matching diagnostics are removed and a single
 * `pos-supervisor:LspSyntaxFalsePositiveSuppressed` info diagnostic is
 * emitted naming the lines so the agent can audit the suppression.
 */
function suppressLspKnownFalsePositives(result, content) {
  const matches = (d) =>
    d.check === 'LiquidHTMLSyntaxError' &&
    typeof d.message === 'string' &&
    /^Syntax is not supported$/i.test(d.message.trim());

  const candidates = [
    ...result.errors.filter(matches),
    ...result.warnings.filter(matches),
  ];
  if (candidates.length === 0) return;

  // Strict parse — no tolerant flag — is the gate. If the platformOS parser
  // rejects the file, there IS a genuine syntax error and we must not
  // suppress LSP errors that may be the agent's only signal.
  let parsesCleanly;
  try {
    toLiquidHtmlAST(content);
    parsesCleanly = true;
  } catch {
    parsesCleanly = false;
  }
  if (!parsesCleanly) return;

  const removeSet = new Set(candidates);
  result.errors = result.errors.filter(d => !removeSet.has(d));
  result.warnings = result.warnings.filter(d => !removeSet.has(d));

  const lines = candidates
    .map(d => d.line)
    .filter(n => n != null);
  result.infos.push({
    check: 'pos-supervisor:LspSyntaxFalsePositiveSuppressed',
    severity: 'info',
    message:
      `Suppressed ${candidates.length} LiquidHTMLSyntaxError("Syntax is not supported") ` +
      `diagnostic(s)${lines.length ? ` on line(s) ${lines.join(', ')}` : ''} — ` +
      `the platformOS parser (@platformos/liquid-html-parser) accepts the file. ` +
      `This is a known pos-cli LSP regression, most often triggered by a boolean ` +
      `comparison inside \`assign\` (e.g. \`assign x = a == b\`).`,
  });
}

function applyUserSuppressions(result, filePath, projectDir) {
  const suppressFile = join(projectDir, '.pos-supervisor-ignore.yml');
  if (!existsSync(suppressFile)) return;
  let rules;
  try {
    const parsed = yaml.load(readFileSync(suppressFile, 'utf-8'));
    rules = parsed?.suppressions;
  } catch { return; }
  if (!Array.isArray(rules) || rules.length === 0) return;

  const matchRule = (d) => rules.some(r => {
    if (r.check !== d.check) return false;
    if (r.file_pattern) {
      if (r.file_pattern.includes('*')) {
        const re = new RegExp('^' + r.file_pattern.replace(/\*/g, '.*') + '$');
        if (!re.test(filePath)) return false;
      } else if (!filePath.includes(r.file_pattern)) {
        return false;
      }
    }
    return true;
  });

  const errBefore = result.errors.length;
  const warnBefore = result.warnings.length;
  result.errors = result.errors.filter(d => !matchRule(d));
  result.warnings = result.warnings.filter(d => !matchRule(d));
  const suppressed = (errBefore - result.errors.length) + (warnBefore - result.warnings.length);
  if (suppressed > 0) {
    result.infos.push({
      check: 'pos-supervisor:UserSuppressed',
      severity: 'info',
      message: `Suppressed ${suppressed} diagnostic(s) via .pos-supervisor-ignore.yml`,
    });
  }
}

function suppressDocParams(result, docParamNames) {
  const match = (diag) => {
    if (diag.check !== 'UndefinedObject') return false;
    const varMatch = diag.message?.match(/`([^`]+)`/);
    return varMatch && docParamNames.has(varMatch[1]);
  };
  const count = result.errors.filter(match).length + result.warnings.filter(match).length;
  if (count > 0) {
    result.errors = result.errors.filter(d => !match(d));
    result.warnings = result.warnings.filter(d => !match(d));
    result.infos.push({
      check: 'pos-supervisor:DocParamSuppressed',
      severity: 'info',
      message: `Suppressed ${count} UndefinedObject warning(s) for declared @param(s): ${[...docParamNames].join(', ')}`,
    });
  }
}

function suppressUnusedDocParams(result, docParamNames, content) {
  const usedAsArg = new Set();
  for (const name of docParamNames) {
    const argPattern = new RegExp(`(?:,|{%\\s*(?:graphql|function|render|include|theme_render_rc)\\b[^%]*)\\b${name}\\s*:`, 's');
    if (argPattern.test(content)) usedAsArg.add(name);
  }
  if (usedAsArg.size === 0) return;

  const match = (d) => {
    if (d.check !== 'UnusedDocParam') return false;
    const varMatch = d.message?.match(/['"`](\w+)['"`]/);
    return varMatch && usedAsArg.has(varMatch[1]);
  };
  const count = result.errors.filter(match).length + result.warnings.filter(match).length;
  if (count > 0) {
    result.errors = result.errors.filter(d => !match(d));
    result.warnings = result.warnings.filter(d => !match(d));
    result.infos.push({
      check: 'pos-supervisor:UnusedDocParamSuppressed',
      severity: 'info',
      message: `Suppressed ${count} UnusedDocParam warning(s) for @param(s) used as named arguments: ${[...usedAsArg].join(', ')}`,
    });
  }
}

function elevateShopify(result) {
  const shopifyWarnings = result.warnings.filter(d =>
    d.check === 'UndefinedObject' && d.suggestion && /shopify/i.test(d.suggestion)
  );
  if (shopifyWarnings.length > 0) {
    result.warnings = result.warnings.filter(d => !shopifyWarnings.includes(d));
    for (const d of shopifyWarnings) {
      result.errors.push({ ...d, severity: 'error' });
    }
  }
}

function deduplicateArgChecks(result) {
  const mrpaLines = new Set([
    ...result.errors.filter(d => d.check === 'MissingRenderPartialArguments').map(d => d.line),
    ...result.warnings.filter(d => d.check === 'MissingRenderPartialArguments').map(d => d.line),
  ]);
  if (mrpaLines.size === 0) return;

  const isRedundant = (d) => d.check === 'MetadataParamsCheck' && mrpaLines.has(d.line);
  const count = result.errors.filter(isRedundant).length + result.warnings.filter(isRedundant).length;
  if (count > 0) {
    result.errors = result.errors.filter(d => !isRedundant(d));
    result.warnings = result.warnings.filter(d => !isRedundant(d));
    result.infos.push({
      check: 'pos-supervisor:DuplicateArgCheck',
      severity: 'info',
      message: `Suppressed ${count} MetadataParamsCheck diagnostic(s) already covered by MissingRenderPartialArguments`,
    });
  }
}

/**
 * Suppress MetadataParamsCheck whose target partial has no {% doc %} block.
 *
 * Why this is safe: MetadataParamsCheck fires against the *calling* file, inferring
 * required params from usage patterns when the target partial has no authoritative
 * contract. Every diagnostic produced this way is a guess. When the target has no
 * {% doc %}, we suppress the guess and emit an advisory that names the root fix:
 * add a {% doc %} block to the target partial.
 *
 * Two sources of truth for "undocumented":
 *
 *   1. Module targets (`modules/...`) are treated as undocumented unconditionally.
 *      They are excluded from linting via .platformos-check.yml and, in practice,
 *      almost never ship {% doc %}. Matching by path alone also keeps the rule
 *      working in tests and environments where projectDir is not provided.
 *
 *   2. App targets (app/views/partials/<x>.liquid, app/lib/(commands|queries)/<x>.liquid)
 *      require disk confirmation: we read the target file and look for {% doc %}.
 *      If projectDir is missing or the file cannot be read, we conservatively leave
 *      the diagnostic in place — MissingPartial handles the "doesn't exist" case.
 *
 * Module paths continue to produce the `pos-supervisor:ModuleParamsSuppressed` +
 * `pos-supervisor:module_doc_missing` info pair. Undocumented app partials produce
 * a parallel `pos-supervisor:UndocumentedPartialParamsSuppressed` info so the agent
 * sees both the suppression and the paths that need doc blocks.
 */
function suppressUndocumentedTargetParams(result, content, projectDir) {
  const lines = content.split('\n');

  // Extract the first meaningful render/function/theme_render_rc target on a line.
  // We look at the line the diagnostic points to; the LSP attributes MetadataParamsCheck
  // to the opening of the tag, so the path usually sits on the same line.
  const extractTarget = (line) => {
    let m = line.match(/['"](modules\/[^'"]+)['"]/);
    if (m) return { path: m[1].replace(/\.liquid$/, ''), kind: 'module' };
    m = line.match(/\brender\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid`, kind: 'partial' };
    m = line.match(/\btheme_render_rc\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid`, kind: 'partial' };
    m = line.match(/\bfunction\s+\w+\s*=\s*['"]([^'"]+)['"]/);
    if (m) return { path: `app/lib/${m[1]}.liquid`, kind: 'function' };
    return null;
  };

  // Cache disk reads: one target file may back many diagnostics in the same content.
  const undocCache = new Map();   // relPath → true (missing doc), false (has doc), or null (unknown)
  const targetIsUndocumented = (target) => {
    if (target.kind === 'module') return true;
    if (!projectDir) return null;
    if (undocCache.has(target.path)) return undocCache.get(target.path);
    try {
      const abs = join(projectDir, target.path);
      if (!existsSync(abs)) { undocCache.set(target.path, null); return null; }
      const src = readFileSync(abs, 'utf8');
      const hasDoc = /\{%\s*doc\s*%\}/.test(src);
      const undocumented = !hasDoc;
      undocCache.set(target.path, undocumented);
      return undocumented;
    } catch {
      undocCache.set(target.path, null);
      return null;
    }
  };

  const removeSet     = new Set();
  const modulePaths   = new Set();
  const appPaths      = new Set();

  const classify = (d) => {
    if (d.check !== 'MetadataParamsCheck') return;
    const line = lines[(d.line ?? 1) - 1] ?? '';
    const target = extractTarget(line);
    if (!target) return;
    if (targetIsUndocumented(target) !== true) return;
    removeSet.add(d);
    if (target.kind === 'module') modulePaths.add(target.path);
    else appPaths.add(target.path);
  };

  for (const d of result.errors)   classify(d);
  for (const d of result.warnings) classify(d);

  if (removeSet.size === 0) return;

  result.errors   = result.errors.filter(d => !removeSet.has(d));
  result.warnings = result.warnings.filter(d => !removeSet.has(d));

  // Legacy info check name preserved for Module targets — downstream tooling and
  // tests grep this exact string. Message merges module + app counts so the agent
  // sees a single suppression summary.
  if (modulePaths.size > 0) {
    const moduleCount = [...removeSet].filter(d => {
      const line = lines[(d.line ?? 1) - 1] ?? '';
      return /['"]modules\//.test(line);
    }).length;
    result.infos.push({
      check: 'pos-supervisor:ModuleParamsSuppressed',
      severity: 'info',
      message: `Suppressed ${moduleCount} MetadataParamsCheck error(s) on calls to modules/ partials. ` +
               `These fire on the calling file despite modules/ being excluded in .platformos-check.yml ` +
               `because the error is attributed to the caller, not the module file. ` +
               `Root fix: add {% doc %} blocks to the module partials.`,
    });

    // module_doc_missing advisory — split paths into known-offender vs new-offender.
    // Known offenders are tracked upstream; new offenders deserve an upstream issue.
    const known = getKnownModulesMissingDocs();
    const knownList = [];
    const unknownList = [];
    for (const path of modulePaths) {
      if (known.has(path)) knownList.push(path);
      else unknownList.push(path);
    }
    const unknownNote = unknownList.length > 0
      ? ` New offender(s) not on the known list — consider filing an upstream issue ` +
        `against each module repo to add a {% doc %} block: ${unknownList.join(', ')}.`
      : '';
    result.infos.push({
      check: 'pos-supervisor:module_doc_missing',
      severity: 'info',
      message: `Module partial(s) missing {% doc %} blocks detected on calling file: ${[...modulePaths].join(', ')}.${unknownNote}`,
      known: knownList,
      unknown: unknownList,
    });
  }

  // App-partial suppression gets its own advisory so the agent can file a PR or
  // add the doc block locally. This is the principled generalisation of the old
  // band-aid to internal project code.
  if (appPaths.size > 0) {
    const appCount = removeSet.size - (modulePaths.size > 0
      ? [...removeSet].filter(d => {
          const line = lines[(d.line ?? 1) - 1] ?? '';
          return /['"]modules\//.test(line);
        }).length
      : 0);
    result.infos.push({
      check: 'pos-supervisor:UndocumentedPartialParamsSuppressed',
      severity: 'info',
      message:
        `Suppressed ${appCount} MetadataParamsCheck error(s) whose target partial lacks a {% doc %} block. ` +
        `Without a contract, the LSP guesses required parameters from usage and produces false positives. ` +
        `Root fix: add {% doc %} with @param declarations to each target: ${[...appPaths].join(', ')}.`,
      paths: [...appPaths],
    });
  }
}

/**
 * Suppress required-parameter diagnostics when the target partial defaults the
 * parameter in its body (via `| default:` filter). The target's {% doc %} block
 * may declare the param as required (no brackets), but if the body does
 * `assign X = X | default: '...'`, the param is effectively optional — callers
 * that omit it still receive a valid value. Upstream LSP doesn't do this body
 * inference, so it flags the caller.
 *
 * Requires projectDir — without disk access we cannot read the target file and
 * will conservatively leave the diagnostic alone. The existing `pending_files`
 * suppression covers the case where the target is being created in the same plan.
 *
 * Covers both `MetadataParamsCheck` (inferred) and `MissingRenderPartialArguments`
 * (doc-block-declared). Both share the same false-positive pattern.
 */
function suppressRequiredParamsWithDefault(result, content, projectDir) {
  if (!projectDir) return;

  const lines = content.split('\n');

  const extractTarget = (line) => {
    let m = line.match(/['"](modules\/[^'"]+)['"]/);
    if (m) return { path: m[1].endsWith('.liquid') ? m[1] : `${m[1]}.liquid` };
    m = line.match(/\brender\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid` };
    m = line.match(/\btheme_render_rc\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid` };
    m = line.match(/\bfunction\s+\w+\s*=\s*['"]([^'"]+)['"]/);
    if (m) return { path: `app/lib/${m[1]}.liquid` };
    return null;
  };

  // Extract the param name the LSP flagged.
  // MetadataParamsCheck:            "Required parameter 'X' must be passed"
  //                                 "Required parameter X must be passed to function call"
  // MissingRenderPartialArguments:  "Missing required argument 'X' in render tag for partial 'Y'"
  const extractParamName = (msg) => {
    if (!msg) return null;
    let m = msg.match(/\bargument\s+['"`](\w+)['"`]/i);
    if (m) return m[1];
    m = msg.match(/[Rr]equired parameter\s+['"`]?(\w+)['"`]?/);
    if (m) return m[1];
    return null;
  };

  const targetCache = new Map();
  const readTarget = (relPath) => {
    if (targetCache.has(relPath)) return targetCache.get(relPath);
    try {
      const abs = join(projectDir, relPath);
      if (!existsSync(abs)) { targetCache.set(relPath, null); return null; }
      const src = readFileSync(abs, 'utf8');
      targetCache.set(relPath, src);
      return src;
    } catch {
      targetCache.set(relPath, null);
      return null;
    }
  };

  const paramDefaultedInBody = (src, paramName) => {
    if (!src || !paramName) return false;
    // Either `X | default: ...` in an expression or `assign X = X | default: ...`
    // in a liquid tag. Anchor to word boundary to avoid partial matches.
    const re = new RegExp(`\\b${paramName}\\s*\\|\\s*default\\s*:`);
    return re.test(src);
  };

  const removeSet = new Set();
  const affected  = new Set();

  const classify = (d) => {
    if (d.check !== 'MetadataParamsCheck' && d.check !== 'MissingRenderPartialArguments') return;
    const target = extractTarget(lines[(d.line ?? 1) - 1] ?? '');
    if (!target) return;
    const paramName = extractParamName(d.message);
    if (!paramName) return;
    const src = readTarget(target.path);
    if (!paramDefaultedInBody(src, paramName)) return;
    removeSet.add(d);
    affected.add(`${target.path}#${paramName}`);
  };

  for (const d of result.errors)   classify(d);
  for (const d of result.warnings) classify(d);

  if (removeSet.size === 0) return;

  result.errors   = result.errors.filter(d => !removeSet.has(d));
  result.warnings = result.warnings.filter(d => !removeSet.has(d));

  result.infos.push({
    check: 'pos-supervisor:ParamHasDefaultSuppressed',
    severity: 'info',
    message:
      `Suppressed ${removeSet.size} required-param diagnostic(s) whose target partial defaults the ` +
      `parameter via a \`| default:\` filter — the param is effectively optional. ` +
      `Root fix: convert the @param declaration to bracket notation ([name]) in the target's {% doc %} block. ` +
      `Affected target:param pairs: ${[...affected].join(', ')}.`,
    affected: [...affected],
  });
}

function suppressModuleHelpers(result, content) {
  const isModuleHelperInclude = (d) => {
    if (d.check !== 'DeprecatedTag') return false;
    return /include\s+['"]modules\/[^'"]*\/helpers\//.test(content) &&
      d.message?.includes('include');
  };
  const count = result.errors.filter(isModuleHelperInclude).length +
    result.warnings.filter(isModuleHelperInclude).length;
  if (count > 0) {
    result.errors = result.errors.filter(d => !isModuleHelperInclude(d));
    result.warnings = result.warnings.filter(d => !isModuleHelperInclude(d));
    result.infos.push({
      check: 'pos-supervisor:ModuleHelperInclude',
      severity: 'info',
      message: `Suppressed ${count} DeprecatedTag warning(s) for module helper includes — modules use {% include %} for scope sharing by design.`,
    });
  }
}

/**
 * Suppress OrphanedPartial in two cases:
 *
 *   1. `app/lib/(commands|queries)/` — these are invoked via `{% function %}` /
 *      `{% graphql %}` / GraphQL mutations. Static analysis cannot follow those
 *      invocation paths, so every command/query looks orphaned. Shipping == dead
 *      code for this class of file is expected.
 *
 *   2. Multi-file creation plans — when the validated file is a partial AND a
 *      pending page/partial/layout exists in `pending_files` or `pending_pages`,
 *      callers of this partial may be yet-to-be-written files in the same plan.
 *      LSP cannot know about files that aren't on disk yet, so the orphan
 *      determination is a guess. Suppress and let the next pipeline run
 *      (once the plan lands on disk) re-evaluate.
 */
function suppressOrphanedPartial(result, filePath, pendingFiles = [], pendingPages = []) {
  const isOrphan = (d) => d.check === 'OrphanedPartial';
  const count = result.errors.filter(isOrphan).length + result.warnings.filter(isOrphan).length;
  if (count === 0) return;

  const remove = (reason, message) => {
    result.errors = result.errors.filter(d => !isOrphan(d));
    result.warnings = result.warnings.filter(d => !isOrphan(d));
    result.infos.push({
      check: 'pos-supervisor:OrphanedPartialSuppressed',
      severity: 'info',
      message,
      reason,
    });
  };

  if (/\/lib\/(commands|queries)\//.test(filePath)) {
    remove(
      'lib-target',
      `Suppressed ${count} OrphanedPartial diagnostic(s) — commands/queries are invoked via ` +
      `{% function %} / GraphQL and appear orphaned to static cross-reference analysis.`,
    );
    return;
  }

  const isPartialLike = /\/(partials|layouts)\//.test(filePath);
  if (!isPartialLike) return;

  // Pending plan is plausible only if it contains files that could call a partial:
  // pages, partials, layouts. A pending translations file or schema file is not a caller.
  const callerLike = (p) => /\/(pages|partials|layouts)\//.test(p);
  const planHasPotentialCallers =
    pendingFiles.some(callerLike) || pendingPages.some(callerLike) || pendingPages.length > 0;
  if (!planHasPotentialCallers) return;

  remove(
    'pending-plan',
    `Suppressed ${count} OrphanedPartial diagnostic(s) — callers in the current plan are not yet ` +
    `written (pending files: ${pendingFiles.length}, pending pages: ${pendingPages.length}). ` +
    `Re-run validation once the plan lands on disk to re-evaluate.`,
  );
}

/**
 * Unified pending-state suppression helper.
 *
 * Removes diagnostics matching a specific check name whose extracted key is present
 * in a pending set. Returns how many diagnostics were removed so callers can
 * accumulate a single summary info diagnostic.
 *
 * @param {{errors: object[], warnings: object[], infos: object[]}} result — mutated in place
 * @param {object} opts
 * @param {string} opts.check — the diagnostic check name to filter on
 * @param {Set<string>} opts.pendingSet — set of pending keys to match against
 * @param {(diagnostic: object) => string | null} opts.extractKey — extracts comparison key from a diagnostic
 * @returns {number} number of diagnostics removed
 */
export function suppressByPending(result, { check, pendingSet, extractKey }) {
  if (!pendingSet || pendingSet.size === 0) return 0;
  const matches = (d) => {
    if (d.check !== check) return false;
    const key = extractKey(d);
    return key != null && pendingSet.has(key);
  };
  let count = 0;
  count += result.errors.filter(matches).length;
  count += result.warnings.filter(matches).length;
  count += (result.infos ?? []).filter(matches).length;
  result.errors   = result.errors.filter(d => !matches(d));
  result.warnings = result.warnings.filter(d => !matches(d));
  result.infos    = (result.infos ?? []).filter(d => !matches(d));
  return count;
}

/**
 * Build the set of name variants a MissingPartial reference might use for a pending file.
 * Liquid render calls reference partials by short name, stripped of the views/partials prefix
 * and the .liquid extension — but upstream messages may also include the full path, so we
 * include every reasonable form.
 */
export function buildPendingPartialNames(pendingFiles) {
  const names = new Set();
  for (const f of pendingFiles) {
    names.add(f.replace(/^app\/views\/partials\//, '').replace(/\.html\.liquid$/, '').replace(/\.liquid$/, ''));
    names.add(f.replace(/^app\/graphql\//, '').replace(/\.graphql$/, ''));
    names.add(f.replace(/^app\/lib\//, '').replace(/\.liquid$/, ''));
    names.add(f);
  }
  return names;
}

/**
 * Build the set of slug/method keys a MissingPage reference might use for a pending page.
 * Page refs may appear as slugs (`blog_posts/show`), as `{slug}:{method}` pairs when the
 * project_map multi-method fix lands, or as raw file paths.
 */
export function buildPendingPageKeys(pendingPages) {
  const keys = new Set();
  for (const p of pendingPages) {
    keys.add(p);
    const m = p.match(/^app\/views\/pages\/(.+?)\.(?:html\.liquid|liquid)$/);
    if (m) {
      keys.add(m[1]);
      // Trim trailing /index for index pages whose slug is the parent path
      keys.add(m[1].replace(/\/index$/, ''));
    }
  }
  return keys;
}

/**
 * Cross-check every MissingAsset against the real filesystem under `app/assets/`.
 *
 * Three outcomes per diagnostic:
 *   1. Exists exactly where the template says → suppress. The LSP's asset
 *      index lagged behind disk; the agent would otherwise chase a ghost.
 *   2. File exists at a different nested path (same basename) → suppress,
 *      emit a `pos-supervisor:MissingAssetPathHint` pointing at the real
 *      path. This is the prefix-ambiguity case: the agent wrote
 *      `{{ 'logo.png' | asset_url }}` when the file actually lives at
 *      `images/logo.png`. Giving a concrete replacement path is the entire
 *      fix — the original diagnostic's hint is too generic to act on.
 *   3. Nothing matches on disk → leave the diagnostic in place. This IS a
 *      real missing asset and the agent needs to create it.
 */
function verifyMissingAssets(result, projectDir) {
  const missingAssets = [...result.errors, ...result.warnings].filter(d => d.check === 'MissingAsset');
  if (missingAssets.length === 0) return;

  const index = buildAssetIndex(projectDir);
  const suppressed = new Set();
  const verifiedPaths = [];
  const renamedHints = []; // { reported, suggestion }
  const ambiguousHints = []; // { reported, suggestions }

  for (const d of missingAssets) {
    const pathMatch = d.message?.match(/['"`]([^'"`]+)['"`]/);
    if (!pathMatch) continue;
    const reported = pathMatch[1];
    const resolution = resolveAssetPath(reported, index);

    if (resolution.status === 'exists') {
      suppressed.add(d);
      verifiedPaths.push(reported);
    } else if (resolution.status === 'renamed') {
      suppressed.add(d);
      renamedHints.push({ reported, suggestion: resolution.suggestion });
    } else if (resolution.status === 'ambiguous') {
      // Don't suppress — the agent needs to pick. Attach candidates so the
      // hint line carries something actionable rather than "check the path".
      d.hint = (d.hint ? d.hint + '\n' : '') +
        `Basename matches multiple assets: ${resolution.suggestions.join(', ')}. Use the path that belongs to this template's module/feature.`;
      ambiguousHints.push({ reported, suggestions: resolution.suggestions });
    }
  }

  if (suppressed.size > 0) {
    result.errors = result.errors.filter(d => !suppressed.has(d));
    result.warnings = result.warnings.filter(d => !suppressed.has(d));
  }

  if (verifiedPaths.length > 0) {
    result.infos.push({
      check: 'pos-supervisor:MissingAssetSuppressed',
      severity: 'info',
      message: `Suppressed ${verifiedPaths.length} MissingAsset diagnostic(s) — asset(s) exist on disk: ${verifiedPaths.join(', ')}`,
    });
  }

  for (const { reported, suggestion } of renamedHints) {
    result.infos.push({
      check: 'pos-supervisor:MissingAssetPathHint',
      severity: 'info',
      message: `Asset '${reported}' is not at the path written, but '${suggestion}' exists. asset_url paths are relative to app/assets/ and MUST include the subdirectory (styles/, scripts/, images/, fonts/, media/). Change the template to: {{ '${suggestion}' | asset_url }}.`,
      suggestion,
    });
  }
}

/**
 * Cross-check every TranslationKeyExists against the real translations files
 * on disk. The LSP's translation cache routinely lags behind a freshly-written
 * `app/translations/<locale>.yml`, surfacing as "key not found" errors for
 * keys the agent literally just wrote. The fix mirrors verifyMissingAssets:
 * read the YAML, flatten the key tree, and suppress the diagnostic when the
 * reported key is present in any locale.
 *
 * `pending_translations` (suppressByPending above) handles the in-plan case
 * — keys planned but not yet written. This step handles the post-write case
 * — keys that ARE on disk but the LSP hasn't picked up. The two together
 * mean an agent that has either planned or written a key never sees a
 * stale "missing key" error.
 */
/**
 * Cross-check every MissingPage against the real pages on disk. The check
 * fires whenever validate_code analyses a file with a link or render to a
 * route the LSP cannot prove exists from the single file's contents. Most
 * such routes ARE served — by other page files the LSP isn't looking at.
 *
 * Three outcomes per diagnostic:
 *   - exists for the reported method → suppress, plus an info pointing at
 *     "where the page lives" so the agent learns the layout.
 *   - exists but only for OTHER methods → leave the diagnostic but enrich
 *     `.hint` with the methods that ARE served. This is a real bug (a GET
 *     link to a POST-only route) and the agent needs to see it.
 *   - route not served at all → diagnostic stands.
 */
function verifyPageRoutesOnDisk(result, projectDir, currentFile = null) {
  const candidates = [...result.errors, ...result.warnings].filter(d => d.check === 'MissingPage');
  if (candidates.length === 0) return;

  const index = buildPageRouteIndex(projectDir, currentFile);
  if (index.routes.size === 0) return;

  const suppressed = new Set();
  const verifiedRoutes = []; // strings shown in the suppression info
  const wrongMethodHints = [];

  for (const d of candidates) {
    const parsed = parseMissingPageMessage(d.message);
    if (!parsed) continue;
    const resolution = resolvePageRoute(parsed.route, parsed.method, index);

    if (resolution.status === 'exists') {
      suppressed.add(d);
      verifiedRoutes.push(`${parsed.route || '/'} (${parsed.method.toUpperCase()})`);
    } else if (resolution.status === 'wrong-method') {
      d.hint = (d.hint ? d.hint + '\n' : '') +
        `Route '${parsed.route || '/'}' IS served, but only for ${resolution.methods.map(m => m.toUpperCase()).join(', ')} — not ${parsed.method.toUpperCase()}. ` +
        `If this is an <a href> use the method that's actually served, or scaffold a new page for the missing method.`;
      wrongMethodHints.push({ route: parsed.route, requested: parsed.method, served: resolution.methods });
    }
  }

  if (suppressed.size > 0) {
    result.errors = result.errors.filter(d => !suppressed.has(d));
    result.warnings = result.warnings.filter(d => !suppressed.has(d));
    result.infos.push({
      check: 'pos-supervisor:MissingPageSuppressed',
      severity: 'info',
      message: `Suppressed ${verifiedRoutes.length} MissingPage diagnostic(s) — route(s) served by other page file(s) in app/views/pages/: ${verifiedRoutes.join(', ')}. (validate_code analyses one file at a time and cannot see neighbouring pages.)`,
    });
  }
}

function verifyTranslationKeysOnDisk(result, projectDir) {
  const candidates = [...result.errors, ...result.warnings].filter(d => d.check === 'TranslationKeyExists');
  if (candidates.length === 0) return;

  const { keys } = buildTranslationIndex(projectDir);
  if (keys.size === 0) return;

  const verified = [];
  for (const d of candidates) {
    const m = d.message?.match(/['"`]([^'"`]+)['"`]/);
    if (!m) continue;
    if (keys.has(m[1])) verified.push({ d, key: m[1] });
  }
  if (verified.length === 0) return;

  const suppressed = new Set(verified.map(v => v.d));
  result.errors = result.errors.filter(d => !suppressed.has(d));
  result.warnings = result.warnings.filter(d => !suppressed.has(d));
  result.infos.push({
    check: 'pos-supervisor:TranslationKeyExistsSuppressed',
    severity: 'info',
    message: `Suppressed ${verified.length} TranslationKeyExists diagnostic(s) — key(s) already defined in app/translations/: ${verified.map(v => v.key).join(', ')}. (LSP cache lag — no need to pass pending_translations for keys already on disk.)`,
  });
}

/**
 * Verify OrphanedPartial against the on-disk project. The checker's cross-file
 * index may be stale (especially after scaffold write:true), but the files ARE
 * on disk. Scan all .liquid files under app/ for a render or function reference
 * to this partial name. If found, suppress — the partial is NOT orphaned.
 */
function verifyOrphanedPartialOnDisk(result, filePath, projectDir) {
  const isOrphan = (d) => d.check === 'OrphanedPartial';
  const orphanCount = result.errors.filter(isOrphan).length + result.warnings.filter(isOrphan).length;
  if (orphanCount === 0) return;

  const partialName = extractPartialNameFromPath(filePath);
  if (!partialName) return;

  if (!hasRenderReferenceOnDisk(projectDir, partialName, filePath)) return;

  result.errors = result.errors.filter(d => !isOrphan(d));
  result.warnings = result.warnings.filter(d => !isOrphan(d));
  result.infos.push({
    check: 'pos-supervisor:OrphanedPartialVerified',
    severity: 'info',
    message: `Suppressed OrphanedPartial — '${partialName}' is referenced by file(s) on disk. (Checker index lag.)`,
  });
}

/**
 * Cross-check every MissingPartial against the real filesystem.
 *
 * The LSP's partial index lags behind disk writes. A partial written during a
 * scaffold step produces a false-positive MissingPartial until the LSP re-indexes.
 * Module partials (names starting with 'modules/') are skipped — they are not local
 * disk files and cannot be suppressed by presence checks.
 */
function verifyMissingPartialsOnDisk(result, projectDir) {
  const candidates = [...result.errors, ...result.warnings].filter(d => d.check === 'MissingPartial');
  if (candidates.length === 0) return;

  const suppressed = new Set();
  const verified = [];

  for (const d of candidates) {
    const nameMatch = d.message?.match(/['"]([^'"]+)['"]/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (name.startsWith('modules/')) continue;

    if (resolveMissingPartialPaths(name, projectDir).some(p => existsSync(p))) {
      suppressed.add(d);
      verified.push(name);
    }
  }

  if (suppressed.size === 0) return;

  result.errors = result.errors.filter(d => !suppressed.has(d));
  result.warnings = result.warnings.filter(d => !suppressed.has(d));
  result.infos.push({
    check: 'pos-supervisor:MissingPartialSuppressed',
    severity: 'info',
    message: `Suppressed ${verified.length} MissingPartial diagnostic(s) — partial(s) exist on disk: ${verified.join(', ')}. (LSP cache lag — partial was written but not yet re-indexed.)`,
  });
}

/**
 * Mirror upstream `DocumentsLocator` partial-resolution semantics: the
 * `function` / `render` tags resolve relative to the partial search paths
 * declared by `@platformos/platformos-common` —
 *   FILE_TYPE_DIRS[Partial] = ['views/partials', 'lib']
 * — joined under `app/`. So `commands/X` is found at `app/lib/commands/X.liquid`
 * and `lib/commands/X` would only resolve at `app/lib/lib/commands/X.liquid`
 * (which never exists in any sane project). DO NOT strip a leading `lib/`
 * here: doing so silently suppresses the LSP's correct MissingPartial error
 * for the invalid prefix and steers agents toward the bug. The `.html.liquid`
 * variant is included for legacy projects whose partials use the layout
 * extension; upstream itself only matches `.liquid`, so this is a superset.
 */
function resolveMissingPartialPaths(name, projectDir) {
  return [
    join(projectDir, 'app', 'views', 'partials', `${name}.liquid`),
    join(projectDir, 'app', 'views', 'partials', `${name}.html.liquid`),
    join(projectDir, 'app', 'lib', `${name}.liquid`),
  ];
}

function extractPartialNameFromPath(filePath) {
  const m = filePath.match(/^app\/views\/partials\/(.+?)\.(?:html\.)?liquid$/);
  return m ? m[1] : null;
}

function defaultConfidenceFor(diag) {
  if (typeof diag.check === 'string' && diag.check.startsWith('pos-supervisor:')) {
    return STRUCTURAL_DEFAULT_CONFIDENCE;
  }
  const sev = diag.severity;
  if (sev && DEFAULT_CONFIDENCE_BY_SEVERITY[sev] != null) {
    return DEFAULT_CONFIDENCE_BY_SEVERITY[sev];
  }
  return DEFAULT_CONFIDENCE_BY_SEVERITY.warning;
}

function defaultRuleIdFor(diag) {
  // Stable fallback so rule-less diagnostics cluster under a single bucket per
  // check instead of scattering into `unknown` or the check name alone (which
  // collides with the check-level scorecard and muddles rule attribution).
  // See A4 in docs/new-task/implementation-plan.md.
  return diag.check ? `${diag.check}.unmatched` : 'unknown.unmatched';
}

function populateDefaultConfidence(result) {
  const stamp = (d) => {
    if (d.confidence == null) d.confidence = defaultConfidenceFor(d);
    if (!d.rule_id) d.rule_id = defaultRuleIdFor(d);
  };
  for (const d of result.errors) stamp(d);
  for (const d of result.warnings) stamp(d);
  for (const d of result.infos) stamp(d);
}

/**
 * Stand-alone entry point — same semantics as the pipeline's step 17, callable
 * from outside the pipeline.
 *
 * Reason it exists: `validate-code.js` pushes several diagnostic sources
 * (structural warnings, schema validation, translation YAML check, diff-aware
 * RemovedRender/RemovedGraphQL/AddedParam, new-partial caller check) into
 * `result.errors` / `result.warnings` AFTER `runDiagnosticPipeline` finishes.
 * Those late additions would otherwise escape `populateDefaultConfidence` and
 * land in the analytics store with `confidence = null` / `rule_id` missing.
 * See the confidence-stamp bug identified in the 2026-04-23 DEMO report.
 *
 * Idempotent — calling twice is safe because the helper only fills when
 * fields are null/missing.
 */
export function stampDefaultsOn(result) {
  populateDefaultConfidence(result);
}

/**
 * Suppress upstream `ValidFrontmatter` diagnostics that overlap with our
 * richer structural-check counterparts. pos-cli 6.0.7 added `ValidFrontmatter`
 * which independently reports the same root causes as our existing
 * `pos-supervisor:InvalidLayout` (missing layout file) and
 * `pos-supervisor:InvalidFrontMatter` (unknown / misleading frontmatter keys).
 *
 * Our checks carry richer messages (named expected paths, deprecation
 * guidance, fix templates) so we keep them and drop the upstream copy.
 * Upstream `ValidFrontmatter` rows that don't share a line with one of our
 * checks pass through untouched — they cover novel cases (deprecated
 * `layout_name`, missing required fields per file type, invalid HTTP method
 * enum, etc.) that our structural checks don't handle yet.
 *
 * Line-anchored: YAML frontmatter is one key per line, so a line collision
 * between `ValidFrontmatter` and `pos-supervisor:InvalidLayout` /
 * `pos-supervisor:InvalidFrontMatter` reliably indicates the same root cause.
 *
 * Idempotent. Pure. Safe to call after both diagnostic sources have pushed
 * (i.e. after `generateStructuralWarnings`).
 *
 * @returns {number} count of suppressed diagnostics
 */
export function suppressUpstreamFrontmatterDup(result) {
  // Two matching axes — line (the default) AND layout name (parsed from the
  // message). The line-match alone misses cases where upstream and our
  // structural emitter disagree by ±1 line (frontmatter edge cases, leading
  // whitespace, line-zero anchoring), which is exactly what the DEMO data
  // showed: both `pos-supervisor:InvalidLayout` and
  // `ValidFrontmatter.layout_missing` fired with diverging line values, so
  // the agent saw two contradictory hints for the same root cause.
  const ourLines = new Set();
  const ourInvalidLayoutNames = new Set();
  for (const d of [...result.errors, ...result.warnings]) {
    if (d.check === 'pos-supervisor:InvalidLayout' || d.check === 'pos-supervisor:InvalidFrontMatter') {
      ourLines.add(d.line);
    }
    if (d.check === 'pos-supervisor:InvalidLayout') {
      const layoutName = d.message?.match(/^Layout `([^`]+)` not found/)?.[1];
      if (layoutName) ourInvalidLayoutNames.add(layoutName);
    }
  }
  if (ourLines.size === 0 && ourInvalidLayoutNames.size === 0) return 0;

  const isRedundant = (d) => {
    if (d.check !== 'ValidFrontmatter') return false;
    if (ourLines.has(d.line)) return true;
    // Layout-name match: the upstream `Layout 'X' does not exist` shape
    // names the same layout `X` that pos-supervisor:InvalidLayout already
    // flagged. The two diagnostics describe identical root cause.
    const layoutName = d.message?.match(/^Layout ['"`]([^'"`]+)['"`] does not exist$/)?.[1];
    return !!layoutName && ourInvalidLayoutNames.has(layoutName);
  };
  const eRemoved = result.errors.filter(isRedundant).length;
  const wRemoved = result.warnings.filter(isRedundant).length;
  const removed = eRemoved + wRemoved;
  if (removed === 0) return 0;

  result.errors = result.errors.filter(d => !isRedundant(d));
  result.warnings = result.warnings.filter(d => !isRedundant(d));
  result.infos.push({
    check: 'pos-supervisor:DuplicateFrontmatterCheck',
    severity: 'info',
    message: `Suppressed ${removed} ValidFrontmatter diagnostic(s) already covered by pos-supervisor structural check(s) (InvalidLayout / InvalidFrontMatter).`,
  });
  return removed;
}

function hasRenderReferenceOnDisk(projectDir, partialName, selfPath) {
  const escaped = partialName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`['"]${escaped}['"]`);

  const scanDirs = ['app/views/pages', 'app/views/partials', 'app/views/layouts'];
  for (const dir of scanDirs) {
    const fullDir = join(projectDir, dir);
    let entries;
    try { entries = readdirSync(fullDir, { recursive: true }); } catch { continue; }

    for (const entry of entries) {
      if (!entry.endsWith('.liquid')) continue;
      const relPath = join(dir, entry);
      if (relPath === selfPath) continue;
      try {
        const content = readFileSync(join(fullDir, entry), 'utf8');
        if (pattern.test(content)) return true;
      } catch { /* unreadable file — skip */ }
    }
  }
  return false;
}
