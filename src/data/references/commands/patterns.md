# Commands -- Common Patterns

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). The
> build/check phases live in your APP commands, not in
> `modules/core/commands/`. Only `modules/core/commands/execute` runs at the
> module top level. See [modules/core/patterns.md](../modules/core/patterns.md)
> for the authoritative module-level pattern.

## Pattern: Basic CRUD Command (canonical)

A command is **three** files per action: an orchestrator and two phase
files (`build`, `check`) under a sibling directory. The orchestrator
calls them in order, then invokes `modules/core/commands/execute` for
the GraphQL mutation. There is **no** `modules/core/commands/build` or
`modules/core/commands/check` — those phases are app-level.

```
app/lib/commands/products/
├── create.liquid              # orchestrator
├── create/
│   ├── build.liquid           # your build phase
│   └── check.liquid           # your check phase
├── update.liquid
├── update/
│   ├── build.liquid
│   └── check.liquid
└── delete.liquid              # delete typically skips build/check
```

### Orchestrator (`app/lib/commands/products/create.liquid`)

```liquid
{% doc %}
  @param {object} params - raw input (typically context.params.product)
{% enddoc %}
{% liquid
  function object = 'commands/products/create/build', object: params
  function object = 'commands/products/create/check', object: object

  if object.valid == false
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/create',
    selection: 'record_create',
    object: object

  return object
%}
```

### Build phase (`app/lib/commands/products/create/build.liquid`)

The build phase normalizes input and seeds the validation contract.

```liquid
{% doc %}
  @param {object} object - raw input from the orchestrator
{% enddoc %}
{% liquid
  assign object = object | hash_merge: valid: true, errors: empty
  return object
%}
```

### Check phase (`app/lib/commands/products/create/check.liquid`)

The check phase chains validators directly. Each call to a validator
returns the contract `c`; thread it through every call. At the end set
`object.errors` and `object.valid`.

```liquid
{% doc %}
  @param {object} object - object built by the build phase
{% enddoc %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'title', object: object

  function c = 'modules/core/lib/validations/length',
    c: c, field_name: 'title', object: object, min: 3, max: 255

  function c = 'modules/core/lib/validations/number',
    c: c, field_name: 'price', object: object, gt: 0

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

### Page calling the command

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

  function result = 'commands/products/create', params: context.params.product

  if result.valid
    function _ = 'modules/core/helpers/redirect_to',
      url: '/products', notice: 'app.products.created'
  else
    render 'products/form', product: result
  endif
%}
```

## Pattern: Update Command

Update loads the existing record first, merges params on top, validates,
executes.

```liquid
{% comment %} app/lib/commands/products/update.liquid {% endcomment %}
{% doc %}
  @param {string} id     - record id
  @param {object} params - raw input
{% enddoc %}
{% liquid
  function existing = 'queries/products/find', id: id
  if existing == blank
    return { valid: false, errors: { base: ['Record not found'] } }
  endif

  assign params['id'] = id
  function object = 'commands/products/update/build',
    object: params, existing: existing
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

## Pattern: Delete Command

Delete usually skips build/check (the page-level auth helper already
gated it) and calls `execute` directly.

```liquid
{% comment %} app/lib/commands/products/delete.liquid {% endcomment %}
{% doc %}
  @param {string} id - record id
{% enddoc %}
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

## Pattern: Command with Event Publishing

Publish an event AFTER `execute` succeeds to trigger side effects
(notifications, audit logs, downstream consumers).

```liquid
{% comment %} app/lib/commands/orders/create.liquid orchestrator {% endcomment %}
{% liquid
  function object = 'commands/orders/create/build', object: params
  function object = 'commands/orders/create/check', object: object
  if object.valid == false
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'orders/create',
    selection: 'record_create',
    object: object

  function _ = 'modules/core/commands/events/publish',
    type: 'order_created', object: object

  return object
%}
```

## Pattern: Conditional Validation

Validators are called individually as `{% function %}` calls. To branch
on a field value, simply place validator calls inside `if` blocks
inside the check phase — no array config needed.

```liquid
{% comment %} app/lib/commands/users/create/check.liquid {% endcomment %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'email', object: object
  function c = 'modules/core/lib/validations/matches',
    c: c, field_name: 'email', object: object,
    regexp: '^[^@]+@[^@]+\.[^@]+$', allow_blank: true

  if object.role == 'admin'
    function c = 'modules/core/lib/validations/presence',
      c: c, field_name: 'admin_code', object: object
  endif

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

## Pattern: Displaying Validation Errors

Render errors in a form partial. The contract is a hash keyed by
`field_name`; each value is an array of translation keys.

```liquid
{% comment %} app/views/partials/products/form.liquid {% endcomment %}
{% if product.errors != empty %}
  <div class="pos-alert pos-alert--danger">
    <ul>
      {% for error in product.errors %}
        <li>{{ error[0] }}: {{ error[1] | join: ', ' | t }}</li>
      {% endfor %}
    </ul>
  </div>
{% endif %}

<form action="/products" method="post">
  {% render 'authenticity_token' %}
  <input type="text" name="product[title]" value="{{ product.title }}">
  {% if product.errors.title %}
    <span class="pos-form-error">{{ product.errors.title | first | t }}</span>
  {% endif %}
  <button type="submit">Save</button>
</form>
```

## Pattern: Calling One Command from Another

Commands compose by calling other orchestrators directly with
`{% function %}`. Each composed command is a self-contained
build → check → execute sequence.

```liquid
{% comment %} app/lib/commands/orders/create_with_items.liquid {% endcomment %}
{% doc %}
  @param {string} user_id
  @param {number} total
  @param {array}  items
{% enddoc %}
{% liquid
  function order = 'commands/orders/create',
    params: { user_id: user_id, total: total }

  if order.valid
    for item in items
      function line = 'commands/order_items/create',
        params: { order_id: order.id, product_id: item.product_id, quantity: item.quantity }
    endfor
  endif

  return order
%}
```

## Best Practices

1. **One responsibility per command** — a command does one thing
   (create a product, update an order).
2. **Always return the object** — callers rely on `result.valid` and
   `result.errors`.
3. **Three files per command** — orchestrator + `<action>/build.liquid` +
   `<action>/check.liquid`. Run `pos-cli generators run crud
   --resource <name> --include-views` to scaffold the canonical layout.
4. **Use hash literals with `assign`** — build data objects via
   `{% assign object = { "key": variable } %}` rather than the deprecated
   `parse_json` tag.
5. **Keep pages thin** — pages call commands and handle routing; no
   business logic in pages.
6. **Validate everything** — never trust user input; always include a
   check phase. Each validator call returns the contract — thread it
   through.
7. **Use canonical validator paths** — always
   `modules/core/lib/validations/<name>` (note the `lib/`). The path
   `modules/core/validations/<name>` does not exist.

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- File layout and setup
- [api.md](api.md) -- Validator family + option names
- [gotchas.md](gotchas.md) -- Common mistakes (esp. phantom build/check)
- [advanced.md](advanced.md) -- Nested commands, background jobs, transactions
- [modules/core/patterns.md](../modules/core/patterns.md) -- Authoritative
  module-level pattern (this file mirrors it for the commands domain).
- [Forms Reference](../forms/) -- Building forms that submit to commands
