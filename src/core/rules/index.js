/**
 * Rule registry — auto-loads all rule modules from this directory.
 *
 * Each module exports `rules: Rule[]`. Call `loadAllRules()` once at startup
 * to populate the engine. Individual rule modules can also be loaded manually
 * via `registerRules()`.
 */
import { registerRules, clearRules, ruleCount } from './engine.js';
import { loadPromotedRules } from './promoted-rules.js';
import { isAdaptive } from '../engine-mode.js';
import { rules as MissingPartialRules } from './MissingPartial.js';
import { rules as UndefinedObjectRules } from './UndefinedObject.js';
import { rules as UnknownFilterRules } from './UnknownFilter.js';
import { rules as TranslationKeyExistsRules } from './TranslationKeyExists.js';
import { rules as UnusedAssignRules } from './UnusedAssign.js';
import { rules as MissingRenderPartialArgumentsRules } from './MissingRenderPartialArguments.js';
import { rules as UnknownPropertyRules } from './UnknownProperty.js';
import { rules as MetadataParamsCheckRules } from './MetadataParamsCheck.js';
import { rules as GraphQLCheckRules } from './GraphQLCheck.js';
import { rules as ImgLazyLoadingRules } from './ImgLazyLoading.js';
import { rules as ImgWidthAndHeightRules } from './ImgWidthAndHeight.js';
import { rules as ConvertIncludeToRenderRules } from './ConvertIncludeToRender.js';
import { rules as NonGetRenderingPageRules } from './NonGetRenderingPage.js';
import { rules as ValidFrontmatterRules } from './ValidFrontmatter.js';
import { rules as JsonLiteralQuoteStyleRules } from './JsonLiteralQuoteStyle.js';
import { rules as DuplicateFunctionArgumentsRules } from './DuplicateFunctionArguments.js';
import { rules as DeprecatedTagRules } from './DeprecatedTag.js';
import { rules as UnrecognizedRenderPartialArgumentsRules } from './UnrecognizedRenderPartialArguments.js';
import { rules as SchemaPropertyRules } from './SchemaProperty.js';
import { rules as SchemaYAMLRules } from './SchemaYAML.js';
import { rules as MissingSlugRules } from './MissingSlug.js';
import { rules as MissingContentForLayoutRules } from './MissingContentForLayout.js';
import { rules as ParserBlockingScriptRules } from './ParserBlockingScript.js';
import { rules as TranslationMissingLocaleKeyRules } from './TranslationMissingLocaleKey.js';
import { rules as MissingAssetRules } from './MissingAsset.js';
import { rules as OrphanedPartialRules } from './OrphanedPartial.js';
import { rules as MissingPageRules } from './MissingPage.js';
import { rules as LiquidHTMLSyntaxErrorRules } from './LiquidHTMLSyntaxError.js';
import { rules as InvalidLayoutRules } from './InvalidLayout.js';
import { rules as PartialCallArgumentsRules } from './PartialCallArguments.js';
import { rules as GraphQLVariablesCheckRules } from './GraphQLVariablesCheck.js';
import { rules as UnusedDocParamRules } from './UnusedDocParam.js';

const ALL_RULE_MODULES = [
  MissingPartialRules,
  UndefinedObjectRules,
  UnknownFilterRules,
  TranslationKeyExistsRules,
  UnusedAssignRules,
  MissingRenderPartialArgumentsRules,
  UnknownPropertyRules,
  MetadataParamsCheckRules,
  GraphQLCheckRules,
  ImgLazyLoadingRules,
  ImgWidthAndHeightRules,
  ConvertIncludeToRenderRules,
  NonGetRenderingPageRules,
  ValidFrontmatterRules,
  JsonLiteralQuoteStyleRules,
  DuplicateFunctionArgumentsRules,
  DeprecatedTagRules,
  UnrecognizedRenderPartialArgumentsRules,
  SchemaPropertyRules,
  SchemaYAMLRules,
  MissingSlugRules,
  MissingContentForLayoutRules,
  ParserBlockingScriptRules,
  TranslationMissingLocaleKeyRules,
  MissingAssetRules,
  OrphanedPartialRules,
  MissingPageRules,
  LiquidHTMLSyntaxErrorRules,
  InvalidLayoutRules,
  PartialCallArgumentsRules,
  GraphQLVariablesCheckRules,
  UnusedDocParamRules,
];

let _loaded = false;
let _promotedProjectDir = null;

export function loadAllRules() {
  if (_loaded) return;
  for (const rules of ALL_RULE_MODULES) {
    registerRules(rules);
  }
  _loaded = true;
}

export function initPromotedRules(projectDir) {
  _promotedProjectDir = projectDir;
  if (isAdaptive()) loadPromotedRules(projectDir);
}

export function reloadRules(projectDir) {
  clearRules();
  _loaded = false;
  loadAllRules();
  const dir = projectDir ?? _promotedProjectDir;
  if (dir && isAdaptive()) loadPromotedRules(dir);
}

export { ruleCount };
