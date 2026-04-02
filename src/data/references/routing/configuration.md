# Routing Configuration

Configure how platformOS converts file-based pages into HTTP routes with dynamic parameters, content types, and matching rules.

## Overview

File-based routing automatically maps pages in `app/views/pages/` to URL routes. Pages become endpoints without explicit route configuration.

## Slug Syntax

The page filename (without extension) becomes the URL slug. Use special characters and syntax for dynamic routes:

### Static Routes

```
app/views/pages/about.liquid → /about
app/views/pages/contact-us.liquid → /contact-us
app/views/pages/products/all.liquid → /products/all
```

### Dynamic Parameters

Replace filename segments with `:param` syntax:

```
app/views/pages/posts/:id.liquid → /posts/123
app/views/pages/users/:username.liquid → /users/john-doe
app/views/pages/categories/:category/items/:item_id.liquid → /categories/tech/items/42
```

Parameters capture URL segments and populate `context.params`.

### Wildcard Routes

Use `*` prefix to capture remaining path segments:

```
app/views/pages/*path.liquid → /anything/deep/in/url
app/views/pages/files/*filepath.liquid → /files/docs/2025/readme.txt
```

Wildcard captures entire remaining path as single parameter: `context.params.path` or `context.params.filepath`.

### Optional Segments

Wrap path segments in parentheses for optional parts:

```
app/views/pages/posts(/:page).liquid → matches /posts and /posts/2
app/views/pages/api/(/:version)/data.liquid → /api/data and /api/v2/data
```

## Front Matter Configuration

Define routing behavior in YAML front matter at file top:

### Method Property

Specify HTTP method handling:

```yaml
---
method: get
---
```

Valid values: `get`, `post`, `put`, `delete`, `patch`. Default: `get`.

One method per file. Create separate files for different methods on same route:

```
app/views/pages/articles/:id.liquid (method: get)
app/views/pages/articles/:id/update.liquid (method: post)
app/views/pages/articles/:id/delete.liquid (method: delete)
```

### Complete Front Matter Example

```yaml
---
method: post
slug: api/users/:id
---
```

## Content Type Mapping by Extension

platformOS determines response content type from file extension:

| Extension | Content-Type | Usage |
|-----------|--------------|-------|
| `.liquid` | `text/html` | HTML pages, forms, web UI |
| `.json.liquid` | `application/json` | JSON API responses |
| `.xml.liquid` | `application/xml` | XML feeds, API responses |
| `.txt.liquid` | `text/plain` | Plain text, logs |
| `.csv.liquid` | `text/csv` | CSV exports, data downloads |

Example files:

```
app/views/pages/posts/:id.liquid → Content-Type: text/html
app/views/pages/api/posts/:id.json.liquid → Content-Type: application/json
app/views/pages/feed.xml.liquid → Content-Type: application/xml
```

## Route Priority & Matching Rules

Routes are matched in specificity order:

1. **Exact static routes** (highest priority)
   ```
   /about → matches exactly
   ```

2. **Dynamic routes with parameters**
   ```
   /posts/:id → matches /posts/123
   ```

3. **Optional segments**
   ```
   /posts(/:page) → matches /posts and /posts/2
   ```

4. **Wildcard routes** (lowest priority)
   ```
   /files/* → matches /files/anything/deeply/nested
   ```

Specific routes take precedence over general ones:

```
/posts/latest.liquid (matches /posts/latest)
/posts/:id.liquid (matches /posts/123 but NOT /posts/latest)
```

## Nested Directory Structure

Directory structure mirrors URL hierarchy:

```
app/views/pages/
├── index.liquid (/)
├── about.liquid (/about)
├── products/
│   ├── index.liquid (/products)
│   └── :id.liquid (/products/123)
├── api/
│   ├── v1/
│   │   └── users/:id.json.liquid (/api/v1/users/123.json)
│   └── v2/
│       └── users/:id.json.liquid (/api/v2/users/123.json)
```

## Query Parameters

Query strings in URLs don't require route configuration. Access via `context.params`:

```
GET /search?q=liquid&sort=date

# In page
{{ context.params.q }}     → "liquid"
{{ context.params.sort }}  → "date"
```

## See Also

- [API Reference](./api.md) - context.params, context.location, response tags
- [Patterns](./patterns.md) - RESTful routes, nested routes, API endpoints
- [Advanced](./advanced.md) - Wildcard routes, content negotiation, route priority
- [Troubleshooting](./gotchas.md) - Common routing errors and solutions
