/**
 * Phase 1.2 — MetadataParamsCheck suppression generalised from "module path"
 * to "target partial has no {% doc %} block".
 *
 * Contract: when the calling line references an app partial or command whose
 * source file lacks a {% doc %} contract, the LSP's inferred required-param
 * diagnostic is a guess and MUST be suppressed. A parallel info diagnostic
 * (`pos-supervisor:UndocumentedPartialParamsSuppressed`) surfaces the path so
 * the agent can add a doc block upstream.
 *
 * Partials WITH a {% doc %} block (or {% comment %} instead of {% doc %}, which
 * is equivalent to "no doc" per the LSP and our scanner) behave as before.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runDiagnosticPipeline } from '../../src/core/diagnostic-pipeline.js';

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'undoc-target-'));
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

function writeTarget(relPath, content) {
  const abs = join(projectDir, relPath);
  mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
  writeFileSync(abs, content);
}

function metadataError(line, message = 'Required parameter name must be passed') {
  return { check: 'MetadataParamsCheck', severity: 'error', line, message };
}

function makeResult(errors = [], warnings = [], infos = []) {
  return { errors: [...errors], warnings: [...warnings], infos: [...infos] };
}

describe('suppressUndocumentedTargetParams — app partial targets', () => {
  it('suppresses MetadataParamsCheck when the target app partial has no {% doc %}', () => {
    writeTarget('app/views/partials/widgets/card.liquid',
      '<div class="card">{{ title }}</div>\n');

    const callerContent = [
      '---',
      'slug: test',
      '---',
      "{% render 'widgets/card', title: 'x' %}",
    ].join('\n');

    const result = makeResult([metadataError(4)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      projectDir,
    });

    expect(result.errors.filter(e => e.check === 'MetadataParamsCheck')).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:UndocumentedPartialParamsSuppressed');
    expect(info).toBeTruthy();
    expect(info.paths).toContain('app/views/partials/widgets/card.liquid');
  });

  it('DOES NOT suppress when target partial has a {% doc %} block', () => {
    writeTarget('app/views/partials/widgets/card.liquid',
      '{% doc %}\n  @param title {string}\n{% enddoc %}\n<div>{{ title }}</div>\n');

    const callerContent = [
      "{% render 'widgets/card', title: 'x' %}",
    ].join('\n');

    const result = makeResult([metadataError(1)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      projectDir,
    });

    // Target has a real contract — LSP diagnostic is not a guess, keep it.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('MetadataParamsCheck');
    expect(result.infos.find(i => i.check === 'pos-supervisor:UndocumentedPartialParamsSuppressed'))
      .toBeUndefined();
  });

  it('suppresses when target uses {% comment %} instead of {% doc %}', () => {
    writeTarget('app/views/partials/widgets/card.liquid',
      '{% comment %}\n  title: the widget label\n{% endcomment %}\n<div>{{ title }}</div>\n');

    const callerContent = "{% render 'widgets/card' %}\n";
    const result = makeResult([metadataError(1)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      projectDir,
    });

    expect(result.errors.filter(e => e.check === 'MetadataParamsCheck')).toHaveLength(0);
    expect(result.infos.find(i => i.check === 'pos-supervisor:UndocumentedPartialParamsSuppressed'))
      .toBeTruthy();
  });

  it('suppresses for {% function %} calls targeting undocumented commands', () => {
    writeTarget('app/lib/commands/things/create.liquid',
      '{% liquid %}{% assign x = 1 %}{% endliquid %}\n');

    const callerContent = "{% function obj = 'commands/things/create', object: input %}\n";
    const result = makeResult([metadataError(1)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/things/new.html.liquid',
      content: callerContent,
      projectDir,
    });

    expect(result.errors.filter(e => e.check === 'MetadataParamsCheck')).toHaveLength(0);
    const info = result.infos.find(i => i.check === 'pos-supervisor:UndocumentedPartialParamsSuppressed');
    expect(info.paths).toContain('app/lib/commands/things/create.liquid');
  });

  it('conservatively does NOT suppress when projectDir is omitted (cannot verify)', () => {
    // No projectDir → we can't read the target → leave the diagnostic alone.
    // Modules remain suppressed via the path heuristic; app partials do not.
    const callerContent = "{% render 'widgets/card', title: 'x' %}\n";
    const result = makeResult([metadataError(1)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/test.html.liquid',
      content: callerContent,
      // projectDir intentionally omitted
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('MetadataParamsCheck');
  });
});

describe('suppressUndocumentedTargetParams — module + app combined', () => {
  it('emits both ModuleParamsSuppressed and UndocumentedPartialParamsSuppressed for a mixed file', () => {
    writeTarget('app/views/partials/widgets/card.liquid',
      '<div>{{ title }}</div>\n');  // no doc

    const callerContent = [
      "{% render 'modules/common-styling/init' %}",
      "{% render 'widgets/card', title: 'x' %}",
    ].join('\n');

    const result = makeResult([metadataError(1), metadataError(2)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content: callerContent,
      projectDir,
    });

    expect(result.errors.filter(e => e.check === 'MetadataParamsCheck')).toHaveLength(0);
    expect(result.infos.find(i => i.check === 'pos-supervisor:ModuleParamsSuppressed')).toBeTruthy();
    expect(result.infos.find(i => i.check === 'pos-supervisor:UndocumentedPartialParamsSuppressed'))
      .toBeTruthy();
    expect(result.infos.find(i => i.check === 'pos-supervisor:module_doc_missing')).toBeTruthy();
  });
});
