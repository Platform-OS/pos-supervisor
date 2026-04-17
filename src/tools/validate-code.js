import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { parseLiquidFile, extractAllFromAST } from '../core/liquid-parser.js';
import { checkContent } from '../core/check-runner.js';
import { normalizeLspDiagnostics } from '../core/lsp-client.js';
import { enrichAll } from '../core/error-enricher.js';
import { generateFixes, clusterDiagnostics, generateScorecard } from '../core/fix-generator.js';
import { getDomainFromPath, getDomainHeader } from '../core/domain-detector.js';
import { getTriggeredGotchas, getContentTriggers } from '../core/knowledge-loader.js';
import { generateStructuralWarnings } from '../core/structural-warnings.js';
import { validateSchema } from '../core/schema-validator.js';
import { checkSchemaProperties } from '../core/schema-property-checker.js';
import { runDiagnosticPipeline } from '../core/diagnostic-pipeline.js';
import { partitionCallersByPending } from '../core/pending-callers.js';
import { toUri, sanitizePath } from '../core/utils.js';
import { fingerprint, templateFingerprint, messageTemplate } from '../core/diagnostic-record.js';
import { getProjectMap } from './project-map.js';
import { LSP_DIAGNOSTICS_TIMEOUT_MS, CONSECUTIVE_ERROR_THRESHOLD } from '../core/constants.js';

/**
 * Warnings that MUST block a write even when result.status is 'warning'.
 *
 * Agents frequently read `status !== 'error'` as "safe to write" and ship a
 * file that silently breaks callers or drops functionality. The cases below
 * are narrower than "all warnings" — they are the specific cross-file or
 * signal-loss warnings that turn into bugs if ignored, and they drive the
 * boolean `must_fix_before_write` field. `next_step` branches on that field
 * instead of on status, so the agent sees a hard stop in the response shape
 * rather than a gentle "fix them before writing" prose line.
 */
const BLOCKING_WARNINGS = new Set([
  'pos-supervisor:AddedParam',        // new @param breaks existing callers
  'pos-supervisor:NewPartialParams',  // new partial declares params existing callers don't pass
  'pos-supervisor:RemovedRender',     // removing render breaks user-visible behavior
  'pos-supervisor:RemovedGraphQL',    // removing graphql call drops data fetch
  'pos-supervisor:RemovedParam',      // removing @param breaks callers
  'OrphanedPartial',                  // not reachable — shipping means dead code
]);

