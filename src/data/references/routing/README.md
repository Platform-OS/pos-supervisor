# Routing & URLs

Routing in platformOS is file-based. Page files in `app/views/pages/` automatically become URL endpoints.

## File-to-URL Mapping

| File Path | URL |
|-----------|-----|
| `app/views/pages/index.liquid` | `/` |
| `app/views/pages/products/index.liquid` | `/products` |
| `app/views/pages/products/show.liquid` | Depends on slug |
| `app/views/pages/api/data.json.liquid` | `/api/data.json` |

## Dynamic Route Patterns

Define in page front matter with `slug:`:

| Pattern | URL Example | `context.params` |
|---------|-------------|-------------------|
| `products/:id` | `/products/123` | `{ "id": "123" }` |
| `users/:user_id/orders/:id` | `/users/5/orders/10` | `{ "user_id": "5", "id": "10" }` |
| `files/*path` | `/files/a/b.txt` | `{ "path": "a/b.txt" }` |
| `search(/:query)` | `/search/books` | `{ "query": "books" }` |
| `search(/:query)` | `/search` | `{ "query": null }` |

## HTTP Methods

Each file handles one method, specified in front matter:

```liquid
---
slug: products/:id
method: put
---
```

| Method | Default | Usage |
|--------|---------|-------|
| `get` | Yes | Read/display data |
| `post` | No | Create resources |
| `put` | No | Update resources |
| `delete` | No | Delete resources |

## Query Parameters

Access via `context.params`:

URL: `/products?page=2&sort=price`
```liquid
{{ context.params.page }}   → "2"
{{ context.params.sort }}   → "price"
```

## Redirects

```liquid
{% redirect_to '/products' %}
{% redirect_to '/products', status: 301 %}
{% redirect_to context.params.return_url %}
```

## URL Helpers

```liquid
{{ context.location.pathname }}   → /products/123
{{ context.location.search }}     → ?page=2
{{ context.location.host }}       → example.com
{{ context.location.href }}       → https://example.com/products/123?page=2
```

## Content Types by Extension

| Extension | Content-Type |
|-----------|--------------|
| `.liquid` / `.html.liquid` | `text/html` |
| `.json.liquid` | `application/json` |
| `.js.liquid` | `application/javascript` |
| `.xml.liquid` | `application/xml` |
| `.csv.liquid` | `text/csv` |
