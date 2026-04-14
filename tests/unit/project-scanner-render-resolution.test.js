/**
 * Phase 2.3 — partial→partial relative render resolution (F-016).
 *
 * Pins the behavior that a partial at app/views/partials/<feature>/<name>.liquid
 * that invokes {% render 'sibling' %} correctly attributes the render edge to
 * <feature>/sibling — not to the unqualified 'sibling' key. Before Phase 2.3
 * the lookup used the literal name, leaving every sibling-rendered partial
 * flagged as orphaned.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanProject, resolveRenderName } from '../../src/core/project-scanner.js';
import { buildDependencyGraph, resolveRenderTarget } from '../../src/core/dependency-graph.js';

// ── Unit tests on the resolver itself ──────────────────────────────────────

describe('resolveRenderName', () => {
  it('resolves a sibling render relative to the caller directory', () => {
    expect(resolveRenderName('app/views/partials/blog_posts/new.liquid', 'form'))
      .toBe('blog_posts/form');
  });

  it('passes absolute partial names through unchanged', () => {
    expect(resolveRenderName('app/views/partials/blog_posts/new.liquid', 'blog_posts/form'))
      .toBe('blog_posts/form');
    expect(resolveRenderName('app/views/partials/blog_posts/new.liquid', 'widgets/card'))
      .toBe('widgets/card');
  });

  it('passes modules/ refs through unchanged', () => {
    expect(resolveRenderName('app/views/partials/blog_posts/new.liquid', 'modules/common-styling/init'))
      .toBe('modules/common-styling/init');
  });

  it('returns the literal name when the caller is outside app/views/partials', () => {
    // Pages that render partials already use absolute names; relative from a
    // page has no meaningful "directory under partials" so we pass through.
    expect(resolveRenderName('app/views/pages/blog_posts/index.html.liquid', 'form'))
      .toBe('form');
  });

  it('returns the literal name when the caller is at the partials root', () => {
    // A partial directly under partials/ has no parent directory — there is
    // nothing to resolve relative to, so return the literal name.
    expect(resolveRenderName('app/views/partials/card.liquid', 'sibling'))
      .toBe('sibling');
  });

  it('handles .html.liquid extensions', () => {
    expect(resolveRenderName('app/views/partials/blog_posts/card.html.liquid', 'meta'))
      .toBe('blog_posts/meta');
  });
});

// ── End-to-end: scanProject on a real fixture ──────────────────────────────

describe('scanProject: partial→partial relative render resolution (F-016)', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'render-resolution-'));
    mkdirSync(join(projectDir, 'app', 'views', 'partials', 'blog_posts'), { recursive: true });
    mkdirSync(join(projectDir, 'app', 'views', 'pages', 'blog_posts'), { recursive: true });
    writeFileSync(join(projectDir, 'app', 'config.yml'), 'escape_output_instead_of_sanitize: true\n');
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  it('form.liquid is NOT orphaned when siblings render it by relative name', async () => {
    // new.liquid and edit.liquid both use the relative form — this is the
    // pattern an author might legitimately write. Before Phase 2.3 the
    // reverse index missed both edges and form.liquid looked orphaned.
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'blog_posts', 'form.liquid'),
      '{% doc %}{% enddoc %}\n<form></form>\n',
    );
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'blog_posts', 'new.liquid'),
      "{% render 'form' %}\n",
    );
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'blog_posts', 'edit.liquid'),
      "{% render 'form' %}\n",
    );

    const map = await scanProject(projectDir);
    const form = map.partials['blog_posts/form'];
    expect(form).toBeTruthy();
    // Both siblings must appear in rendered_by.
    expect(form.rendered_by).toContain('app/views/partials/blog_posts/new.liquid');
    expect(form.rendered_by).toContain('app/views/partials/blog_posts/edit.liquid');
  });

  it('absolute render names still resolve — no regression', async () => {
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'blog_posts', 'form.liquid'),
      '{% doc %}{% enddoc %}\n<form></form>\n',
    );
    writeFileSync(
      join(projectDir, 'app', 'views', 'partials', 'blog_posts', 'new.liquid'),
      "{% render 'blog_posts/form' %}\n",
    );

    const map = await scanProject(projectDir);
    expect(map.partials['blog_posts/form'].rendered_by)
      .toContain('app/views/partials/blog_posts/new.liquid');
  });
});

// ── Dependency graph integration ────────────────────────────────────────────

describe('buildDependencyGraph: honors relative render resolution', () => {
  it('resolveRenderTarget uses caller path to resolve sibling names', () => {
    const map = {
      partials: {
        'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid' },
      },
    };
    const target = resolveRenderTarget(
      'form',
      map,
      'app/views/partials/blog_posts/new.liquid',
    );
    expect(target).toBe('app/views/partials/blog_posts/form.liquid');
  });

  it('graph edge for sibling render lands on the sibling partial path', () => {
    const map = {
      pages: {},
      partials: {
        'blog_posts/new':  { path: 'app/views/partials/blog_posts/new.liquid',  renders: ['form'], function_calls: [] },
        'blog_posts/form': { path: 'app/views/partials/blog_posts/form.liquid', renders: [],       function_calls: [] },
      },
      commands: {}, queries: {}, graphql: {},
    };
    const graph = buildDependencyGraph(map);
    expect(graph['app/views/partials/blog_posts/new.liquid'].depends_on)
      .toContain('app/views/partials/blog_posts/form.liquid');
    expect(graph['app/views/partials/blog_posts/form.liquid'].referenced_by)
      .toContain('app/views/partials/blog_posts/new.liquid');
  });
});
