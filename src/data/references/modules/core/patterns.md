# pos-module-core — Patterns

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). The
> build/check phases live in your APP commands, not in
> `modules/core/commands/`. Only `commands/execute` runs at the top level.

## Standard Create Command

Three files: the orchestrator, your build, your check. The orchestrator
calls them in order, then `modules/core/commands/execute` for the
mutation. Generated automatically by `pos-cli generators run crud
--resource <name>`.

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% liquid
  function object = 'commands/products/create/build',  object: params
  function object = 'commands/products/create/check',  object: object
  if object.valid == false
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/create',
    selection: 'record_create',
    object: object

  function _ = 'modules/core/commands/events/publish',
    type: 'product_created', object: object

  return object
%}
```

```liquid
{% comment %} app/lib/commands/products/create/build.liquid {% endcomment %}
{% doc %}
  @param {object} object - raw input (typically context.params)
{% enddoc %}
{% liquid
  assign object = object | hash_merge: valid: true, errors: empty
  return object
%}
```

```liquid
{% comment %} app/lib/commands/products/create/check.liquid {% endcomment %}
{% doc %}
  @param {object} object - object to validate
{% enddoc %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'title', object: object

  function c = 'modules/core/lib/validations/number',
    c: c, field_name: 'price', object: object, gt: 0

  function c = 'modules/core/lib/validations/length',
    c: c, field_name: 'title', object: object, min: 3, max: 255

  function c = 'modules/core/lib/validations/uniqueness',
    c: c, field_name: 'slug', object: object, table: 'product'

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

## Standard Update Command

Update loads the existing record first, merges, validates, executes.

```liquid
{% comment %} app/lib/commands/products/update.liquid {% endcomment %}
{% liquid
  function existing = 'queries/products/find', id: id
  if existing == blank
    return { valid: false, errors: { base: ['Record not found'] } }
  endif

  assign params['id'] = id
  function object = 'commands/products/update/build', object: params, existing: existing
  function object = 'commands/products/update/check', object: object
  if object.valid == false
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

Delete usually skips check (the page-level auth helper already gated it).

```liquid
{% comment %} app/lib/commands/products/delete.liquid {% endcomment %}
{% liquid
  assign object = { id: id }

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/delete',
    selection: 'record_delete',
    object: object

  function _ = 'modules/core/commands/events/publish',
    type: 'product_deleted', object: object

  return object
%}
```

## Calling Commands from Pages

```liquid
{% comment %} app/views/pages/products/create.liquid {% endcomment %}
---
slug: products
method: post
---
{% liquid
  graphql current_user = 'modules/user/queries/user/current'
  function _ = 'modules/user/helpers/can_do_or_unauthorized',
    requester: current_user, do: 'products.create'

  function result = 'commands/products/create', params: context.params

  if result.valid == false
    render 'products/new', errors: result.errors, params: context.params
    break
  endif

  function _ = 'modules/core/commands/session/set',
    key: 'sflash', value: 'Product created',
    from: context.location.pathname
  redirect_to '/products'
%}
```

Note: helpers use `{% function %}` and `do:` (modernized canonical) — never
`{% include %}` or `with_action:`.

## Flash Message Pattern

```liquid
{% comment %} Set flash before redirect {% endcomment %}
{% liquid
  function _ = 'modules/core/commands/session/set',
    key: 'sflash', value: 'Item saved.',
    from: context.location.pathname
  redirect_to '/items'
%}
```

```liquid
{% comment %} Layout or shared partial: read + clear {% endcomment %}
{% liquid
  function flash = 'modules/core/commands/session/get', key: 'sflash'
  if flash != blank
    render 'shared/toast', message: flash
    function _ = 'modules/core/commands/session/clear', key: 'sflash'
  endif
%}
```

## Event Publishing

```liquid
{% function _ = 'modules/core/commands/events/publish',
   type: 'order_created', object: order %}
```

Subscribers (defined in `app/lib/events/`) consume the event asynchronously.
Use `events/broadcast` for fan-out to multiple type-prefixed consumers.

## Redirect with Notice (one-liner)

```liquid
{% function _ = 'modules/core/helpers/redirect_to',
   url: '/products', notice: 'app.product_created' %}
```

Sets the `sflash` session value via the translation key, then redirects.

## Validation Error Display

```liquid
{% comment %} In the form partial {% endcomment %}
{% if errors != blank %}
  <div class="pos-toast pos-toast-error">
    {% for error in errors %}
      <p>{{ error[0] }}: {{ error[1] | join: ', ' }}</p>
    {% endfor %}
  </div>
{% endif %}
```

(`pos-toast-*` is the canonical notification style; see common-styling.)

## Best Practices

1. Use the command pattern — never call mutations directly from pages.
2. Validate before executing — `check` runs before `execute`.
3. Return early on `object.valid == false`.
4. Publish events for side effects (emails, notifications, audit logs).
5. Use translation keys for flash messages, not raw strings.
6. Keep validators inside the `check` partial; pages stay thin.
7. One command per operation (create / update / delete are separate files).
8. Use `pos-cli generators run crud --resource <name>` to scaffold the
   build/check/execute trio with the canonical wiring.

## See Also

- [Core Overview](README.md)
- [Core API](api.md) — validator family + option names
- [Core Configuration](configuration.md)
- [Core Gotchas](gotchas.md) — esp. "core/commands/build doesn't exist"
- [Core Advanced](advanced.md) — custom validators, event chaining
