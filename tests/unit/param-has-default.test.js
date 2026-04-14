/**
 * Phase 1.3 — `| default:` filter satisfies required param.
 *
 * Contract: when a MetadataParamsCheck or MissingRenderPartialArguments fires
 * for a param X, and the target partial body contains `X | default: ...`, the
 * diagnostic is a false positive — callers can safely omit X because the target
 * defaults it. Suppress with an advisory pointing at the proper fix (bracket
 * the @param declaration).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runDiagnosticPipeline } from '../../src/core/diagnostic-pipeline.js';

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'param-default-'));
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

function writeTarget(relPath, content) {
  const abs = join(projectDir, relPath);
  mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
  writeFileSync(abs, content);
}

function makeResult(errors = [], warnings = [], infos = []) {
  return { errors: [...errors], warnings: [...warnings], infos: [...infos] };
}

describe('suppressRequiredParamsWithDefault', () => {
  it('suppresses MissingRenderPartialArguments when the param is defaulted in the body', () => {
    writeTarget('app/views/partials/widgets/card.liquid',
      [
        '{% doc %}',
        '  @param title {string} - card title',
        '  @param variant {string} - variant style',
        '{% enddoc %}',
        '{% liquid',
        "  assign variant = variant | default: 'primary'",
        '%}',
        '<div class="{{ variant }}">{{ title }}</div>',
      ].join('\n'));

    const callerContent = "{% render 'widgets/card', title: 'x' %}\n";
    const result = makeResult([{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      line: 1,
      message: "Missing required argument 'variant' in render tag for partial 'widgets/card'",
    }]);

    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      projectDir,
    });

    expect(result.errors.filter(e => e.check === 'MissingRenderPartialArguments')).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:ParamHasDefaultSuppressed');
    expect(info).toBeTruthy();
    expect(info.affected.some(a => a.includes('variant'))).toBe(true);
  });

  it('suppresses MetadataParamsCheck when the param is defaulted in a function target', () => {
    writeTarget('app/lib/queries/things/search.liquid',
      [
        '{% doc %}',
        '  @param page {number} - page number',
        '  @param limit {number} - page size',
        '{% enddoc %}',
        '{% liquid',
        '  assign page = page | default: 1',
        '  assign limit = limit | default: 20',
        '%}',
      ].join('\n'));

    const callerContent = "{% function items = 'queries/things/search' %}\n";
    const result = makeResult([
      { check: 'MetadataParamsCheck', severity: 'error', line: 1, message: "Required parameter 'page' must be passed" },
      { check: 'MetadataParamsCheck', severity: 'error', line: 1, message: "Required parameter 'limit' must be passed" },
    ]);

    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/things/index.html.liquid',
      content: callerContent,
      projectDir,
    });

    expect(result.errors.filter(e => e.check === 'MetadataParamsCheck')).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:ParamHasDefaultSuppressed');
    expect(info).toBeTruthy();
  });

  it('DOES NOT suppress when the param is not defaulted in the body', () => {
    writeTarget('app/views/partials/widgets/card.liquid',
      [
        '{% doc %}',
        '  @param title {string}',
        '{% enddoc %}',
        '<div>{{ title }}</div>',
      ].join('\n'));

    const callerContent = "{% render 'widgets/card' %}\n";
    const result = makeResult([{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      line: 1,
      message: "Missing required argument 'title' in render tag for partial 'widgets/card'",
    }]);

    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      projectDir,
    });

    // Target really does require title, no default — keep the diagnostic.
    expect(result.errors).toHaveLength(1);
    expect(result.infos.find(i => i.check === 'pos-supervisor:ParamHasDefaultSuppressed'))
      .toBeUndefined();
  });

  it('is a no-op when projectDir is missing (cannot verify target body)', () => {
    const callerContent = "{% render 'widgets/card' %}\n";
    const result = makeResult([{
      check: 'MissingRenderPartialArguments',
      severity: 'error',
      line: 1,
      message: "Missing required argument 'variant' in render tag for partial 'widgets/card'",
    }]);

    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      // projectDir omitted
    });

    expect(result.errors).toHaveLength(1);
  });
});
