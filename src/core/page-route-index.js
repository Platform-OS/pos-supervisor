/**
 * Page-route index — a snapshot of every route the project actually serves.
 *
 * Purpose: the LSP's MissingPage check fires for any route reference whose
 * page is not in the file currently under analysis. validate_code analyses
 * one file at a time, so a header partial that links to `/notes`,
 * `/dashboard`, `/` triggers MissingPage for each link even though those
 * pages exist as separate files (`app/views/pages/notes/index.html.liquid`,
 * `app/views/pages/dashboard.liquid`, `app/views/pages/index.liquid`).
 *
 * The agent is told "no page found" for routes the project clearly serves —
 * a textbook ghost error. Same mitigation as MissingAsset and
 * TranslationKeyExists: scan the filesystem, build the truth, suppress the
 * false positives.
 *
 * The index is a Map<routeKey, Set<method>>. routeKey is the normalised
 * route string (no leading slash, no trailing `/index`). method is lowercase.
 *
 * Route resolution rules (matching platformOS):
 *   - frontmatter `slug:` wins if present.
 *   - else the path under `app/views/pages/` minus the `.liquid` /
 *     `.html.liquid` extension is the route.
 *   - `index.liquid` (any depth) collapses its `/index` suffix; the directory
 *     itself becomes the route. So `app/views/pages/index.liquid` → `''`
 *     (root) and `app/views/pages/notes/index.html.liquid` → `notes`.
 *   - frontmatter `method:` wins for HTTP method, defaulting to `get`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PAGES_SUBDIR = 'app/views/pages';

/**
 * @param {string} projectDir
 * @returns {{ routes: Map<string, Set<string>> }}
 */
export function buildPageRouteIndex(projectDir) {
  const routes = new Map();
  if (!projectDir) return { routes };

  const rootAbs = join(projectDir, PAGES_SUBDIR);
  if (!existsSync(rootAbs)) return { routes };

  const stack = [rootAbs];
  const files = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(abs); continue; }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.liquid')) continue;
      files.push(abs);
    }
  }

  for (const abs of files) {
    let raw;
    try { raw = readFileSync(abs, 'utf8'); }
    catch { continue; }

    const rel = relative(rootAbs, abs).split(sep).join('/');
    const { slug, method } = extractFrontmatter(raw);

    const route = normalizeRoute(slug ?? routeFromPath(rel));
    const m = (method ?? 'get').toLowerCase();
    if (!routes.has(route)) routes.set(route, new Set());
    routes.get(route).add(m);
  }

  return { routes };
}

/**
 * Read a tiny slice of frontmatter — only what the route check needs. We do
 * NOT pull in the full liquid-html-parser here: this index runs on every
 * validate_code call, so the cheap regex over the head of the file is the
 * right tradeoff. Frontmatter, when present, is `---` ... `---` at the
 * start of the file; ignoring everything after the closing `---` keeps a
 * page that has the word "slug:" in its body from contaminating the route.
 */
function extractFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return { slug: null, method: null };
  const head = m[1];
  const slug = head.match(/^slug:\s*(.+?)\s*$/m)?.[1] ?? null;
  const method = head.match(/^method:\s*(.+?)\s*$/m)?.[1] ?? null;
  return { slug, method };
}

function routeFromPath(relUnderPages) {
  // Strip .html.liquid or .liquid
  let p = relUnderPages.replace(/\.html\.liquid$/, '').replace(/\.liquid$/, '');
  return p;
}

/**
 * Normalize a route into the canonical key the index uses.
 * - strip leading slashes
 * - collapse a trailing `/index` (the directory itself is the route)
 * - root page becomes the empty string
 */
export function normalizeRoute(raw) {
  if (typeof raw !== 'string') return '';
  let p = raw.trim();
  while (p.startsWith('/')) p = p.slice(1);
  if (p === 'index') return '';
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  return p;
}

/**
 * Parse a MissingPage diagnostic message and return `{ route, method }` or
 * null when the message does not match. The known shapes are:
 *   - "No page found for route '/notes' (GET)"
 *   - "Page 'blog_posts/show' not found"
 *   - "Missing page at slug 'blog_posts'"
 * Method defaults to 'get' when not present.
 */
export function parseMissingPageMessage(message) {
  if (!message) return null;
  const quoted = message.match(/['"`]([^'"`]+)['"`]/);
  if (!quoted) return null;
  const route = normalizeRoute(quoted[1]);
  const methodMatch = message.match(/\(([A-Za-z]+)\)/);
  const method = (methodMatch?.[1] ?? 'get').toLowerCase();
  return { route, method };
}

/**
 * Lookup helper. Returns one of:
 *   - { status: 'exists' }                       — a page serves that route+method
 *   - { status: 'wrong-method', methods: [...] } — route exists, but for other methods
 *   - { status: 'missing' }                      — no page serves that route at all
 */
export function resolvePageRoute(reportedRoute, reportedMethod, index) {
  const route = normalizeRoute(reportedRoute);
  const methods = index.routes.get(route);
  if (!methods) return { status: 'missing' };
  if (methods.has(reportedMethod)) return { status: 'exists' };
  return { status: 'wrong-method', methods: [...methods] };
}
