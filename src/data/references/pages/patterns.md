# Pages -- Patterns & Best Practices

Common workflows and real-world patterns for page files in platformOS.

## Standard CRUD Resource

The most common pattern: a full set of pages for managing a resource.

### List page (GET)

```liquid
---
slug: products
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.list'
  assign page = context.params.page | default: 1 | plus: 0
  graphql result = 'products/search', page: page
  render 'products/index', products: result.records.results, total_pages: result.records.total_pages, current_page: page
%}
```

### Show page (GET)

```liquid
---
slug: products/:id
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.view'
  graphql result = 'products/find', id: context.params.id
  assign product = result.records.results.first
  if product == blank
    render '404'
    break
  endif
  render 'products/show', product: product
%}
```

### Create page (POST)

```liquid
---
slug: products
method: post
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.create'
  function result = 'lib/commands/products/create', params: context.params
  if result.errors != blank
    render 'products/new', errors: result.errors, params: context.params
    break
  endif
  function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'Product created', from: context.location.pathname
  redirect_to '/products'
%}
```

### Update page (PUT)

```liquid
---
slug: products/:id
method: put
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.edit'
  function result = 'lib/commands/products/update', id: context.params.id, params: context.params
  if result.errors != blank
    render 'products/edit', errors: result.errors, params: context.params, id: context.params.id
    break
  endif
  function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'Product updated', from: context.location.pathname
  redirect_to '/products/' | append: context.params.id
%}
```

### Delete page (DELETE)

```liquid
---
slug: products/:id
method: delete
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.delete'
  graphql _ = 'products/delete', id: context.params.id
  function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'Product deleted', from: '/products'
  redirect_to '/products'
%}
```

## API Endpoint Pattern

Return JSON instead of rendering HTML.

```liquid
---
slug: api/products
layout: ""
---
{% liquid
  assign page = context.params.page | default: 1 | plus: 0
  graphql result = 'products/search', page: page
  render 'api/products/list', products: result.records.results
%}
```

The partial (`api/products/list.liquid`) outputs JSON:

```json
{
  "products": [
    {% for product in products %}
      { "id": {{ product.id }}, "title": {{ product.title | json }} }{% unless forloop.last %},{% endunless %}
    {% endfor %}
  ]
}
```

For `.json.liquid` files the content type is set automatically.

## Flash Message Pattern

Set a flash message before redirecting, then display it via the layout toast system.

```liquid
{% liquid
  function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'Operation successful', from: context.location.pathname
  redirect_to '/products'
%}
```

The `from` parameter ensures the flash is cleared after being shown on the target page.

## Authentication Guard Pattern

Every page that requires login should check authentication early:

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'resource.action'
%}
```

This will redirect unauthenticated users automatically.

## Conditional Rendering Pattern

Use `break` to exit early after rendering an error or alternate view:

```liquid
{% liquid
  graphql result = 'products/find', id: context.params.id
  assign product = result.records.results.first
  if product == blank
    render '404'
    break
  endif
  if product.status == 'draft'
    render 'products/preview', product: product
    break
  endif
  render 'products/show', product: product
%}
```

## Form Handling Pattern

A GET page renders the form; a POST page processes the submission:

```liquid
{% comment %} GET: products/new.liquid {% endcomment %}
---
slug: products/new
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.create'
  render 'products/form', action: '/products', method: 'post'
%}
```

The form partial includes CSRF token and submits to the POST endpoint.

## Best Practices

1. **Keep pages thin** -- pages should be 5-15 lines of Liquid logic maximum
2. **Authenticate first** -- always check permissions before fetching data
3. **Use `break` for early returns** -- render an error view and `break` to stop execution
4. **One method per file** -- never check `context.method` to branch logic
5. **No HTML in pages** -- all markup lives in partials
6. **No GraphQL in partials** -- always fetch in the page and pass data down
7. **Flash before redirect** -- set session flash, then redirect
8. **Use translations** -- never hardcode user-facing text in pages or partials

## See Also

- [Pages Overview](README.md) -- introduction and key concepts
- [Pages Configuration](configuration.md) -- front matter and file structure
- [Pages API](api.md) -- tags and filters available in pages
- [Pages Gotchas](gotchas.md) -- common errors and limits
- [Partials Patterns](../partials/patterns.md) -- patterns for the partials pages delegate to
- [Commands Reference](../commands/README.md) -- the command pattern used in create/update
