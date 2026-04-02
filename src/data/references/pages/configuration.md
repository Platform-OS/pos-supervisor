# Pages -- Configuration Reference

This document covers all configuration options for page files in `app/views/pages/`.

## Front Matter

Every page file can include YAML front matter between `---` delimiters at the top of the file. Front matter configures routing, layout, and metadata.

```liquid
---
slug: products/:id
method: get
layout: application
metadata:
  title: "Product Details"
  description: "View a single product"
---
```

### Front matter properties

| Property   | Type   | Default         | Description                                      |
|------------|--------|-----------------|--------------------------------------------------|
| `slug`     | String | Derived from path | URL pattern for this page                      |
| `method`   | String | `get`           | HTTP method: `get`, `post`, `put`, `delete`      |
| `layout`   | String | `application`   | Layout template name (empty string for no layout)|
| `metadata` | Hash   | `{}`            | Arbitrary metadata accessible via `context.page`  |
| `response_headers` | Hash | `{}` | Custom HTTP response headers                      |
| `max_deep_level` | Int | `3` | Maximum nesting depth for recursive partials       |

**Important:** Do NOT use `authorization_policies` in front matter. Use `pos-module-user` helpers for access control instead.

## Slug Configuration

The slug determines the URL path for a page. If omitted, the slug is derived from the file path relative to `app/views/pages/`.

### Automatic slug from file path

| File Path                                | Auto Slug          |
|------------------------------------------|--------------------|
| `app/views/pages/index.liquid`           | `/`                |
| `app/views/pages/about.liquid`           | `about`            |
| `app/views/pages/products/index.liquid`  | `products`         |
| `app/views/pages/api/v1/users.json.liquid` | `api/v1/users`   |

### Dynamic slug patterns

```yaml
slug: products/:id                   # named parameter
slug: files/*path                    # wildcard (captures everything)
slug: search(/:query)                # optional parameter
slug: users/:user_id/orders/:id      # multiple named parameters
slug: api/v1/items/:id(/:action)     # mixed patterns
```

### Parameter extraction

Parameters from slugs are available in `context.params`:

```liquid
{% comment %} slug: users/:user_id/orders/:id {% endcomment %}
{{ context.params.user_id }}  {% comment %} "5" {% endcomment %}
{{ context.params.id }}       {% comment %} "10" {% endcomment %}
```

## Method Configuration

Each page handles exactly one HTTP method. Create separate files for different methods on the same resource.

```yaml
method: get      # Read operations (default)
method: post     # Create operations
method: put      # Update operations
method: delete   # Delete operations
```

Multiple files can share the same slug if they have different methods:

```
app/views/pages/products/
  show.liquid        # slug: products/:id, method: get
  update.liquid      # slug: products/:id, method: put
  delete.liquid      # slug: products/:id, method: delete
```

## Layout Configuration

```yaml
layout: application      # Use app/views/layouts/application.liquid (default)
layout: admin            # Use app/views/layouts/admin.liquid
layout: mailer           # Use app/views/layouts/mailer.liquid
layout: ""               # No layout -- raw output
```

For JSON and JS endpoints, typically set `layout: ""`:

```liquid
---
slug: api/products
layout: ""
---
{% liquid
  graphql products = 'products/search'
  render 'api/products/list', products: products
%}
```

## Metadata Configuration

Metadata is arbitrary YAML accessible at `context.page.metadata`:

```yaml
metadata:
  title: "Product Listing"
  description: "Browse all available products"
  og_image: "products-hero.jpg"
  requires_auth: true
```

Access in layouts or partials:

```liquid
<title>{{ context.page.metadata.title }}</title>
<meta name="description" content="{{ context.page.metadata.description }}">
```

## Response Headers

Set custom HTTP headers on the response:

```yaml
response_headers:
  X-Frame-Options: DENY
  Cache-Control: "public, max-age=3600"
  Access-Control-Allow-Origin: "*"
```

## File Structure

```
app/views/pages/
├── index.liquid                    # GET /
├── products/
│   ├── index.liquid                # GET /products
│   ├── show.liquid                 # GET /products/:id
│   ├── new.liquid                  # GET /products/new
│   ├── create.liquid               # POST /products
│   ├── edit.liquid                 # GET /products/:id/edit
│   ├── update.liquid               # PUT /products/:id
│   └── delete.liquid               # DELETE /products/:id
├── api/
│   └── products/
│       ├── index.json.liquid       # GET /api/products.json
│       └── show.json.liquid        # GET /api/products/:id.json
└── admin/
    └── dashboard.liquid            # GET /admin/dashboard
```

## CSRF Protection

Non-GET requests require a CSRF token. Forms must include:

```liquid
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

Or use the `csrf_token_tag` filter (if available via modules).

## See Also

- [Pages Overview](README.md) -- introduction and key concepts
- [Pages API](api.md) -- runtime tags and filters used in pages
- [Routing Configuration](../routing/configuration.md) -- URL pattern details
- [Layouts Configuration](../layouts/configuration.md) -- layout selection options
