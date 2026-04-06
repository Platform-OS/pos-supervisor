import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLiquidFile, extractAllFromAST } from '../core/liquid-parser.js';
import { checkContent } from '../core/check-runner.js';
import { normalizeLspDiagnostics } from '../core/lsp-client.js';
import { enrichAll } from '../core/error-enricher.js';
import { generateFixes, clusterDiagnostics, generateScorecard } from '../core/fix-generator.js';
import { getDomainFromPath, getDomainHeader } from '../core/domain-detector.js';
import { getTriggeredGotchas, getContentTriggers } from '../core/knowledge-loader.js';
import { generateStructuralWarnings } from '../core/structural-warnings.js';
import { validateSchema } from '../core/schema-validator.js';
import { toUri, sanitizePath } from '../core/utils.js';
import { getProjectMap } from './project-map.js';

export const validateCodeTool = {
  name: 'validate_code',
  description: [
    'PURPOSE:',
    'Validate platformOS code content prior to any write/edit operation. Returns enriched diagnostics,',
    'fix hints, LSP intelligence, domain guidance, and structural analysis.',
    '',
    'You are STRICTLY PROHIBITED from:',
    'Writing, saving, or applying any changes to *.liquid, *.graphql, or *.yml files without first calling validate_code on the full proposed content to be written',
    'You MUST:',
    'Resolve all reported errors and warnings.',
    'Re-run validation until zero issues remain.',
    'Skipping or bypassing this step = FAIL.',
    '',
    'REQUIRED PROCEDURE:',
    '1. If editing an existing file: READ the file first, extract its FULL current content.',
    '2. Prepare the COMPLETE target content — full file text for new files; full updated text for edits (not a diff).',
    '3. Call validate_code with content = full file text.',
    '4. Fix every ERROR and WARNING in the result before writing.',
    '5. Only write the file after validate_code returns no errors or warnings.',
    '',
    'CONSTRAINTS:',
    '  - NEVER call validate_code with part of the content.',
    '  - NEVER pass a file path as the content parameter.',
    '  - NEVER skip validation regardless of confidence level.',
    '  - Validation must occur immediately before the write operation.',
    '',
    'If validate_intent was called before drafting, pass its pending_files and pending_translations',
    'here to suppress false-positive MissingPartial/TranslationKeyExists errors during multi-file creation.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Target file path (relative to project root, e.g. "app/views/pages/index.html.liquid")',
      },
      content: {
        type: 'string',
        description: 'The complete text content of the file — NOT a file path. Read the file first, then pass the full text here.',
      },
      mode: {
        type: 'string',
        enum: ['full', 'quick'],
        description: 'Validation mode. Both modes: parse + lint + enrichment (suggestions, Shopify detection) + structural warnings. Difference: "full" additionally provides LSP completions, fix proposals, domain guidance, and architectural scoring. "quick" is for rapid re-validation after applying fixes.',
      },
      pending_files: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths being created soon (suppresses MissingPartial for these). Use when writing scaffold output file-by-file.',
      },
      pending_translations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Translation keys being created soon (suppresses TranslationKeyExists for these).',
      },
    },
    required: ['file_path', 'content'],
  },

  createHandler(ctx) {
    return async (params) => {
      const { file_path, content, mode = 'full', pending_files = [], pending_translations = [] } = params;

      // Input validation
      if (!file_path || typeof file_path !== 'string') {
        return { valid: false, errors: [{ check: 'InputError', severity: 'error', message: 'file_path is required' }], warnings: [], infos: [] };
      }
      if (typeof content !== 'string') {
        return { valid: false, errors: [{ check: 'InputError', severity: 'error', message: 'content is required and must be a string' }], warnings: [], infos: [] };
      }
      // Catch agent mistakes: empty content, or passing a file path instead of file text
      const contentTrimmed = content.trim();
      if (
        contentTrimmed === '' ||
        content === file_path ||
        /^(app|modules)\/[^\n]+\.(liquid|graphql|yml)$/.test(contentTrimmed)
      ) {
        return {
          valid: false,
          errors: [{
            check: 'InputError',
            severity: 'error',
            message: `content must be the actual file text, not a path or empty string. ` +
              `Read the file first (e.g. via Read tool), then pass the full text here. ` +
              `Received: ${contentTrimmed === '' ? '(empty string)' : `"${content.slice(0, 80)}"`}`,
          }],
          warnings: [],
          infos: [],
        };
      }

      let absPath;
      try {
        absPath = sanitizePath(ctx.directory, file_path);
      } catch (e) {
        return { valid: false, errors: [{ check: 'InputError', severity: 'error', message: e.message }], warnings: [], infos: [] };
      }
      const fileExists = existsSync(absPath);
      const isPreWrite = !fileExists;

      const uri = toUri(absPath);
      const isLiquid = file_path.endsWith('.liquid');
      const isSchema = file_path.endsWith('.yml') && /(?:^|\/)app\/schema\//.test(file_path);

      const result = {
        valid: true,
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
            const lspDiags = await ctx.lsp.awaitDiagnostics(uri, content, 5000);
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

      // 2a. Context-aware diagnostic post-processing
      // Suppress/downgrade diagnostics that are false positives in platformOS patterns
      if (isLiquid && result.structural) {
        const domain = getDomainFromPath(absPath);
        const docParamNames = new Set(result.structural.doc_params ?? []);

        // UndefinedObject: suppress for {% doc %} @param names in commands/queries/partials
        if (docParamNames.size > 0) {
          const suppressUndefined = (diag) => {
            if (diag.check !== 'UndefinedObject') return false;
            const varMatch = diag.message?.match(/`([^`]+)`/);
            return varMatch && docParamNames.has(varMatch[1]);
          };
          const suppressed = [
            ...result.errors.filter(suppressUndefined),
            ...result.warnings.filter(suppressUndefined),
          ];
          if (suppressed.length > 0) {
            result.errors = result.errors.filter(d => !suppressUndefined(d));
            result.warnings = result.warnings.filter(d => !suppressUndefined(d));
            result.infos.push({
              check: 'pos-supervisor:DocParamSuppressed',
              severity: 'info',
              message: `Suppressed ${suppressed.length} UndefinedObject warning(s) for declared @param(s): ${[...docParamNames].join(', ')}`,
            });
          }
        }

        // UnusedDocParam: suppress when the param is used as a named argument in
        // graphql/function/render calls. The LSP only tracks Liquid variable usage
        // ({{ x }}, {% if x %}), not named argument passing (id: id).
        if (docParamNames.size > 0) {
          // Build a set of param names that appear as named args in the content
          // Matches: "paramName:" in graphql/function/render markup
          const usedAsArg = new Set();
          for (const name of docParamNames) {
            // Match "name:" preceded by comma/space (named arg context), NOT in {% doc %} block
            const argPattern = new RegExp(`(?:,|{%\\s*(?:graphql|function|render|include|theme_render_rc)\\b[^%]*)\\b${name}\\s*:`, 's');
            if (argPattern.test(content)) usedAsArg.add(name);
          }
          if (usedAsArg.size > 0) {
            const suppressUnused = (d) => {
              if (d.check !== 'UnusedDocParam') return false;
              const varMatch = d.message?.match(/['"`](\w+)['"`]/);
              return varMatch && usedAsArg.has(varMatch[1]);
            };
            const suppressed = [
              ...result.errors.filter(suppressUnused),
              ...result.warnings.filter(suppressUnused),
            ];
            if (suppressed.length > 0) {
              result.errors = result.errors.filter(d => !suppressUnused(d));
              result.warnings = result.warnings.filter(d => !suppressUnused(d));
              result.infos.push({
                check: 'pos-supervisor:UnusedDocParamSuppressed',
                severity: 'info',
                message: `Suppressed ${suppressed.length} UnusedDocParam warning(s) for @param(s) used as named arguments: ${[...usedAsArg].join(', ')}`,
              });
            }
          }
        }

        // Elevate Shopify contamination from warning to error
        // When the linter flags UndefinedObject and the enricher identifies it as Shopify,
        // move it from warnings to errors so it blocks valid=true.
        {
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

        // Deduplicate MissingRenderPartialArguments + MetadataParamsCheck
        // Both checks can fire at the same render tag line for the same missing @param.
        // MissingRenderPartialArguments is more specific — suppress redundant MetadataParamsCheck.
        {
          const mrpaLines = new Set([
            ...result.errors.filter(d => d.check === 'MissingRenderPartialArguments').map(d => d.line),
            ...result.warnings.filter(d => d.check === 'MissingRenderPartialArguments').map(d => d.line),
          ]);
          if (mrpaLines.size > 0) {
            const isRedundantMpc = (d) => d.check === 'MetadataParamsCheck' && mrpaLines.has(d.line);
            const suppressed = result.errors.filter(isRedundantMpc).length + result.warnings.filter(isRedundantMpc).length;
            if (suppressed > 0) {
              result.errors = result.errors.filter(d => !isRedundantMpc(d));
              result.warnings = result.warnings.filter(d => !isRedundantMpc(d));
              result.infos.push({
                check: 'pos-supervisor:DuplicateArgCheck',
                severity: 'info',
                message: `Suppressed ${suppressed} MetadataParamsCheck diagnostic(s) already covered by MissingRenderPartialArguments`,
              });
            }
          }
        }

        // Suppress DeprecatedTag for module helper includes
        // Module APIs (e.g., modules/user/helpers/can_do) use {% include %} deliberately
        // for scope sharing. Changing to {% render %} would break them.
        {
          const isModuleHelperInclude = (d) => {
            if (d.check !== 'DeprecatedTag') return false;
            return /include\s+['"]modules\/[^'"]*\/helpers\//.test(content) &&
              d.message?.includes('include');
          };
          const moduleHelperDeprecated = [
            ...result.errors.filter(isModuleHelperInclude),
            ...result.warnings.filter(isModuleHelperInclude),
          ];
          if (moduleHelperDeprecated.length > 0) {
            result.errors = result.errors.filter(d => !isModuleHelperInclude(d));
            result.warnings = result.warnings.filter(d => !isModuleHelperInclude(d));
            result.infos.push({
              check: 'pos-supervisor:ModuleHelperInclude',
              severity: 'info',
              message: `Suppressed ${moduleHelperDeprecated.length} DeprecatedTag warning(s) for module helper includes — modules use {% include %} for scope sharing by design.`,
            });
          }
        }

        // OrphanedPartial: suppress only for commands/queries.
        // The LSP tracks render/include references reliably — OrphanedPartial is correct
        // for actual partials. But commands/queries are called via {% function %} which
        // the LSP doesn't track, producing false positives for those file types.
        if (/\/lib\/(commands|queries)\//.test(file_path)) {
          result.errors = result.errors.filter(d => d.check !== 'OrphanedPartial');
          result.warnings = result.warnings.filter(d => d.check !== 'OrphanedPartial');
        }

        // Batch-aware suppression: fully suppress diagnostics for pending files/translations
        // Handles partials ({% render %}), graphql ({% graphql %}), and commands/queries ({% function %})
        if (pending_files.length > 0) {
          const pendingNames = new Set();
          for (const f of pending_files) {
            // Partial: app/views/partials/blog_posts/card.liquid → blog_posts/card
            pendingNames.add(f.replace(/^app\/views\/partials\//, '').replace(/\.liquid$/, ''));
            // GraphQL: app/graphql/blog_posts/search.graphql → blog_posts/search
            pendingNames.add(f.replace(/^app\/graphql\//, '').replace(/\.graphql$/, ''));
            // Command/Query: app/lib/commands/blog_posts/create.liquid → commands/blog_posts/create
            pendingNames.add(f.replace(/^app\/lib\//, '').replace(/\.liquid$/, ''));
            // Also keep the raw path for exact matches
            pendingNames.add(f);
          }
          const isPendingRef = (d) => {
            if (d.check !== 'MissingPartial') return false;
            const nameMatch = d.message?.match(/['"]([^'"]+)['"]/);
            return nameMatch && pendingNames.has(nameMatch[1]);
          };
          result.errors = result.errors.filter(d => !isPendingRef(d));
          result.warnings = result.warnings.filter(d => !isPendingRef(d));
          result.infos = result.infos.filter(d => !isPendingRef(d));
        }
        if (pending_translations.length > 0) {
          const pendingTransSet = new Set(pending_translations);
          const isPendingTrans = (d) => {
            if (d.check !== 'TranslationKeyExists') return false;
            const keyMatch = d.message?.match(/['"]([^'"]+)['"]/);
            return keyMatch && pendingTransSet.has(keyMatch[1]);
          };
          result.errors = result.errors.filter(d => !isPendingTrans(d));
          result.warnings = result.warnings.filter(d => !isPendingTrans(d));
          result.infos = result.infos.filter(d => !isPendingTrans(d));
        }

        // Pre-write mode: file doesn't exist on disk — MissingPartial errors for referenced files
        // are likely for files being created next in the sequence. Downgrade to warnings.
        // Only applies in full mode (pre-write is a semantic signal, not a syntax check).
        if (isPreWrite && mode === 'full') {
          const missingPartialErrors = result.errors.filter(d => d.check === 'MissingPartial');
          if (missingPartialErrors.length > 0) {
            result.errors = result.errors.filter(d => d.check !== 'MissingPartial');
            for (const d of missingPartialErrors) {
              result.warnings.push({
                ...d,
                severity: 'warning',
                message: `[pre-write] ${d.message}`,
              });
            }
          }
        }

        // TranslationKeyExists: downgrade from error to info (keys may not be indexed yet)
        const missingTransKeys = result.errors.filter(d => d.check === 'TranslationKeyExists');
        if (missingTransKeys.length > 0) {
          result.errors = result.errors.filter(d => d.check !== 'TranslationKeyExists');
          for (const d of missingTransKeys) {
            result.infos.push({ ...d, severity: 'info', _downgraded: true,
              message: `${d.message} (advisory — translation key may not be indexed yet)` });
          }
        }
      }

      result.valid = result.errors.length === 0;

      // MissingAsset: downgrade to info when the referenced asset actually exists on disk.
      // The LSP builds its file index at startup and doesn't track newly created files
      // during the session. Assets created mid-session are invisible to the LSP but
      // present on disk — check the filesystem to avoid false positives.
      {
        const missingAssets = [...result.errors, ...result.warnings].filter(d => d.check === 'MissingAsset');
        if (missingAssets.length > 0) {
          const verified = [];
          for (const d of missingAssets) {
            const pathMatch = d.message?.match(/['"`]([^'"`]+)['"`]/);
            if (pathMatch) {
              const assetPath = join(ctx.directory, 'app', 'assets', pathMatch[1]);
              if (existsSync(assetPath)) verified.push(d);
            }
          }
          if (verified.length > 0) {
            const verifiedSet = new Set(verified);
            result.errors = result.errors.filter(d => !verifiedSet.has(d));
            result.warnings = result.warnings.filter(d => !verifiedSet.has(d));
            result.valid = result.errors.length === 0;
            result.infos.push({
              check: 'pos-supervisor:MissingAssetSuppressed',
              severity: 'info',
              message: `Suppressed ${verified.length} MissingAsset diagnostic(s) — referenced asset(s) exist on disk: ${verified.map(d => d.message?.match(/['"`]([^'"`]+)['"`]/)?.[1]).filter(Boolean).join(', ')}`,
            });
          }
        }
      }

      // 2b. Schema validation (YAML schema files only)
      if (isSchema) {
        try {
          const schemaResult = validateSchema(content, file_path);
          result.errors.push(...schemaResult.errors);
          result.warnings.push(...schemaResult.warnings);
          if (schemaResult.errors.length > 0) result.valid = false;
        } catch (e) {
          result.infos.push({ check: 'schema-validator', severity: 'info', message: `Schema validation failed: ${e.message}` });
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
          if (structResults.some(s => s.severity === 'error')) {
            result.valid = false;
          }
        } catch {
          // Structural warnings are best-effort
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
                const callers = projectMap.partials?.[partialName]?.rendered_by ?? [];
                if (callers.length > 0) {
                  result.warnings.push({
                    check: 'pos-supervisor:AddedParam',
                    severity: 'warning',
                    message: `Adding @param(s) ${addedParams.map(p => `'${p}'`).join(', ')} will break ${callers.length} caller(s) that don't pass them yet: ${callers.slice(0, 10).join(', ')}${callers.length > 10 ? ` (+${callers.length - 10} more)` : ''}. Each caller must be updated to pass the new parameter(s).`,
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
        } catch {
          // Diff comparison is best-effort
        }
      }

      // 2e. New partial with @params — check if existing callers need updating
      if (isPreWrite && isLiquid && result.structural?.doc_params?.length > 0) {
        try {
          const callerWarning = await checkNewPartialCallers(
            file_path, result.structural.doc_params, ctx.directory,
          );
          if (callerWarning) result.warnings.push(callerWarning);
        } catch {
          // Cross-file check is best-effort
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
        if (history && history.consecutiveNonDecreasing >= 3 && history.lastErrorCount > 0) {
          result.note = `This file has been validated ${history.calls} times with ${history.lastErrorCount} persistent error(s). ` +
            `The current approach may not be working. Consider: calling enrich_error on a specific error, ` +
            `reviewing domain_guide for the relevant domain, or asking the user for guidance.`;
        }
      }

      // 9. Next step guidance
      if (result.valid) {
        result.next_step = 'File validated. Write it to disk now.';
      } else {
        const parts = [
          `Fix every ERROR above. Apply proposed_fixes where available.`,
          `Re-validate with validate_code (mode: "quick") after fixing.`,
          `Do not write the file to disk until it passes validation.`,
        ];
        if (result.proposed_fixes.length > 0) {
          parts.unshift(`${result.proposed_fixes.length} proposed fix(es) available — apply them first.`);
        }
        result.next_step = parts.join('\n');
      }

      // 10. Convert 0-based line numbers to 1-based for agent consumption
      // LSP and pos-cli check both use 0-based lines internally.
      // Agents and editors use 1-based (cat -n, Read tool, IDE line numbers).
      // Without this conversion, "line 7, column 11" points at {% liquid %}
      // instead of the actual function call on the next line.
      for (const d of [...result.errors, ...result.warnings, ...result.infos]) {
        if (d.line != null) d.line += 1;
        if (d.endLine != null) d.endLine += 1;
      }

      // 11. Strip null hint fields — diagnostics without hints should omit the field
      // entirely rather than returning hint: null which looks like a bug in the output.
      for (const d of [...result.errors, ...result.warnings, ...result.infos]) {
        if (d.hint === null || d.hint === undefined) delete d.hint;
      }

      return result;
    };
  },
};

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
async function checkNewPartialCallers(filePath, docParams, projectDir) {
  if (!filePath.includes('app/views/partials/')) return null;

  const partialName = filePath
    .replace(/^app\/views\/partials\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');

  const projectMap = await getProjectMap(projectDir);
  const callers = findCallersInProjectMap(projectMap, partialName);
  if (callers.length === 0) return null;

  return {
    check: 'pos-supervisor:NewPartialParams',
    severity: 'warning',
    message: `New partial declares @param(s) ${docParams.map(p => `'${p}'`).join(', ')} ` +
      `but ${callers.length} existing file(s) already render '${partialName}' without passing them: ` +
      `${callers.slice(0, 10).join(', ')}${callers.length > 10 ? ` (+${callers.length - 10} more)` : ''}. ` +
      `Each caller must be updated to pass the required parameter(s).`,
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
