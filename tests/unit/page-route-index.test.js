/**
 * Pins for the page-route index used by the diagnostic pipeline to suppress
 * stale MissingPage diagnostics.
 *
 * MissingPage was the third ghost-error class (after MissingAsset and
 * TranslationKeyExists). validate_code analyses one file at a time, so a
 * header partial that links to `/`, `/notes`, `/dashboard` triggers
 * MissingPage for each link even though those pages exist in separate files.
 * The index walks `app/views/pages/` once, building a Map<route, Set<method>>,
 * and the pipeline cross-checks reported routes against this truth.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPageRouteIndex,
  normalizeRoute,
  parseMissingPageMessage,
  resolvePageRoute,
} from '../../src/core/page-route-index.js';

describe('page-route-index', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'page-route-index-'));
    const pages = join(tmpDir, 'app/views/pages');
    mkdirSync(join(pages, 'notes'), { recursive: true });
    mkdirSync(join(pages, 'blog_posts'), { recursive: true });

    // Root page → '' (empty route)
    writeFileSync(join(pages, 'index.liquid'), '<p>Home</p>\n', 'utf8');

    // Top-level page, no frontmatter → 'dashboard'
    writeFileSync(join(pages, 'dashboard.liquid'), '<p>Dash</p>\n', 'utf8');

    // Nested index page → 'notes' (the /index suffix collapses)
    writeFileSync(join(pages, 'notes/index.html.liquid'), '<p>Notes</p>\n', 'utf8');

    // Nested non-index page → 'blog_posts/show'
    writeFileSync(join(pages, 'blog_posts/show.liquid'), '<p>Show</p>\n', 'utf8');

    // Frontmatter slug overrides the path
    writeFileSync(
      join(pages, 'blog_posts/create.liquid'),
      '---\nslug: blog_posts\nmethod: post\n---\n<p>Create</p>\n',
      'utf8',
    );

    // Same slug, different method (PUT) — multi-method case
    writeFileSync(
      join(pages, 'blog_posts/update.liquid'),
      '---\nslug: blog_posts\nmethod: put\n---\n<p>Update</p>\n',
      'utf8',
    );

    // Frontmatter slug with leading slash → must be normalised
    writeFileSync(
      join(pages, 'blog_posts/listing.liquid'),
      '---\nslug: /posts\n---\n<p>List</p>\n',
      'utf8',
    );

    // Non-liquid files in pages directory must be ignored
    writeFileSync(join(pages, 'README.md'), 'docs', 'utf8');
  });

  afterAll(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  describe('buildPageRouteIndex', () => {
    it('indexes the root index.liquid as the empty route', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      expect(routes.has('')).toBe(true);
      expect(routes.get('').has('get')).toBe(true);
    });

    it('derives the route from the file path when frontmatter is absent', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      expect(routes.has('dashboard')).toBe(true);
      expect(routes.has('blog_posts/show')).toBe(true);
    });

    it('collapses a nested index.html.liquid to the directory route', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      expect(routes.has('notes')).toBe(true);
      // The literal path-derived form must NOT be present.
      expect(routes.has('notes/index')).toBe(false);
    });

    it('lets frontmatter slug override the path-derived route', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      // create.liquid has slug: blog_posts → it lives at 'blog_posts', not 'blog_posts/create'
      expect(routes.has('blog_posts/create')).toBe(false);
      expect(routes.get('blog_posts')?.has('post')).toBe(true);
    });

    it('merges multiple files at the same slug into one route with all methods', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      const methods = routes.get('blog_posts');
      expect(methods).toBeDefined();
      expect(methods.has('post')).toBe(true);
      expect(methods.has('put')).toBe(true);
    });

    it('strips a leading slash from frontmatter slug', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      expect(routes.has('posts')).toBe(true);
      expect(routes.has('/posts')).toBe(false);
    });

    it('ignores non-liquid files in the pages directory', () => {
      const { routes } = buildPageRouteIndex(tmpDir);
      expect(routes.has('README')).toBe(false);
      expect(routes.has('README.md')).toBe(false);
    });

    it('returns an empty map for a missing project dir or missing pages dir', () => {
      expect(buildPageRouteIndex(null).routes.size).toBe(0);
      expect(buildPageRouteIndex('/nonexistent-page-route-dir').routes.size).toBe(0);
    });
  });

  describe('normalizeRoute', () => {
    it('strips a leading slash', () => {
      expect(normalizeRoute('/notes')).toBe('notes');
    });
    it('collapses a trailing /index', () => {
      expect(normalizeRoute('notes/index')).toBe('notes');
    });
    it('treats the bare "index" as the root route', () => {
      expect(normalizeRoute('index')).toBe('');
      expect(normalizeRoute('/index')).toBe('');
    });
    it('returns the empty string for non-string input', () => {
      expect(normalizeRoute(undefined)).toBe('');
      expect(normalizeRoute(null)).toBe('');
    });
  });

  describe('parseMissingPageMessage', () => {
    it('parses "No page found for route \'/notes\' (GET)" into route + method', () => {
      const out = parseMissingPageMessage("No page found for route '/notes' (GET)");
      expect(out).toEqual({ route: 'notes', method: 'get' });
    });

    it('parses "Page \'blog_posts/show\' not found" with default method get', () => {
      const out = parseMissingPageMessage("Page 'blog_posts/show' not found");
      expect(out).toEqual({ route: 'blog_posts/show', method: 'get' });
    });

    it('lowercases the method extracted from the parenthetical', () => {
      const out = parseMissingPageMessage("No page for '/blog_posts' (POST)");
      expect(out?.method).toBe('post');
    });

    it('returns null when the message has no quoted route', () => {
      expect(parseMissingPageMessage('garbage with no quotes')).toBeNull();
      expect(parseMissingPageMessage(null)).toBeNull();
      expect(parseMissingPageMessage('')).toBeNull();
    });
  });

  describe('resolvePageRoute', () => {
    let index;
    beforeAll(() => { index = buildPageRouteIndex(tmpDir); });

    it('returns exists when route + method are both indexed', () => {
      expect(resolvePageRoute('/notes', 'get', index)).toEqual({ status: 'exists' });
      expect(resolvePageRoute('/', 'get', index)).toEqual({ status: 'exists' });
    });

    it('returns wrong-method with the served methods when route is indexed but method is not', () => {
      const out = resolvePageRoute('/blog_posts', 'get', index);
      expect(out.status).toBe('wrong-method');
      expect(out.methods.sort()).toEqual(['post', 'put']);
    });

    it('returns missing when the route is not indexed at all', () => {
      expect(resolvePageRoute('/totally-unknown', 'get', index)).toEqual({ status: 'missing' });
    });
  });

  describe('buildPageRouteIndex with overlay', () => {
    it("substitutes the overlay's frontmatter for the on-disk version of the same file", () => {
      // Disk version of dashboard.liquid has no method (defaults to GET).
      // Overlay declares `method: post` — the route's method set must reflect
      // the overlay (POST), not the disk (GET).
      const overlay = {
        filePath: 'app/views/pages/dashboard.liquid',
        content: '---\nmethod: post\n---\n<p>POST handler</p>\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      const methods = routes.get('dashboard');
      expect(methods).toBeDefined();
      expect(methods.has('post')).toBe(true);
      expect(methods.has('get')).toBe(false);
    });

    it('adds a brand-new page (not yet on disk) to the index', () => {
      const overlay = {
        filePath: 'app/views/pages/contact.liquid',
        content: '---\nmethod: post\n---\n<p>new page</p>\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      expect(routes.has('contact')).toBe(true);
      expect(routes.get('contact').has('post')).toBe(true);
    });

    it("respects the overlay's frontmatter slug just like it does for on-disk files", () => {
      const overlay = {
        filePath: 'app/views/pages/whatever.liquid',
        content: '---\nslug: my-custom-route\nmethod: put\n---\n<p>x</p>\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      expect(routes.has('my-custom-route')).toBe(true);
      expect(routes.has('whatever')).toBe(false);
    });

    it('accepts an absolute filePath in the overlay', () => {
      const overlay = {
        filePath: join(tmpDir, 'app/views/pages/contact.liquid'),
        content: '---\nmethod: post\n---\n<p>x</p>\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      expect(routes.has('contact')).toBe(true);
    });

    it('ignores the overlay when the file is not under app/views/pages/', () => {
      // Partials cannot serve routes. The overlay must be silently dropped
      // rather than creating a phantom route entry.
      const overlay = {
        filePath: 'app/views/partials/header.liquid',
        content: '---\nslug: phantom\nmethod: post\n---\n<p>x</p>\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      expect(routes.has('phantom')).toBe(false);
    });

    it('ignores the overlay when filePath does not end in .liquid', () => {
      const overlay = {
        filePath: 'app/views/pages/contact.json.liquid.bak',
        content: '---\nslug: phantom\n---\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      expect(routes.has('phantom')).toBe(false);
    });

    it('treats a malformed overlay (missing fields) as if no overlay were provided', () => {
      const baseline = buildPageRouteIndex(tmpDir).routes.size;
      expect(buildPageRouteIndex(tmpDir, null).routes.size).toBe(baseline);
      expect(buildPageRouteIndex(tmpDir, {}).routes.size).toBe(baseline);
      expect(buildPageRouteIndex(tmpDir, { filePath: 'x' }).routes.size).toBe(baseline);
      expect(buildPageRouteIndex(tmpDir, { content: 'x' }).routes.size).toBe(baseline);
    });

    it('overlay with no frontmatter falls back to path-derived route + GET', () => {
      // The disk version of dashboard.liquid is also no-frontmatter / GET.
      // Overlay just confirms the same. Ensures empty frontmatter does not
      // accidentally erase the file from the index.
      const overlay = {
        filePath: 'app/views/pages/dashboard.liquid',
        content: '<p>no frontmatter</p>\n',
      };
      const { routes } = buildPageRouteIndex(tmpDir, overlay);
      expect(routes.has('dashboard')).toBe(true);
      expect(routes.get('dashboard').has('get')).toBe(true);
    });
  });
});
