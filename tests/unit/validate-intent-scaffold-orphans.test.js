/**
 * Phase 2.4 — scaffold reference parsing kills orphan false positives (F-003).
 *
 * Contract: validate_intent(scaffold_output) on a real scaffold result MUST
 * return zero orphan_partial warnings. Intra-plan renders (pages rendering
 * partials, partials rendering sibling partials) are visible to the P5 check
 * because normalizeScaffoldInput now parses each file's content and resolves
 * render names via the same helper project-scanner uses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateScaffold } from '../../src/core/scaffold-generator.js';
import { validateIntent, normalizeScaffoldInput } from '../../src/core/intent-validator.js';

// ── Fixture helper ──────────────────────────────────────────────────────────

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'scaffold-orphans-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

// ── normalizeScaffoldInput unit cases ──────────────────────────────────────

describe('normalizeScaffoldInput: render reference extraction', () => {
  it('extracts absolute render names into references.partials', () => {
    const scaffoldOutput = {
      files: [
        {
          path: 'app/views/partials/blog_posts/new.liquid',
          domain: 'partials',
          content: "{% render 'blog_posts/form', object: object %}\n",
        },
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes[0].references.partials).toEqual(['blog_posts/form']);
  });

  it('resolves relative render names against the caller directory', () => {
    const scaffoldOutput = {
      files: [
        {
          path: 'app/views/partials/blog_posts/new.liquid',
          domain: 'partials',
          content: "{% render 'form' %}\n",
        },
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes[0].references.partials).toEqual(['blog_posts/form']);
  });

  it('drops modules/ refs from references.partials', () => {
    const scaffoldOutput = {
      files: [
        {
          path: 'app/views/partials/blog_posts/form.liquid',
          domain: 'partials',
          content: "{% render 'modules/common-styling/forms/error_list', errors: x, name: 'y' %}\n",
        },
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    // modules/ refs are excluded from partials (they route through a different check).
    expect(changes[0].references.partials).toBeUndefined();
  });

  it('populates references.graphql on a command from {% graphql %} tags', () => {
    const scaffoldOutput = {
      files: [
        {
          path: 'app/lib/commands/blog_posts/create.liquid',
          domain: 'commands',
          content: "{% graphql result = 'blog_posts/create', post: context.params %}\n",
        },
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes[0].references.graphql).toEqual(['blog_posts/create']);
  });

  it('POPULATES references.graphql on a partial (so P1 partial_invokes_graphql fires)', () => {
    // Hiding graphql refs from partials would also hide the P1 regression catch.
    // We deliberately surface them and let P1 emit an educational error.
    const scaffoldOutput = {
      files: [
        {
          path: 'app/views/partials/regression/bad.liquid',
          domain: 'partials',
          content: "{% graphql data = 'foo/bar' %}\n",
        },
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes[0].references.graphql).toEqual(['foo/bar']);
  });

  it('handles files with no content gracefully', () => {
    const scaffoldOutput = {
      files: [
        { path: 'app/lib/queries/x.liquid', domain: 'queries' }, // no content
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes[0].references).toEqual({});
  });

  it('dedupes repeated render names', () => {
    const scaffoldOutput = {
      files: [
        {
          path: 'app/views/pages/blog_posts/index.html.liquid',
          domain: 'pages',
          content: "---\nslug: blog_posts\n---\n{% render 'blog_posts/card' %}\n{% render 'blog_posts/card' %}\n",
        },
      ],
      summary: 'Test',
    };
    const { changes } = normalizeScaffoldInput(scaffoldOutput);
    expect(changes[0].references.partials).toEqual(['blog_posts/card']);
  });
});

// ── End-to-end: scaffold → validate_intent → zero orphan warnings ──────────

describe('validate_intent(scaffold_output): zero orphan_partial warnings (F-003)', () => {
  it('CRUD scaffold produces no orphan_partial warnings', async () => {
    // Generate a real scaffold — this is exactly what the agent would pass
    // to validate_intent in the standard workflow.
    const scaffoldOutput = await generateScaffold({
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }, { name: 'body', type: 'text' }],
      write: false,
    }, projectDir);

    const result = await validateIntent({ scaffold_output: scaffoldOutput }, projectDir);

    // Track-A validation must pass…
    expect(result.ok).toBe(true);
    // …and every scaffolded partial must be visible to some caller in the plan.
    const orphans = (result.warnings ?? []).filter(w => w.type === 'orphan_partial');
    if (orphans.length > 0) {
      // Print which partials were flagged for debugging — this block only runs on failure.
      console.log('Unexpected orphans:', orphans.map(o => o.path));
    }
    expect(orphans).toHaveLength(0);
  });

  it('CRUD with auth fields still yields zero orphans', async () => {
    const scaffoldOutput = await generateScaffold({
      type: 'crud',
      name: 'blog_post',
      properties: [
        { name: 'title', type: 'string' },
        { name: 'author_id', type: 'integer', role: 'auth' },
      ],
      include_authorization: true,
      write: false,
    }, projectDir);

    const result = await validateIntent({ scaffold_output: scaffoldOutput }, projectDir);
    expect(result.ok).toBe(true);
    const orphans = (result.warnings ?? []).filter(w => w.type === 'orphan_partial');
    expect(orphans).toHaveLength(0);
  });
});
