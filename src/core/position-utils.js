/**
 * Shared position utilities — offset ↔ line:col conversion and path helpers.
 *
 * Single source of truth for these functions (previously duplicated in
 * fix-generator.js and structural-warnings.js).
 */

/**
 * Convert a 0-based byte offset into a { line, character } position (both 0-based).
 */
export function offsetToLineCol(content, offset) {
  let line = 0, col = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') { line++; col = 0; } else { col++; }
  }
  return { line, character: col };
}

/**
 * Convert a 0-based line + column into a byte offset.
 */
export function lineColToOffset(content, line, col) {
  const lines = content.split('\n');
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  return offset + Math.min(col, (lines[line] ?? '').length);
}

/**
 * Derive a suggested slug from a page file path:
 *   app/views/pages/blog_posts/show.html.liquid → blog_posts/show
 *   app/views/pages/blog_posts/new.liquid       → blog_posts/new
 *   app/views/pages/index.liquid                → '' (root)
 *
 * Handles both relative and absolute paths.
 */
export function slugFromPath(filePath) {
  if (!filePath) return 'your-page-url';
  // Strip everything up to and including app/views/pages/ — works for both
  // relative paths (app/views/pages/...) and absolute paths (/home/.../app/views/pages/...)
  const rel = filePath
    .replace(/^.*app\/views\/pages\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
  if (rel === 'index') return '';
  return rel;
}
