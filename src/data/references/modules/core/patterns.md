# pos-module-core -- Patterns & Best Practices

Common workflows and real-world patterns for the core module.

## Standard Create Command

The most common pattern: validate input and create a record.

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% liquid
  function object = 'modules/core/commands/build', object: params

  assign validators = [
    { "name": "presence", "property": "title" },
    { "name": "presence", "property": "price" },
    { "name": "numericality", "property": "price", "options": { "greater_than": 0 } },
    { "name": "length", "property": "title", "options": { "minimum": 3, "maximum": 255 } },
    { "name": "uniqueness", "property": "slug", "options": { "table": "product" } }
  ]
  function object = 'modules/core/commands/check', object: object, validators: validators

  if object.errors != blank
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/create',
    selection: 'record_create',
    object: object

  function _ = 'modules/core/commands/events/publish', type: 'product_created', object: object

  return object
%}
```

## Standard Update Command

Update differs from create: you load the existing record first, merge changes, then validate.

```liquid
{% comment %} app/lib/commands/products/update.liquid {% endcomment %}
{% liquid
  graphql result = 'products/find', id: id
  assign existing = result.records.results.first
  if existing == blank
    assign error = { "errors": { "base": ["Record not found"] } }
    return error
  endif

  assign params['id'] = id
  function object = 'modules/core/commands/build', object: params

  assign validators = [{ "name": "presence", "property": "title" }, { "name": "numericality", "property": "price", "options": { "greater_than": 0 } }]
  function object = 'modules/core/commands/check', object: object, validators: validators

  if object.errors != blank
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/update',
    selection: 'record_update',
    object: object

  return object
%}
```

## Standard Delete Command

Delete is simpler -- typically no validation needed.

```liquid
{% comment %} app/lib/commands/products/delete.liquid {% endcomment %}
{% liquid
  assign object = { "id": id }

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/delete',
    selection: 'record_delete',
    object: object

  function _ = 'modules/core/commands/events/publish', type: 'product_deleted', object: object

  return object
%}
```

## Calling Commands from Pages

Pages call commands and handle the result:

```liquid
{% comment %} app/views/pages/products/create.liquid {% endcomment %}
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

## Flash Message Pattern

Set a flash message before redirect, then display it on the target page via the layout:

```liquid
{% comment %} In a page: set flash then redirect {% endcomment %}
{% liquid
  function _ = 'modules/core/commands/session/set',
    key: 'sflash', value: 'Item saved successfully', from: context.location.pathname
  redirect_to '/items'
%}
```

```liquid
{% comment %} In layout or partial: read and display flash {% endcomment %}
{% liquid
  function flash = 'modules/core/commands/session/get', key: 'sflash'
  if flash != blank
    render 'shared/toast', message: flash
    function _ = 'modules/core/commands/session/clear', key: 'sflash'
  endif
%}
```

## Event Publishing Pattern

Publish events after successful mutations for decoupled side effects:

```liquid
{% comment %} After creating an order {% endcomment %}
{% function _ = 'modules/core/commands/events/publish',
  type: 'order_created',
  object: order
%}
```

Event consumers are defined in `app/lib/consumers/` and registered in schema. They run asynchronously.

## Redirect with Notice Pattern

Use the `redirect_to` helper for a one-liner:

```liquid
{% include 'modules/core/helpers/redirect_to',
  url: '/products', notice: 'app.product_created'
%}
```

This sets the flash notice using the translation key and redirects in a single call.

## Validation Error Display Pattern

Pass errors to the form partial and render them:

```liquid
{% comment %} In the form partial {% endcomment %}
{% if errors != blank %}
  <div class="pos-alert pos-alert--danger">
    {% for error in errors %}
      <p>{{ error[0] }}: {{ error[1] | join: ", " }}</p>
    {% endfor %}
  </div>
{% endif %}
```

## Best Practices

1. **Always use the command pattern** -- never call GraphQL mutations directly from pages
2. **Validate before executing** -- always call `check` before `execute`
3. **Return early on errors** -- check `object.errors` immediately after `check`
4. **Publish events for side effects** -- do not send emails or notifications inside commands; use events
5. **Use translation keys for flash** -- pass `'app.some_key'` not raw strings in production
6. **Keep validators in the command** -- do not scatter validation logic across pages
7. **One command per operation** -- separate create, update, delete into individual partials

## See Also

- [Core Overview](README.md) -- introduction and key concepts
- [Core API](api.md) -- all available functions
- [Core Configuration](configuration.md) -- installation and setup
- [Core Gotchas](gotchas.md) -- common errors and limits
- [Core Advanced](advanced.md) -- custom validators and overrides
- [Pages Patterns](../../pages/patterns.md) -- how pages call commands
- [Events & Consumers](../../events-consumers/README.md) -- event consumer setup