export const validateCodeTool = {
  name: 'validate_code',
  description: `PURPOSE:
Validate platformOS code content prior to any hand-authored write/edit operation. Returns
enriched diagnostics, fix hints, LSP intelligence, domain guidance, and structural analysis.

WHEN TO CALL:
  - Before writing any HAND-DRAFTED .liquid, .graphql, or .yml file (REQUIRED).
  - After manually EDITING a scaffold-generated file (REQUIRED for the edited file only).
  - After scaffold(write:true) — NOT required. Scaffold output is pre-validated; re-linting
    it produces false-positive loops.

You MUST:
  Resolve every ERROR and WARNING returned before writing the file.
  Re-run validate_code after fixing until zero issues remain.
  Skipping validation on a hand-drafted file = FAIL.

REQUIRED PROCEDURE:
1. If editing an existing file: READ the file first, extract its FULL current content.
2. Prepare the COMPLETE target content — full file text for new files; full updated text for edits (not a diff).
3. Call validate_code with content = full file text.
4. Fix every ERROR and WARNING in the result before writing.
5. Only write the file after validate_code returns no errors or warnings.

CONSTRAINTS:
  - NEVER call validate_code with part of the content.
  - NEVER pass a file path as the content parameter.
  - NEVER skip validation on a hand-drafted file regardless of confidence level.
  - Validation must occur immediately before the write operation.

If validate_intent was called before drafting, session.pending is merged automatically so you
do NOT need to pass pending_files / pending_translations / pending_pages here. Pass them
explicitly only if you are validating a file that is NOT part of the most recent plan.`,
  inputSchema: {
    file_path: z.string().describe('Target file path (relative to project root, e.g. "app/views/pages/index.html.liquid")'),
    content: z.string().describe('The complete text content of the file — NOT a file path. Read the file first, then pass the full text here.'),
    mode: z.enum(['full', 'quick']).optional().describe('Validation mode. Both modes: parse + lint + enrichment (suggestions, Shopify detection) + structural warnings. Difference: "full" additionally provides LSP completions, fix proposals, domain guidance, and architectural scoring. "quick" is for rapid re-validation after applying fixes.'),
    pending_files: z.array(z.string()).optional().describe('File paths being created soon (suppresses MissingPartial for these). Automatically merged with session pending from validate_intent — omit if you already called validate_intent in this session.'),
    pending_pages: z.array(z.string()).optional().describe('Page paths being created soon (suppresses MissingPage for these). Automatically merged with session pending from validate_intent.'),
    pending_translations: z.array(z.string()).optional().describe('Translation keys being created soon (suppresses TranslationKeyExists for these). Automatically merged with session pending from validate_intent.'),
  },

  createHandler(ctx) {
    return async (params) => {
      const { file_path, content, mode = 'full' } = params;

      // Merge explicit params with session.pending (written by validate_intent).
      // Params take precedence when present — explicit wins over implicit — but both
      // are unioned so the agent does not have to re-pass state on every call.
      const sessionPending = ctx.session?.pending ?? {};
      const pending_files = unionUnique(params.pending_files, sessionPending.files);
      const pending_pages = unionUnique(params.pending_pages, sessionPending.pages);
      const pending_translations = unionUnique(params.pending_translations, sessionPending.translations);

      // Input validation — returns validation-shaped response so agents get uniform {status, errors, warnings, infos}
      if (!file_path || typeof file_path !== 'string') {
        return { status: 'error', errors: [{ check: 'InputError', severity: 'error', message: 'file_path is required' }], warnings: [], infos: [] };
      }
      if (typeof content !== 'string') {
        return { status: 'error', errors: [{ check: 'InputError', severity: 'error', message: 'content is required and must be a string' }], warnings: [], infos: [] };
      }
      // Catch agent mistakes: empty content, or passing a file path instead of file text.
      // Phase 4 tightens this: also rejects content shorter than 5 chars (which
      // cannot contain any meaningful Liquid) and flags frontmatter-only pages
      // as an advisory warning rather than a silent pass.
      const contentTrimmed = content.trim();
      const looksLikePath = content === file_path ||
        /^(app|modules)\/[^\n]+\.(liquid|graphql|yml)$/.test(contentTrimmed);
      const tooShort = contentTrimmed.length > 0 && contentTrimmed.length < 5;

      if (contentTrimmed === '' || looksLikePath || tooShort) {
        const reason = contentTrimmed === ''
          ? '(empty string)'
          : looksLikePath
            ? `looks like a file path, not file content: "${content.slice(0, 80)}"`
            : `too short to be valid content (${contentTrimmed.length} chars): "${contentTrimmed}"`;
        return {
          status: 'error',
          must_fix_before_write: true,
          errors: [{
            check: 'InputError',
            severity: 'error',
            message: `content must be the actual file text, not a path or empty string. ` +
              `Read the file first (e.g. via Read tool), then pass the full text here. ` +
              `Received: ${reason}`,
          }],
          warnings: [],
          infos: [],
        };
      }

      let absPath;
      try {
        absPath = sanitizePath(ctx.directory, file_path);
      } catch (e) {
        return { status: 'error', errors: [{ check: 'InputError', severity: 'error', message: e.message }], warnings: [], infos: [] };
      }
      const fileExists = existsSync(absPath);
      const isPreWrite = !fileExists;

      const uri = toUri(absPath);
      const isLiquid = file_path.endsWith('.liquid');
      const isGraphql = file_path.endsWith('.graphql');
      const isSchema = file_path.endsWith('.yml') && /(?:^|\/)app\/schema\//.test(file_path);

      const result = {
        errors: [],
        warnings: [],
        infos: [],
        proposed_fixes: [],
        clusters: [],
        scorecard: [],
        tips: [],
        domain_guide: null,
        structural: null,
      };

      // Frontmatter-only page detection — flagged and pushed AFTER the lint
      // pass (section 2), because section 2 reassigns result.warnings from the
      // enriched lint output and would blow away anything pushed earlier.
      // Computed here as a boolean, pushed further down.
      const isPage = /(?:^|\/)app\/views\/pages\//.test(file_path);
      const isFrontmatterOnlyPage = isLiquid && isPage &&
        content.replace(/^---[\s\S]*?---\s*/m, '').trim() === '';

      // 1. Parse (Liquid only)
      let ast = null;
      if (isLiquid) {
        ast = parseLiquidFile(content);
        if (!ast) {
          result.parse_error = 'Liquid parse failed — fix syntax errors before other issues can be detected';
        } else {
          const extracted = extractAllFromAST(ast);
          result.structural = {
            renders_used: extracted.renders,
            graphql_queries_used: extracted.graphql,
            filters_used: [...extracted.filters],
            tags_used: [...extracted.tags],
            translation_keys: [...extracted.transKeys],
            doc_params: [...extracted.docParams],
            slug: extracted.slug,
            layout: extracted.layout,
            method: extracted.method,
            prompts: extracted.prompts,
          };
        }
      }

      // 2. Lint — use LSP for fast per-document diagnostics.
      // LSP is warmed up on server start, so it returns complete diagnostics immediately.
      try {
        let checkResult;
        const useLsp = ctx.lsp?.initialized;

        if (useLsp) {
          // LSP path: Always wait for LSP to be fully ready (including warm-up) BEFORE requesting diagnostics.
          // This ensures the LSP has completed initialization and project indexing.
          await ctx.awaitLsp();

          // Now sync content to LSP server and await per-document diagnostics (~200ms)
          try {
            const lspDiags = await ctx.lsp.awaitDiagnostics(uri, content, LSP_DIAGNOSTICS_TIMEOUT_MS);
            checkResult = normalizeLspDiagnostics(lspDiags, file_path);
          } catch (e) {
            ctx.log?.(`LSP diagnostics failed, falling back to pos-cli check: ${e.message}`);
            checkResult = await checkContent({
              cmd: ctx.checkCmd, args: ctx.checkArgs,
              directory: ctx.directory, filePath: file_path, content, log: ctx.log,
            });
          }
        } else {
          // Fallback: pos-cli check subprocess (full project scan)
          checkResult = await checkContent({
            cmd: ctx.checkCmd, args: ctx.checkArgs,
            directory: ctx.directory, filePath: file_path, content, log: ctx.log,
          });
        }

        // Ensure LSP is ready for enrichment
        if (ctx.lsp?.initialized) {
          await ctx.awaitLsp();
        }

        const enrichCtx = {
          uri,
          lsp: ctx.lsp,
          filtersIndex: ctx.filtersIndex,
          objectsIndex: ctx.objectsIndex,
          tagsIndex: ctx.tagsIndex,
          schemaIndex: ctx.schemaIndex,
          content,
        };

        // Enrich all diagnostics in both quick and full modes.
        // Enrichment is critical for correct classification (e.g., detecting Shopify contamination).
        // In full mode, enrichment also adds suggestions and completions.
        result.errors = await enrichAll(checkResult.errors, enrichCtx);
        result.warnings = await enrichAll(checkResult.warnings, enrichCtx);

        // Auto-enrich: for errors without suggestions, attempt LSP completions (full mode only)
        if (mode === 'full') {
          // Skip checks where Liquid completions are meaningless (asset/HTML/GraphQL errors)
          const SKIP_COMPLETIONS = new Set([
            'MissingAsset', 'ParserBlockingScript', 'ImgWidthAndHeight', 'ImgLazyLoading',
            'LiquidHTMLSyntaxError', 'GraphQLCheck', 'NestedGraphQLQuery',
          ]);
          const needsDeeper = result.errors.filter(e => !e.suggestion && e.line != null && !SKIP_COMPLETIONS.has(e.check));
          if (needsDeeper.length > 0) {
            await Promise.all(needsDeeper.map(async (e) => {
              try {
                const completions = await ctx.lsp.completions(uri, e.line, e.column ?? 0);
                const items = Array.isArray(completions) ? completions : (completions?.items ?? []);
                if (items.length > 0) {
                  e.completions = items.slice(0, 10).map(i => i.label ?? i.insertText).filter(Boolean);
                }
              } catch { /* completions failed — skip */ }
            }));
          }
        }

        result.infos = checkResult.infos ?? [];
      } catch (e) {
        result.infos.push({ check: 'pos-cli', severity: 'info', message: `Linter unavailable: ${e.message}` });
      }

      // 2a. Context-aware diagnostic post-processing pipeline
      // Suppress/downgrade false positives for platformOS patterns (see diagnostic-pipeline.js)
      if (isLiquid && result.structural) {
        runDiagnosticPipeline(result, {
          filePath: file_path,
          content,
          docParamNames: new Set(result.structural.doc_params ?? []),
          pendingFiles: pending_files,
          pendingPages: pending_pages,
          pendingTranslations: pending_translations,
          projectDir: ctx.directory,
        });
      } else {
        // MissingAsset check runs regardless of liquid/structural (also applies to GraphQL etc.)
        runDiagnosticPipeline(result, {
          filePath: file_path,
          content,
          pendingFiles: pending_files,
          pendingPages: pending_pages,
          pendingTranslations: pending_translations,
          projectDir: ctx.directory,
        });
      }

      // 2b. Schema validation (YAML schema files only)
      if (isSchema) {
        try {
          const schemaResult = validateSchema(content, file_path);
          result.errors.push(...schemaResult.errors);
          result.warnings.push(...schemaResult.warnings);
          // schema errors flow into result.errors — status derived at the end
        } catch (e) {
          result.infos.push({ check: 'schema-validator', severity: 'info', message: `Schema validation failed: ${e.message}` });
        }
      }

      // 2b2. Schema property cross-check (GraphQL files only)
      if (isGraphql) {
        try {
          const propResult = checkSchemaProperties(content, file_path, ctx.directory);
          result.warnings.push(...propResult.warnings);
        } catch (e) {
          result.infos.push({ check: 'schema-property-checker', severity: 'info', message: `Schema property check failed: ${e.message}` });
        }
      }

      // 2c. Structural warnings — pos-supervisor intelligence beyond the linter (both quick and full)
      if (ast) {
        try {
          // Build set of checks already reported by linter (to avoid duplicates)
          const existingChecks = new Set();
          for (const d of [...result.errors, ...result.warnings]) {
            existingChecks.add(d.check);
            // Also track per-variable UndefinedObject to avoid Shopify duplicates
            if (d.check === 'UndefinedObject') {
              const varMatch = d.message?.match(/`([^`]+)`/);
              if (varMatch) existingChecks.add(`UndefinedObject:${varMatch[1]}`);
            }
            // Track per-tag DeprecatedTag to suppress duplicate structural warnings
            if (d.check === 'DeprecatedTag') {
              const tagMatch = d.message?.match(/tag\s+[`'"](\w+)[`'"]/i);
              if (tagMatch) existingChecks.add(`DeprecatedTag:${tagMatch[1]}`);
            }
          }

          const structResults = generateStructuralWarnings(
            ast, content, absPath, result.structural, existingChecks, { projectDir: ctx.directory }
          );
          for (const s of structResults) {
            if (s.severity === 'error') {
              result.errors.push(s);
            } else {
              result.warnings.push(s);
            }
          }
          // structural errors flow into result.errors — status derived at the end
        } catch (e) {
          ctx.log?.(`Structural warnings failed for ${file_path}: ${e.message}`);
        }
      }

      // 2d. Diff-aware comparison — detect removed functionality on update (full mode)
      if (isLiquid && fileExists && result.structural && mode === 'full') {
        try {
          const oldContent = readFileSync(absPath, 'utf8');
          const oldAst = parseLiquidFile(oldContent);
          if (oldAst) {
            const oldExtracted = extractAllFromAST(oldAst);
            const newRenders = new Set(result.structural.renders_used);
            const newGraphql = new Set(result.structural.graphql_queries_used.map(g => g.queryName ?? g));
            const newParams = new Set(result.structural.doc_params);

            const removedRenders = oldExtracted.renders.filter(r => !newRenders.has(r));
            const removedGraphql = oldExtracted.graphql.filter(g => !newGraphql.has(g.queryName ?? g));
            const removedParams = [...oldExtracted.docParams].filter(p => !newParams.has(p));

            if (removedRenders.length > 0) {
              result.warnings.push({
                check: 'pos-supervisor:RemovedRender',
                severity: 'warning',
                message: `Update removes render call(s): ${removedRenders.map(r => `'${r}'`).join(', ')}. Verify this is intentional — removing a render breaks the page for users.`,
              });
            }
            if (removedGraphql.length > 0) {
              result.warnings.push({
                check: 'pos-supervisor:RemovedGraphQL',
                severity: 'warning',
                message: `Update removes GraphQL call(s): ${removedGraphql.map(g => `'${g.queryName ?? g}'`).join(', ')}. Verify this is intentional — data may no longer be fetched.`,
              });
            }
            if (removedParams.length > 0) {
              result.warnings.push({
                check: 'pos-supervisor:RemovedParam',
                severity: 'warning',
                message: `Update removes @param(s): ${removedParams.map(p => `'${p}'`).join(', ')}. Callers passing these parameters will break.`,
              });
            }

            // Detect ADDED params — callers that don't pass them will trigger MissingRenderPartialArguments
            const addedParams = [...newParams].filter(p => !oldExtracted.docParams.has(p));
            if (addedParams.length > 0 && file_path.includes('app/views/partials/')) {
              const partialName = file_path
                .replace(/^app\/views\/partials\//, '')
                .replace(/\.html\.liquid$/, '')
                .replace(/\.liquid$/, '');
              try {
                const projectMap = await getProjectMap(ctx.directory);
                const rawCallers = projectMap.partials?.[partialName]?.rendered_by ?? [];
                const { pending: pendingCallers, remaining: externalCallers } =
                  partitionCallersByPending(rawCallers, pending_files);
                if (externalCallers.length > 0) {
                  const pendingNote = pendingCallers.length > 0
                    ? ` (${pendingCallers.length} additional caller(s) are in the current plan and will be updated there: ${pendingCallers.slice(0, 5).join(', ')}${pendingCallers.length > 5 ? ` (+${pendingCallers.length - 5} more)` : ''}.)`
                    : '';
                  result.warnings.push({
                    check: 'pos-supervisor:AddedParam',
                    severity: 'warning',
                    message: `Adding @param(s) ${addedParams.map(p => `'${p}'`).join(', ')} will break ${externalCallers.length} caller(s) that don't pass them yet: ${externalCallers.slice(0, 10).join(', ')}${externalCallers.length > 10 ? ` (+${externalCallers.length - 10} more)` : ''}. Each caller must be updated to pass the new parameter(s).${pendingNote}`,
                  });
                } else if (pendingCallers.length > 0) {
                  // All callers are in the pending plan — the agent is already updating them.
                  result.infos.push({
                    check: 'pos-supervisor:AddedParamAllPending',
                    severity: 'info',
                    message: `Adding @param(s) ${addedParams.map(p => `'${p}'`).join(', ')} affects ${pendingCallers.length} caller(s), all included in the current plan: ${pendingCallers.slice(0, 10).join(', ')}${pendingCallers.length > 10 ? ` (+${pendingCallers.length - 10} more)` : ''}.`,
                  });
                }
              } catch {
                // Project map unavailable — still emit a generic warning
                result.warnings.push({
                  check: 'pos-supervisor:AddedParam',
                  severity: 'warning',
                  message: `Adding @param(s) ${addedParams.map(p => `'${p}'`).join(', ')} to this partial will break any callers that don't pass them. Run project_map to identify affected files.`,
                });
              }
            }
          }
        } catch (e) {
          ctx.log?.(`Diff comparison failed for ${file_path}: ${e.message}`);
        }
      }

      // 2e. New partial with @params — check if existing callers need updating
      if (isPreWrite && isLiquid && result.structural?.doc_params?.length > 0) {
        try {
          const callerDiag = await checkNewPartialCallers(
            file_path, result.structural.doc_params, ctx.directory, pending_files,
          );
          if (callerDiag?.severity === 'warning') result.warnings.push(callerDiag);
          else if (callerDiag?.severity === 'info') result.infos.push(callerDiag);
        } catch (e) {
          ctx.log?.(`Cross-file caller check failed for ${file_path}: ${e.message}`);
        }
      }

      // 3. Domain knowledge — triggered gotchas from knowledge.json (full mode)
      if (mode === 'full') {
        const domain = getDomainFromPath(absPath);
        if (domain) {
          // Build trigger context from check results and structural analysis
          const checkNames = new Set([
            ...result.errors.map(e => e.check),
            ...result.warnings.map(w => w.check),
          ]);
          const tagsUsed = new Set(result.structural?.tags_used ?? []);
          const filtersUsed = new Set(result.structural?.filters_used ?? []);

          const triggered = getTriggeredGotchas(domain, {
            checks: checkNames,
            tags: tagsUsed,
            filters: filtersUsed,
          });

          if (triggered) {
            // Map gotchas to the error checks they relate to
            const gotchasWithErrors = triggered.gotchas.map(g => {
              const entry = { id: g.id, message: g.message, severity: g.severity };
              // Link gotcha to specific error checks present in this validation
              const related = [];
              for (const check of checkNames) {
                if (g.message.toLowerCase().includes(check.toLowerCase().replace('pos-supervisor:', ''))) {
                  related.push(check);
                }
              }
              if (related.length > 0) entry.applies_to_errors = related;
              return entry;
            });

            result.domain_guide = {
              domain,
              rule: triggered.rule,
              triggered_gotchas: gotchasWithErrors,
            };
          }
        }
      }

      // 4. Generate proposed fixes (full mode, Liquid files with diagnostics)
      if (mode === 'full' && (result.errors.length > 0 || result.warnings.length > 0)) {
        try {
          const allDiagnostics = [
            ...result.errors.map((e, i) => ({ ...e, _origIdx: i, _origType: 'error' })),
            ...result.warnings.map((w, i) => ({ ...w, _origIdx: i, _origType: 'warning' })),
          ];

          const { proposedFixes, diagnosticFixes } = generateFixes(
            allDiagnostics, ast, content, file_path,
            {
              objectsIndex: ctx.objectsIndex,
              filtersIndex: ctx.filtersIndex,
              tagsIndex: ctx.tagsIndex,
              schemaIndex: ctx.schemaIndex,
            },
            ctx.directory,
          );

          result.proposed_fixes = proposedFixes;

          // Attach per-diagnostic fix field
          for (const [diagIdx, fix] of diagnosticFixes) {
            const d = allDiagnostics[diagIdx];
            if (d._origType === 'error') {
              result.errors[d._origIdx].fix = fix;
            } else {
              result.warnings[d._origIdx].fix = fix;
            }
          }
        } catch (e) {
          // Fix generation is best-effort — don't fail the whole tool
          result.infos.push({
            check: 'fix-generator',
            severity: 'info',
            message: `Fix generation failed: ${e.message}`,
          });
        }
      }

      // 5. Content-triggered proactive tips (full mode)
      if (mode === 'full') {
        const domain = getDomainFromPath(absPath);
        if (domain) {
          try {
            const triggers = getContentTriggers(content, domain);
            for (const t of triggers) {
              result.tips.push({ id: t.id, severity: t.severity, message: t.message });
            }
          } catch {
            // Content triggers are best-effort
          }
        }

        // 5b. Scaffold-preventable error detection
        // When we see errors that scaffold would have prevented, tell the agent
        try {
          const scaffoldHints = detectScaffoldPreventableErrors(content, result.errors, result.warnings);
          for (const h of scaffoldHints) {
            result.tips.push(h);
          }
        } catch {
          // Best-effort
        }
      }

      // 6. Error clustering (reduce noise for repeated check types)
      if (mode === 'full' && (result.errors.length + result.warnings.length) >= 2) {
        try {
          result.clusters = clusterDiagnostics(result.errors, result.warnings);
        } catch {
          // Clustering is best-effort
        }
      }

      // 7. Architecture scorecard (full mode, Liquid files)
      if (mode === 'full' && isLiquid && result.structural) {
        try {
          const domain = getDomainFromPath(absPath);
          result.scorecard = generateScorecard(result.structural, domain, result.errors, result.warnings);
        } catch {
          // Scorecard is best-effort
        }
      }

      // 8. Session-aware error loop detection (advisory, never blocks)
      if (ctx.session?.fileHistory) {
        const history = ctx.session.fileHistory.get(file_path);
        if (history && history.consecutiveNonDecreasing >= CONSECUTIVE_ERROR_THRESHOLD && history.lastErrorCount > 0) {
          result.note = `This file has been validated ${history.calls} times with ${history.lastErrorCount} persistent error(s). ` +
            `The current approach may not be working. Consider: calling enrich_error on a specific error, ` +
            `reviewing domain_guide for the relevant domain, or asking the user for guidance.`;
        }
      }

      // 8a. Frontmatter-only page advisory (Phase 4). Pushed here so it survives
      // section 2's result.warnings reassignment from the lint pass.
      if (isFrontmatterOnlyPage) {
        result.warnings.push({
          check: 'pos-supervisor:FrontmatterOnlyPage',
          severity: 'warning',
          message: `Page '${file_path}' has frontmatter but no body — the rendered output will be empty. ` +
            `If this is intentional (redirect-only page, header-driven response), add a body comment to ` +
            `acknowledge the empty body; otherwise add the page content.`,
        });
      }

      // 9. Derive status — single source of truth, computed once after all mutations
      result.status = result.errors.length > 0
        ? 'error'
        : result.warnings.length > 0
          ? 'warning'
          : 'ok';

      // 9a. Structured blocking-gate field.
      //
      // `status` is advisory — agents sometimes read `status !== 'error'` as
      // "safe to write" and ship a file with silent cross-file damage (new
      // @param that callers don't pass, removed render that breaks a page,
      // etc.). `must_fix_before_write` is a hard boolean the agent cannot
      // mis-interpret. It is true whenever:
      //   - there is at least one error, OR
      //   - there is a warning whose check name is in BLOCKING_WARNINGS.
      // Everything else (benign warnings, infos) is write-safe.
      const blockingWarnings = result.warnings.filter(w => BLOCKING_WARNINGS.has(w.check));
      result.must_fix_before_write = result.errors.length > 0 || blockingWarnings.length > 0;

      // 10. Next step guidance — branches on must_fix_before_write, NOT status.
      if (!result.must_fix_before_write) {
        // Either status:'ok' or status:'warning' with no blocking warnings.
        // The agent may proceed, but we still surface any non-blocking warnings
        // so they are not silently accepted.
        result.next_step = result.status === 'ok'
          ? 'File validated. Write it to disk now.'
          : 'File has advisory warnings but none block the write. Review the warnings, then write the file to disk.';
      } else {
        const parts = [];
        if (result.errors.length > 0) {
          parts.push(`Fix every ERROR above.`);
        }
        if (blockingWarnings.length > 0) {
          const names = [...new Set(blockingWarnings.map(w => w.check))].join(', ');
          parts.push(`Fix every BLOCKING WARNING above (${names}). These break callers or drop functionality — they MUST be resolved before write.`);
        }
        if (result.proposed_fixes.length > 0) {
          parts.push(`${result.proposed_fixes.length} proposed fix(es) available — apply them first.`);
        }
        parts.push(`Re-validate with validate_code (mode: "quick") after fixing.`);
        parts.push(`MUST NOT write the file to disk until validation passes (must_fix_before_write: false).`);
        result.next_step = parts.join('\n');
      }

      // 11. Convert 0-based line numbers to 1-based for agent consumption
      // LSP and pos-cli check both use 0-based lines internally.
      // Agents and editors use 1-based (cat -n, Read tool, IDE line numbers).
      // Without this conversion, "line 7, column 11" points at {% liquid %}
      // instead of the actual function call on the next line.
      for (const d of [...result.errors, ...result.warnings, ...result.infos]) {
        if (d.line != null) d.line += 1;
        if (d.endLine != null) d.endLine += 1;
      }

      // 12. Strip null hint fields — diagnostics without hints should omit the field
      // entirely rather than returning hint: null which looks like a bug in the output.
      for (const d of [...result.errors, ...result.warnings, ...result.infos]) {
        if (d.hint === null || d.hint === undefined) delete d.hint;
      }

      // 13. Emit validator_emit events — one per diagnostic shown to the agent.
      // Best-effort: failures never propagate into the tool response.
      if (ctx.sessionBus) {
        try {
          const contentHash = ctx.blobStore ? ctx.blobStore.put(content) : null;
          for (const d of [...result.errors, ...result.warnings]) {
            const tmpl = messageTemplate(d.message || '');
            const fp = fingerprint(d.check, file_path, tmpl);
            const tFp = templateFingerprint(d.check, tmpl);
            const hintHash = d.hint && ctx.blobStore ? ctx.blobStore.put(d.hint) : null;
            const fixes = (d.proposed_fixes || []).map(f => ({
              range: f.range ?? null,
              new_text_hash: ctx.blobStore ? ctx.blobStore.put(f.newText || '') : '',
              kind: f.kind || 'unknown',
            }));
            ctx.sessionBus.emit('validator_emit', {
              fp,
              template_fp: tFp,
              file: file_path,
              content_hash: contentHash,
              hint_md_hash: hintHash,
              hint_rule_id: d.check || null,
              proposed_fixes: fixes,
            });
          }
        } catch { /* best-effort telemetry */ }
      }

      return result;
    };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Merge an array param with a Set from session state into a deduplicated array.
 * Explicit params and session state are both valid inputs — this gives the agent
 * a choice of where to put pending state without ever losing it. Missing or empty
 * inputs are fine; the result is always an array.
 */
function unionUnique(paramArr, sessionSet) {
  const out = new Set();
  if (Array.isArray(paramArr)) for (const v of paramArr) if (v) out.add(v);
  if (sessionSet && typeof sessionSet.forEach === 'function') {
    sessionSet.forEach(v => { if (v) out.add(v); });
  }
  return [...out];
}

// ── Scaffold-preventable error detection ───────────────────────────────────

/**
 * Detect patterns in code that the scaffold tool would have generated correctly.
 * Returns tips suggesting the agent should use scaffold output as-is.
 */
function detectScaffoldPreventableErrors(content, errors, warnings) {
  const tips = [];
  const allDiags = [...errors, ...warnings];

  // Detect deprecated {% include %} usage (scaffold uses {% function %})
  if (/\{%[-\s]*include\s/.test(content)) {
    tips.push({
      id: 'scaffold_include_deprecated',
      severity: 'warning',
      message: 'This file uses deprecated {% include %} tag. The scaffold tool generates code with the modern {% function %} tag. If you used scaffold to generate this code, write the scaffold output exactly as returned — do not substitute {% include %} for {% function %}.',
    });
  }

  // Detect deprecated {% hash_assign %} usage (scaffold uses parse_json)
  if (/\{%[-\s]*hash_assign\s/.test(content)) {
    tips.push({
      id: 'scaffold_hash_assign_deprecated',
      severity: 'warning',
      message: 'This file uses deprecated {% hash_assign %} tag. The scaffold tool generates code with {% assign %} bracket notation or {% parse_json %}. If you used scaffold, write its output exactly as returned.',
    });
  }

  // Detect missing | json filter inside parse_json blocks
  const parseJsonBlocks = content.match(/\{%\s*parse_json[\s\S]*?\{%\s*endparse_json\s*%\}/g);
  if (parseJsonBlocks) {
    for (const block of parseJsonBlocks) {
      // Look for {{ var }} without | json inside parse_json
      const interpolations = block.match(/\{\{[^}]+\}\}/g);
      if (interpolations) {
        const missingJson = interpolations.filter(i => !i.includes('| json'));
        if (missingJson.length > 0) {
          tips.push({
            id: 'scaffold_missing_json_filter',
            severity: 'warning',
            message: `Found {{ variable }} without | json filter inside parse_json block. This causes injection bugs. The scaffold tool always generates {{ variable | json }}. If you used scaffold, write its output exactly as returned.`,
          });
          break;
        }
      }
    }
  }

  // Detect wrong GraphQL accessor patterns (e.g., property() where property_int() is needed)
  const hasDeprecatedIncludeAuth = /include\s+['"]modules\/user\/helpers\/can_do_or_unauthorized['"]/.test(content);
  if (hasDeprecatedIncludeAuth) {
    tips.push({
      id: 'scaffold_include_auth',
      severity: 'warning',
      message: 'Authorization uses deprecated {% include %} syntax. The scaffold tool generates: {% function _ = \'modules/user/helpers/can_do_or_unauthorized\', requester: profile, do: \'...\' %}. Write scaffold output exactly as returned.',
    });
  }

  // If multiple scaffold-preventable issues found, add a summary tip
  if (tips.length >= 2) {
    tips.push({
      id: 'scaffold_use_as_is',
      severity: 'warning',
      message: 'Multiple scaffold-preventable errors detected. If you generated this code with the scaffold tool, you MUST write the scaffold output character-for-character. Do NOT rewrite, rephrase, or "improve" it. The scaffold output is pre-validated production code.',
    });
  }

  return tips;
}

// ── New partial caller detection ────────────────────────────────────────────

/**
 * When creating a NEW partial that declares @params, check if existing files
 * already render it. Those callers don't pass the new params — warn the agent.
 *
 * Unlike section 2d (diff-aware AddedParam for updates), this handles the
 * creation case where the file doesn't exist on disk yet. Since the partial
 * isn't in project_map's partials map, we scan pages/partials renders directly.
 *
 * @param {string} filePath - Relative file path (e.g. 'app/views/partials/products/card.liquid')
 * @param {string[]} docParams - Declared @param names in the new content
 * @param {string} projectDir - Absolute project root
 * @returns {Promise<object|null>} Warning diagnostic or null
 */
async function checkNewPartialCallers(filePath, docParams, projectDir, pendingFiles = []) {
  if (!filePath.includes('app/views/partials/')) return null;

  const partialName = filePath
    .replace(/^app\/views\/partials\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');

  const projectMap = await getProjectMap(projectDir);
  const rawCallers = findCallersInProjectMap(projectMap, partialName);
  if (rawCallers.length === 0) return null;

  const { pending: pendingCallers, remaining: externalCallers } =
    partitionCallersByPending(rawCallers, pendingFiles);

  if (externalCallers.length === 0 && pendingCallers.length > 0) {
    return {
      check: 'pos-supervisor:NewPartialParamsAllPending',
      severity: 'info',
      message:
        `New partial declares @param(s) ${docParams.map(p => `'${p}'`).join(', ')}; ` +
        `${pendingCallers.length} existing caller(s) of '${partialName}' are all in the current plan ` +
        `and will be updated there: ${pendingCallers.slice(0, 10).join(', ')}` +
        `${pendingCallers.length > 10 ? ` (+${pendingCallers.length - 10} more)` : ''}.`,
    };
  }

  const pendingNote = pendingCallers.length > 0
    ? ` (${pendingCallers.length} additional caller(s) are in the current plan and will be updated there.)`
    : '';

  return {
    check: 'pos-supervisor:NewPartialParams',
    severity: 'warning',
    message: `New partial declares @param(s) ${docParams.map(p => `'${p}'`).join(', ')} ` +
      `but ${externalCallers.length} existing file(s) already render '${partialName}' without passing them: ` +
      `${externalCallers.slice(0, 10).join(', ')}${externalCallers.length > 10 ? ` (+${externalCallers.length - 10} more)` : ''}. ` +
      `Each caller must be updated to pass the required parameter(s).${pendingNote}`,
  };
}

/**
 * Find all files that render a given partial name by scanning project_map entries.
 * Works for partials that don't exist on disk yet (no rendered_by in project_map).
 */
function findCallersInProjectMap(projectMap, partialName) {
  const callers = [];

  for (const page of Object.values(projectMap.pages ?? {})) {
    if (page.renders?.includes(partialName)) {
      callers.push(page.path);
    }
  }

  for (const [, partial] of Object.entries(projectMap.partials ?? {})) {
    if (partial.renders?.includes(partialName)) {
      callers.push(partial.path);
    }
  }

  for (const [path, cmd] of Object.entries(projectMap.commands ?? {})) {
    if (cmd.renders?.includes(partialName)) {
      callers.push(path);
    }
  }

  return callers;
}
