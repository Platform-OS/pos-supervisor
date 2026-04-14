/**
 * Phase 2.5 — project_map pages keyed by {slug}:{method} (F-006).
 *
 * Contract: scanning a CRUD scaffold produces one page entry per file, not
 * a slug-collapsed subset. Seven scaffolded pages → seven entries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanProject } from '../../src/core/project-scanner.js';
import { generateScaffold } from '../../src/core/scaffold-generator.js';

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'pages-key-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

// ── Synthetic fixture ──────────────────────────────────────────────────────

describe('scanProject: pages keyed by {slug}:{method}', () => {
  it('two pages sharing a slug under different methods are BOTH indexed', async () => {
    mkdirSync(join(projectDir, 'app', 'views', 'pages', 'blog_posts'), { recursive: true });
    writeFileSync(
      join(projectDir, 'app', 'views', 'pages', 'blog_posts', 'index.html.liquid'),
      '---\nslug: blog_posts\nmethod: get\n---\n<h1>List</h1>\n',
    );
    writeFileSync(
      join(projectDir, 'app', 'views', 'pages', 'blog_posts', 'create.html.liquid'),
      '---\nslug: blog_posts\nmethod: post\n---\n{% liquid echo "create" %}\n',
    );

    const map = await scanProject(projectDir);
    expect(map.pages['blog_posts:get']).toBeDefined();
    expect(map.pages['blog_posts:post']).toBeDefined();
    expect(map.pages['blog_posts:get'].path).toContain('index.html.liquid');
    expect(map.pages['blog_posts:post'].path).toContain('create.html.liquid');
  });

  it('each entry exposes slug and method on the value', async () => {
    mkdirSync(join(projectDir, 'app', 'views', 'pages'), { recursive: true });
    writeFileSync(
      join(projectDir, 'app', 'views', 'pages', 'home.html.liquid'),
      '---\nslug: home\nmethod: get\n---\n<h1>Home</h1>\n',
    );

    const map = await scanProject(projectDir);
    const page = map.pages['home:get'];
    expect(page.slug).toBe('home');
    expect(page.method).toBe('get');
  });

  it('files without an explicit method default to get', async () => {
    mkdirSync(join(projectDir, 'app', 'views', 'pages'), { recursive: true });
    writeFileSync(
      join(projectDir, 'app', 'views', 'pages', 'about.html.liquid'),
      '---\nslug: about\n---\n<h1>About</h1>\n',
    );

    const map = await scanProject(projectDir);
    expect(map.pages['about:get']).toBeDefined();
    expect(map.pages['about:get'].method).toBe('get');
  });

  it('detectResources finds pages by scanning values, not by key lookup', async () => {
    // Scaffold schema + pages so detectResources has a table to match against.
    mkdirSync(join(projectDir, 'app', 'schema'), { recursive: true });
    writeFileSync(
      join(projectDir, 'app', 'schema', 'blog_post.yml'),
      'name: blog_post\nproperties:\n  - name: title\n    type: string\n',
    );
    mkdirSync(join(projectDir, 'app', 'views', 'pages', 'blog_posts'), { recursive: true });
    writeFileSync(
      join(projectDir, 'app', 'views', 'pages', 'blog_posts', 'index.html.liquid'),
      '---\nslug: blog_posts\nmethod: get\n---\n<h1>list</h1>\n',
    );
    writeFileSync(
      join(projectDir, 'app', 'views', 'pages', 'blog_posts', 'show.html.liquid'),
      '---\nslug: blog_posts/:id\nmethod: get\n---\n<h1>show</h1>\n',
    );

    const map = await scanProject(projectDir);
    // detectResources attaches resources by table name.
    expect(map.summary.resources.blog_post).toBeDefined();
    // Both pages under the plural slug should show up.
    expect(map.summary.resources.blog_post.pages.length).toBeGreaterThanOrEqual(2);
  });
});

// ── End-to-end: scaffold → scanProject → 7 page entries ────────────────────

describe('CRUD scaffold writes 7 pages → scanProject returns 7 entries (F-006)', () => {
  it('no collapse: scaffold output and scanned count match', async () => {
    // Write a full CRUD scaffold to disk, then scan the project.
    await generateScaffold({
      type: 'crud',
      name: 'blog_post',
      properties: [{ name: 'title', type: 'string' }, { name: 'body', type: 'text' }],
      write: true,
    }, projectDir);

    const map = await scanProject(projectDir);
    const blogPostPageEntries = Object.entries(map.pages)
      .filter(([, p]) => p.path.includes('/blog_posts/'));

    // Scaffold emits 7 files in app/views/pages/blog_posts/:
    //   index, show, new, edit, create, update, delete
    expect(blogPostPageEntries).toHaveLength(7);

    // Every entry carries its own path — no collisions.
    const paths = blogPostPageEntries.map(([, p]) => p.path);
    expect(new Set(paths).size).toBe(7);
  });
});
