/**
 * Tier-1 rule modules — attribution + hint only. The text_edit fix is produced
 * by fix-generator.js in full mode; these rules exist so the diagnostic gets
 * a stable rule_id (instead of `<Check>.unmatched`) and a useful hint in the
 * agent's response.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { rules as ImgLazyLoadingRules } from '../../../src/core/rules/ImgLazyLoading.js';
import { rules as ImgWidthAndHeightRules } from '../../../src/core/rules/ImgWidthAndHeight.js';
import { rules as ConvertIncludeToRenderRules } from '../../../src/core/rules/ConvertIncludeToRender.js';
import { rules as NonGetRenderingPageRules } from '../../../src/core/rules/NonGetRenderingPage.js';

describe('ImgLazyLoading.recommended', () => {
  beforeEach(() => { clearRules(); registerRules(ImgLazyLoadingRules); });

  test('fires on every ImgLazyLoading diagnostic with the canonical rule_id', () => {
    const result = runRules(
      { check: 'ImgLazyLoading', message: 'img without loading', line: 3, column: 2 },
      { graph: null },
    );
    expect(result).not.toBeNull();
    expect(result.rule_id).toBe('ImgLazyLoading.recommended');
    expect(result.confidence).toBe(0.9);
    expect(result.hint_md).toMatch(/loading="lazy"/);
    expect(result.fixes).toEqual([]);
  });

  test('returns null for other checks', () => {
    expect(runRules({ check: 'UnknownFilter' }, { graph: null })).toBeNull();
  });
});

describe('ImgWidthAndHeight.recommended', () => {
  beforeEach(() => { clearRules(); registerRules(ImgWidthAndHeightRules); });

  test('fires with canonical rule_id + CLS hint', () => {
    const result = runRules(
      { check: 'ImgWidthAndHeight', message: 'missing width/height', line: 5 },
      { graph: null },
    );
    expect(result.rule_id).toBe('ImgWidthAndHeight.recommended');
    expect(result.confidence).toBe(0.9);
    expect(result.hint_md).toMatch(/width/i);
    expect(result.hint_md).toMatch(/height/i);
  });
});

describe('ConvertIncludeToRender.default', () => {
  beforeEach(() => { clearRules(); registerRules(ConvertIncludeToRenderRules); });

  test('fires with canonical rule_id + explains render scope', () => {
    const result = runRules(
      { check: 'ConvertIncludeToRender', message: 'use render instead of include', line: 10 },
      { graph: null },
    );
    expect(result.rule_id).toBe('ConvertIncludeToRender.default');
    expect(result.confidence).toBe(0.9);
    expect(result.hint_md).toMatch(/render/);
    expect(result.hint_md).toMatch(/isolated scope/);
  });
});

describe('NonGetRenderingPage.default', () => {
  beforeEach(() => { clearRules(); registerRules(NonGetRenderingPageRules); });

  test('fires with canonical rule_id + action-oriented hint', () => {
    const result = runRules(
      { check: 'pos-supervisor:NonGetRenderingPage', message: 'page method: post + renders HTML' },
      { graph: null },
    );
    expect(result.rule_id).toBe('NonGetRenderingPage.default');
    expect(result.confidence).toBe(0.9);
    expect(result.hint_md).toMatch(/method: post/i);
    expect(result.hint_md).toMatch(/api/i);
    expect(result.fixes).toEqual([]);
  });
});
