/**
 * Phase 3 — module_doc_missing info diagnostic.
 *
 * Contract: when suppressModuleTargetParams fires, a new info-level diagnostic
 * `pos-supervisor:module_doc_missing` enumerates the module paths encountered
 * and splits them into `known` vs `unknown` based on knowledge.json.
 */

import { describe, it, expect } from 'bun:test';
import { runDiagnosticPipeline } from '../../src/core/diagnostic-pipeline.js';
import { getKnownModulesMissingDocs } from '../../src/core/knowledge-loader.js';

function makeResult(errors = [], warnings = [], infos = []) {
  return { errors: [...errors], warnings: [...warnings], infos: [...infos] };
}

function metadataError(line, message = 'Required parameter name must be passed') {
  return { check: 'MetadataParamsCheck', severity: 'error', line, message };
}

describe('Phase 3: getKnownModulesMissingDocs loader', () => {
  it('returns a Set loaded from knowledge.json', () => {
    const known = getKnownModulesMissingDocs();
    expect(known instanceof Set).toBe(true);
    // Canonical entries seeded in the JSON.
    expect(known.has('modules/user/helpers/can_do_or_unauthorized')).toBe(true);
    expect(known.has('modules/common-styling/forms/error_list')).toBe(true);
  });
});

describe('Phase 3: suppressModuleTargetParams emits module_doc_missing', () => {
  it('emits a module_doc_missing info alongside ModuleParamsSuppressed when KNOWN paths fire', () => {
    const content = [
      '{% doc %}{% enddoc %}',
      "{% function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: ctx, do: 'x' %}",
      "{% render 'modules/common-styling/forms/error_list', errors: e, name: 'n' %}",
    ].join('\n');

    const result = makeResult([metadataError(2), metadataError(3)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content,
    });

    // The MetadataParamsCheck errors MUST be suppressed.
    expect(result.errors.filter(e => e.check === 'MetadataParamsCheck')).toHaveLength(0);

    // Both info diagnostics must be present.
    const suppressed = result.infos.find(i => i.check === 'pos-supervisor:ModuleParamsSuppressed');
    const missing   = result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing');
    expect(suppressed).toBeTruthy();
    expect(missing).toBeTruthy();

    // Both encountered paths should be on the known list — no "new offenders".
    expect(missing.known).toContain('modules/user/helpers/can_do_or_unauthorized');
    expect(missing.known).toContain('modules/common-styling/forms/error_list');
    expect(missing.unknown).toEqual([]);
    expect(missing.message).not.toContain('New offender');
  });

  it('annotates unknown module paths in the unknown array + surfaces them in prose', () => {
    const content = [
      '{% doc %}{% enddoc %}',
      "{% function _ = 'modules/some_new_module/helpers/do_thing' %}",
    ].join('\n');

    const result = makeResult([metadataError(2, 'Required parameter name must be passed')]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content,
    });

    const missing = result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing');
    expect(missing).toBeTruthy();
    expect(missing.unknown).toContain('modules/some_new_module/helpers/do_thing');
    expect(missing.known).toEqual([]);
    // Prose message MUST call out upstream filing.
    expect(missing.message).toMatch(/filing an upstream issue/);
  });

  it('splits encountered paths into known and unknown when both are present', () => {
    const content = [
      '{% doc %}{% enddoc %}',
      "{% function _ = 'modules/user/helpers/can_do_or_unauthorized' %}",
      "{% function _ = 'modules/some_new_module/helpers/do_thing' %}",
    ].join('\n');

    const result = makeResult([metadataError(2), metadataError(3)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content,
    });

    const missing = result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing');
    expect(missing.known).toContain('modules/user/helpers/can_do_or_unauthorized');
    expect(missing.unknown).toContain('modules/some_new_module/helpers/do_thing');
  });

  it('does NOT emit module_doc_missing when there are no MetadataParamsCheck errors to suppress', () => {
    const content = "{% doc %}{% enddoc %}\n<div>no errors here</div>\n";
    const result = makeResult();
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content,
    });

    expect(result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing')).toBeUndefined();
  });

  it('does NOT emit module_doc_missing for non-module MetadataParamsCheck errors', () => {
    // Error on a local partial call — suppressModuleTargetParams must not fire at all.
    const content = [
      '{% doc %}{% enddoc %}',
      "{% render 'blog_posts/form', object: object %}",
    ].join('\n');

    const result = makeResult([metadataError(2)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content,
    });

    // MetadataParamsCheck is NOT suppressed (the line does not call a module/ path).
    expect(result.errors.some(e => e.check === 'MetadataParamsCheck')).toBe(true);
    // module_doc_missing is absent.
    expect(result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing')).toBeUndefined();
  });

  it('normalizes .liquid extensions when matching against the known list', () => {
    // Lines may or may not include .liquid — normalize before lookup.
    const content = [
      '{% doc %}{% enddoc %}',
      "{% function _ = 'modules/user/helpers/can_do_or_unauthorized.liquid' %}",
    ].join('\n');

    const result = makeResult([metadataError(2)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content,
    });

    const missing = result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing');
    expect(missing.known).toContain('modules/user/helpers/can_do_or_unauthorized');
    expect(missing.unknown).toEqual([]);
  });
});
