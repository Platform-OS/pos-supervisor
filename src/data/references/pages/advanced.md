# Pages -- Advanced Topics

Edge cases, optimization strategies, and advanced patterns for platformOS pages.

## Optimizing GraphQL Calls

### Batching related data

Instead of multiple GraphQL calls, use `related_record` and `related_records` in a single query to fetch associated data:

```liquid
{% comment %} BAD: N+1 pattern {% endcomment %}
{% liquid
  graphql orders = 'orders/search'
  for order in orders.records.results
    graphql customer = 'customers/find', id: order.customer_id
  endfor
%}

{% comment %} GOOD: single query with relations {% endcomment %}
{% liquid
  graphql orders = 'orders/search_with_customers'
%}
```

The GraphQL query uses `related_record`:

```graphql
query {
  records(filter: { table: { value: "order" } }) {
    results {
      id
      customer: related_record(table: "customer", join_on_property: "customer_id") {
        name: property(name: "name")
        email
      }
    }
  }
}
```

### Conditional data fetching

Only fetch data when needed:

```liquid
{% liquid
  graphql product = 'products/find', id: context.params.id
  assign product = product.records.results.first
  if product == blank
    render '404'
    break
  endif
  if context.params.include_reviews == 'true'
    graphql reviews = 'reviews/for_product', product_id: context.params.id
    render 'products/show_with_reviews', product: product, reviews: reviews.records.results
    break
  endif
  render 'products/show', product: product
%}
```

## Content Negotiation

Serve different content types from the same slug using file extensions:

```
app/views/pages/products/show.liquid         # GET /products/:id     (HTML)
app/views/pages/products/show.json.liquid    # GET /products/:id.json (JSON)
app/views/pages/products/show.csv.liquid     # GET /products/:id.csv  (CSV)
```

Each file can share GraphQL queries but render different partials.

## Streaming Large Responses

For large data exports (CSV, XML), paginate through records:

```liquid
---
slug: exports/products
layout: ""
response_headers:
  Content-Disposition: "attachment; filename=products.csv"
---
{% liquid
  assign page = 1
  assign has_more = true
  render 'exports/csv_header'
  for i in (1..100)
    if has_more == false
      break
    endif
    graphql batch = 'products/search', page: page, limit: 100
    render 'exports/products_csv_rows', products: batch.records.results
    assign page = page | plus: 1
    if batch.records.has_next_page == false
      assign has_more = false
    endif
  endfor
%}
```

## Caching Strategies

### Page-level caching via response headers

```yaml
---
slug: products
response_headers:
  Cache-Control: "public, max-age=300"
  Vary: "Accept"
---
```

### Fragment caching in partials

Pages themselves do not cache, but they can delegate to partials that use `{% cache %}`:

```liquid
{% liquid
  graphql product = 'products/find', id: context.params.id
  assign product = product.records.results.first
  cache product.id, expire: 300
    render 'products/detail', product: product
  endcache
%}
```

## Middleware-Like Patterns

### Before-action via shared partial

Create a shared partial that runs common checks:

```liquid
{% comment %} app/lib/helpers/before_action.liquid {% endcomment %}
{% liquid
  function profile = 'modules/user/queries/user/current'
  assign context_data = {}
  assign context_data['profile'] = profile
  assign context_data['is_admin'] = false
  if profile.role == 'admin'
    assign context_data['is_admin'] = true
  endif
  return context_data
%}
```

Use in every page:

```liquid
{% liquid
  function ctx = 'lib/helpers/before_action'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: ctx.profile, do: 'admin.access'
  graphql data = 'admin/dashboard_stats'
  render 'admin/dashboard', data: data, ctx: ctx
%}
```

## Error Handling Pages

### Custom 404 page

Create `app/views/pages/404.liquid`:

```liquid
---
slug: 404
layout: application
---
{% liquid
  render 'errors/not_found'
%}
```

### Handling GraphQL errors

```liquid
{% liquid
  graphql result = 'products/create', title: context.params.title
  if result.errors != blank
    log result.errors, type: 'error'
    render 'shared/error', errors: result.errors
    break
  endif
  redirect_to '/products/' | append: result.record_create.id
%}
```

## Multi-Tenant Pages

Use slug parameters to scope requests to a tenant:

```liquid
---
slug: :tenant/products
---
{% liquid
  assign tenant = context.params.tenant
  graphql products = 'products/search_by_tenant', tenant: tenant
  render 'products/index', products: products.records.results, tenant: tenant
%}
```

## Background Job Trigger Pages

Pages can trigger async background jobs:

```liquid
---
slug: admin/exports/start
method: post
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.export'
  graphql _ = 'background/trigger_export', user_id: profile.id
  function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'Export started. You will receive an email when complete.', from: context.location.pathname
  redirect_to '/admin/exports'
%}
```

## String Interpolation in Double-Quoted Strings

Enabled per-instance via `config.yml`:

```yaml
string_interpolation: true
```

When enabled, `{{ variable }}` expressions inside double-quoted strings are evaluated:

```liquid
{% assign greeting = "Hello, {{ context.current_user.name }}!" %}
{% assign url = "https://example.com/products/{{ product.id }}" %}
{% assign label = "{{ product.title | upcase | truncate: 30 }}" %}
{% assign full_name = "{{ first }} {{ last }}" %}
```

Works with: `assign`, `function`, `background`, `export`, `log`. Single-quoted strings **never** interpolate.

**Note:** Disabled by default on existing instances for backwards compatibility. New instances have it enabled. If your templates use double-quoted strings with literal `{{ }}` text (not meant as variables), enabling interpolation will break those strings.

## Performance Checklist

1. Minimize GraphQL calls per page (ideally 1-2)
2. Use `related_record`/`related_records` to avoid N+1 queries
3. Set `per_page` limits on all list queries
4. Use `layout: ""` for API endpoints to skip layout rendering
5. Leverage response headers for HTTP caching on public pages
6. Use `break` to short-circuit execution on errors/404s
7. Avoid deeply nested partial chains (keep under 3 levels)

## See Also

- [Pages Overview](README.md) -- introduction and key concepts
- [Pages Patterns](patterns.md) -- standard workflows
- [Pages Gotchas](gotchas.md) -- common errors and limits
- [GraphQL Advanced](../graphql/README.md) -- optimizing queries
- [Caching Reference](../caching/README.md) -- caching strategies
- [Background Jobs](../background-jobs/README.md) -- async processing
