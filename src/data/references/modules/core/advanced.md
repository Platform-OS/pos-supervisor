# pos-module-core — Advanced Topics

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Custom Validators

Validators are plain Liquid partials that take a contract `c`, a
`field_name`, and the `object` plus any validator-specific options.
They APPEND to the contract via `modules/core/helpers/register_error`
and return the updated contract.

### Creating a custom validator

```liquid
{% comment %} app/lib/validations/phone_number.liquid {% endcomment %}
{% doc %}
  @param {object} c - error contract
  @param {string} field_name - field to validate
  @param {object} object - object under validation
  @param {string} message - optional override for the error message
{% enddoc %}
{% liquid
  assign value = object[field_name]
  assign phone_regex = '^\+?[0-9]{10,15}$'
  if value != blank
    assign ok = value | matches: phone_regex
    if ok != true
      assign message = message | default: 'errors.phone_invalid' | t
      function c = 'modules/core/helpers/register_error',
        contract: c, field_name: field_name, message: message, key: null
    endif
  endif
  return c
%}
```

### Calling it from your check partial

```liquid
{% function c = 'lib/validations/phone_number',
   c: c, field_name: 'phone', object: object %}
```

The same calling convention works whether the validator is shipped
(`modules/core/lib/validations/...`), an override
(`app/modules/core/public/lib/validations/...`), or a fully custom
app-level one (`app/lib/validations/...`).

## Overriding Built-in Validators

To customize a shipped validator (e.g. tighter error messages):

```bash
mkdir -p app/modules/core/public/lib/validations
cp modules/core/public/lib/validations/presence.liquid \
   app/modules/core/public/lib/validations/presence.liquid
```

Edit the copy. The override at `app/modules/core/public/...` wins over
the shipped file.

## Event Chaining

Events can trigger commands that publish more events:

```
order_created → send_confirmation_email
              → update_inventory → inventory_low → notify_admin
              → update_analytics
```

```liquid
{% comment %} app/lib/events/order_created/update_inventory.liquid {% endcomment %}
{% liquid
  function result = 'commands/inventory/decrement', object: object

  if result.quantity < result.reorder_threshold
    function _ = 'modules/core/commands/events/publish',
      type: 'inventory_low', object: result
  endif

  return result
%}
```

Avoid circular chains — if A triggers B which triggers A, you have an
infinite loop. The platform doesn't break it for you.

## Conditional Validation

```liquid
{% comment %} app/lib/commands/products/create/check.liquid {% endcomment %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'title', object: object
  function c = 'modules/core/lib/validations/included',
    c: c, field_name: 'status', object: object,
    in: ['draft','published','archived']

  if object.status == 'published'
    function c = 'modules/core/lib/validations/presence',
      c: c, field_name: 'description', object: object
    function c = 'modules/core/lib/validations/number',
      c: c, field_name: 'price', object: object, gt: 0
  endif

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

## Multi-Step / Nested Commands

For operations that span tables, run each sub-command in sequence and
short-circuit on the first failure:

```liquid
{% comment %} app/lib/commands/orders/create.liquid {% endcomment %}
{% liquid
  function order = 'commands/orders/create/build', object: order_params
  function order = 'commands/orders/create/check', object: order
  if order.valid == false
    return order
  endif
  function order = 'modules/core/commands/execute',
    mutation_name: 'orders/create',
    selection: 'record_create',
    object: order

  for item in line_items
    assign item['order_id'] = order.id
    function line = 'commands/order_items/create', object: item
    if line.valid == false
      log line.errors, type: 'orders/create line_item failed'
    endif
  endfor

  function _ = 'modules/core/commands/events/publish',
    type: 'order_created', object: order

  return order
%}
```

For multi-step rollback semantics, wrap in `{% transaction %}` (platform
primitive) — outside the scope of `commands/execute`.

## Scoped Uniqueness

`uniqueness` accepts a `scope:` (array of field names) so the unique
constraint applies only WITHIN matching values:

```liquid
{% function c = 'modules/core/lib/validations/uniqueness',
   c: c, field_name: 'slug', object: object,
   table: 'product', scope: ['category_id'] %}
```

This rejects duplicate `slug` only among rows with the same
`category_id`.

## Batch Operations

```liquid
{% liquid
  assign results = '' | split: ''
  assign all_valid = true

  for item in items
    function obj = 'commands/products/create/build', object: item
    function obj = 'commands/products/create/check', object: obj
    if obj.valid == false
      assign all_valid = false
    endif
    assign results = results | add_to_array: obj
  endfor

  if all_valid
    for obj in results
      function obj = 'modules/core/commands/execute',
        mutation_name: 'products/create',
        selection: 'record_create',
        object: obj
    endfor
  endif

  return results
%}
```

## Performance Notes

### Cheap before expensive

Validators may hit the DB (`uniqueness`, `exist_in_db`). Order them
cheapest-first so a missing required field never reaches the slow check:

```liquid
{% function c = 'modules/core/lib/validations/presence',
   c: c, field_name: 'email', object: object %}
{% function c = 'modules/core/lib/validations/email',
   c: c, field_name: 'email', object: object %}
{% function c = 'modules/core/lib/validations/uniqueness',
   c: c, field_name: 'email', object: object, table: 'user_profile' %}
```

### Lean event payloads

Pass only IDs; let consumers fetch what they need:

```liquid
{% assign payload = { id: object.id, type: 'product' } %}
{% function _ = 'modules/core/commands/events/publish',
   type: 'product_created', object: payload %}
```

## See Also

- [Core Overview](README.md)
- [Core API](api.md) — full validator inventory + option names
- [Core Configuration](configuration.md)
- [Core Patterns](patterns.md)
- [Core Gotchas](gotchas.md)
