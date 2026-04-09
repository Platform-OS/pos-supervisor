/**
 * Diagnostic post-processing pipeline.
 *
 * Extracted from validate-code.js for testability and clear ordering.
 * Each filter is a named function that mutates result.{errors, warnings, infos}
 * and is documented with its purpose and ordering dependencies.
 *
 * ORDERING CONTRACT:
 *   1. suppressDocParams       — must run before Shopify elevation (doc params may look like Shopify objects)
 *   2. suppressUnusedDocParams — depends on content, independent of other filters
 *   3. elevateShopify          — must run after enrichment (needs .suggestion field)
 *   4. deduplicateArgChecks    — must run after linting (needs MissingRenderPartialArguments + MetadataParamsCheck)
 *   5. suppressModuleHelpers   — independent
 *   6. suppressOrphanedPartial — independent
 *   7. suppressPendingFiles    — must run before pre-write downgrade (removes refs first)
 *   8. suppressPendingTranslations — independent
 *   9. downgradePreWrite       — must run after pending suppression
 *  10. downgradeTranslationKeys — independent
 *  11. verifyMissingAssets     — independent (filesystem check)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Run the full diagnostic post-processing pipeline.
 *
 * @param {object} result — { errors: [], warnings: [], infos: [] } (mutated in place)
 * @param {object} opts
 * @param {string} opts.filePath — relative file path
 * @param {string} opts.content — file content
 * @param {Set<string>} opts.docParamNames — declared @param names
 * @param {string[]} opts.pendingFiles — files being created soon
 * @param {string[]} opts.pendingTranslations — translation keys being created soon
 * @param {boolean} opts.isPreWrite — file doesn't exist on disk yet
 * @param {string} opts.mode — 'full' or 'quick'
 * @param {string} opts.projectDir — project root directory
 */
export function runDiagnosticPipeline(result, opts) {
  const {
    filePath,
    content,
    docParamNames = new Set(),
    pendingFiles = [],
    pendingTranslations = [],
    isPreWrite = false,
    mode = 'full',
    projectDir,
  } = opts;

  // 1. Suppress UndefinedObject for declared @param names
  if (docParamNames.size > 0) {
    suppressDocParams(result, docParamNames);
  }

  // 2. Suppress UnusedDocParam when param is used as named argument
  if (docParamNames.size > 0) {
    suppressUnusedDocParams(result, docParamNames, content);
  }

  // 3. Elevate Shopify contamination from warning to error
  elevateShopify(result);

  // 4. Deduplicate MissingRenderPartialArguments + MetadataParamsCheck
  deduplicateArgChecks(result);

  // 5. Suppress DeprecatedTag for module helper includes
  suppressModuleHelpers(result, content);

  // 6. Suppress OrphanedPartial for commands/queries
  suppressOrphanedPartial(result, filePath);

  // 7. Suppress MissingPartial for pending files
  if (pendingFiles.length > 0) {
    suppressPendingFiles(result, pendingFiles);
  }

  // 8. Suppress TranslationKeyExists for pending translations
  if (pendingTranslations.length > 0) {
    suppressPendingTranslations(result, pendingTranslations);
  }

  // 9. Pre-write mode: downgrade MissingPartial errors to warnings
  if (isPreWrite && mode === 'full') {
    downgradePreWrite(result);
  }

  // 10. Downgrade TranslationKeyExists to info
  downgradeTranslationKeys(result);

  // 11. Verify MissingAsset against filesystem
  if (projectDir) {
    verifyMissingAssets(result, projectDir);
  }
}

// ── Individual filters ──────────────────────────────────────────────────────

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

function suppressOrphanedPartial(result, filePath) {
  if (/\/lib\/(commands|queries)\//.test(filePath)) {
    result.errors = result.errors.filter(d => d.check !== 'OrphanedPartial');
    result.warnings = result.warnings.filter(d => d.check !== 'OrphanedPartial');
  }
}

function suppressPendingFiles(result, pendingFiles) {
  const pendingNames = new Set();
  for (const f of pendingFiles) {
    pendingNames.add(f.replace(/^app\/views\/partials\//, '').replace(/\.liquid$/, ''));
    pendingNames.add(f.replace(/^app\/graphql\//, '').replace(/\.graphql$/, ''));
    pendingNames.add(f.replace(/^app\/lib\//, '').replace(/\.liquid$/, ''));
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

function suppressPendingTranslations(result, pendingTranslations) {
  const pendingTransSet = new Set(pendingTranslations);
  const isPendingTrans = (d) => {
    if (d.check !== 'TranslationKeyExists') return false;
    const keyMatch = d.message?.match(/['"]([^'"]+)['"]/);
    return keyMatch && pendingTransSet.has(keyMatch[1]);
  };
  result.errors = result.errors.filter(d => !isPendingTrans(d));
  result.warnings = result.warnings.filter(d => !isPendingTrans(d));
  result.infos = result.infos.filter(d => !isPendingTrans(d));
}

function downgradePreWrite(result) {
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

function downgradeTranslationKeys(result) {
  const missingTransKeys = result.errors.filter(d => d.check === 'TranslationKeyExists');
  if (missingTransKeys.length > 0) {
    result.errors = result.errors.filter(d => d.check !== 'TranslationKeyExists');
    for (const d of missingTransKeys) {
      result.infos.push({ ...d, severity: 'info', _downgraded: true,
        message: `${d.message} (advisory — translation key may not be indexed yet)` });
    }
  }
}

function verifyMissingAssets(result, projectDir) {
  const missingAssets = [...result.errors, ...result.warnings].filter(d => d.check === 'MissingAsset');
  if (missingAssets.length === 0) return;

  const verified = [];
  for (const d of missingAssets) {
    const pathMatch = d.message?.match(/['"`]([^'"`]+)['"`]/);
    if (pathMatch) {
      const assetPath = join(projectDir, 'app', 'assets', pathMatch[1]);
      if (existsSync(assetPath)) verified.push(d);
    }
  }
  if (verified.length > 0) {
    const verifiedSet = new Set(verified);
    result.errors = result.errors.filter(d => !verifiedSet.has(d));
    result.warnings = result.warnings.filter(d => !verifiedSet.has(d));
    result.infos.push({
      check: 'pos-supervisor:MissingAssetSuppressed',
      severity: 'info',
      message: `Suppressed ${verified.length} MissingAsset diagnostic(s) — referenced asset(s) exist on disk: ${verified.map(d => d.message?.match(/['"`]([^'"`]+)['"`]/)?.[1]).filter(Boolean).join(', ')}`,
    });
  }
}
