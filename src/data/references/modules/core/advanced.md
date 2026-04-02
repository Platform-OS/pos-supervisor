# pos-module-core -- Advanced Topics

Advanced customization, edge cases, and optimization techniques for the core module.

## Custom Validators

You can create custom validators by adding files to your app that follow the core validator interface.

### Creating a custom validator

1. Create the validator file:

```liquid
{% comment %} app/lib/validators/phone_number.liquid {% endcomment %}
{% liquid
  assign value = object[property]
  assign phone_regex = '^\+?[0-9]{10,15}$'
  assign is_valid = value | matches: phone_regex

  if is_valid != true
    assign errors[property] = 'is not a valid phone number'
  endif

  return errors
%}
```

2. Reference it in your validators array with a custom path:

```liquid
{% assign validators = [{ "name": "presence", "property": "phone" }, { "name": "phone_number", "property": "phone" }] %}
```

**Note:** Custom validators must follow the same interface: accept `object` and `property`, return an `errors` hash.

## Overriding Built-in Validators

To change how a built-in validator works (e.g., custom error messages):

```bash
mkdir -p app/modules/core/public/lib/validators
cp modules/core/public/lib/validators/presence.liquid \
   app/modules/core/public/lib/validators/presence.liquid
```

Edit the copy in `app/modules/core/` to customize behavior. The app-level file takes precedence.

## Event Chaining

Events can trigger commands that publish more events, creating a chain:

```
order_created -> send_confirmation_email
              -> update_inventory -> inventory_low -> notify_admin
              -> update_analytics
```

### Implementing event chains

```liquid
{% comment %} app/lib/consumers/order_created/update_inventory.liquid {% endcomment %}
{% liquid
  function result = 'lib/commands/inventory/decrement', order: object

  if result.quantity < result.reorder_threshold
    function _ = 'modules/core/commands/events/publish',
      type: 'inventory_low',
      object: result
  endif

  return result
%}
```

**Warning:** Avoid circular event chains. If event A triggers event B which triggers event A, you create an infinite loop.

## Conditional Validation

Apply validators only when certain conditions are met:

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% liquid
  function object = 'modules/core/commands/build', object: params

  assign validators = [{ "name": "presence", "property": "title" }, { "name": "presence", "property": "status" }]

  if object.status == 'published'
    assign publish_validators = [{ "name": "presence", "property": "description" }, { "name": "presence", "property": "price" }, { "name": "numericality", "property": "price", "options": { "greater_than": 0 } }]
    assign validators = validators | concat: publish_validators
  endif

  function object = 'modules/core/commands/check', object: object, validators: validators

  if object.errors != blank
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/create', selection: 'record_create', object: object
  return object
%}
```

## Multi-Step Commands

For complex operations that span multiple tables:

```liquid
{% comment %} app/lib/commands/orders/create.liquid {% endcomment %}
{% liquid
  comment Create the order record first
  endcomment
  function order = 'modules/core/commands/build', object: order_params
  function order = 'modules/core/commands/check', object: order, validators: order_validators
  if order.errors != blank
    return order
  endif
  function order = 'modules/core/commands/execute',
    mutation_name: 'orders/create', selection: 'record_create', object: order

  comment Then create each line item
  endcomment
  for item in line_items
    assign item['order_id'] = order.id
    function line = 'modules/core/commands/build', object: item
    function line = 'modules/core/commands/execute',
      mutation_name: 'order_items/create', selection: 'record_create', object: line
  endfor

  function _ = 'modules/core/commands/events/publish', type: 'order_created', object: order
  return order
%}
```

## Scoped Uniqueness Validation

Validate uniqueness within a scope (e.g., slug unique per category):

```json
{
  "name": "uniqueness",
  "property": "slug",
  "options": {
    "table": "product",
    "scope": ["category_id"]
  }
}
```

This checks that `slug` is unique only among records with the same `category_id`.

## Batch Operations

For bulk creates or updates, loop through items and collect results:

```liquid
{% liquid
  assign results = '' | split: ''
  assign all_valid = true

  for item in items
    function object = 'modules/core/commands/build', object: item
    function object = 'modules/core/commands/check', object: object, validators: validators
    if object.errors != blank
      assign all_valid = false
    endif
    assign results = results | add_to_array: object
  endfor

  if all_valid
    for object in results
      function object = 'modules/core/commands/execute',
        mutation_name: 'products/create', selection: 'record_create', object: object
    endfor
  endif

  return results
%}
```

## Performance Optimization

### Minimize validator calls

Each validator may run a database query (especially `uniqueness`). Group validators thoughtfully:

```liquid
{% comment %} Run cheap validators first, expensive ones last {% endcomment %}
{% assign validators = [
  { "name": "presence", "property": "title" },
  { "name": "presence", "property": "email" },
  { "name": "format", "property": "email", "options": { "pattern": "^[^@]+@[^@]+$" } },
  { "name": "uniqueness", "property": "email", "options": { "table": "user_profile" } }
] %}
```

### Lean event payloads

Pass only IDs in event payloads; let consumers fetch what they need:

```liquid
{% assign payload = { "id": object.id, "type": "product" } %}
{% function _ = 'modules/core/commands/events/publish', type: 'product_created', object: payload %}
```

## See Also

- [Core Overview](README.md) -- introduction and key concepts
- [Core API](api.md) -- all available functions
- [Core Configuration](configuration.md) -- installation and validator options
- [Core Patterns](patterns.md) -- standard workflows
- [Core Gotchas](gotchas.md) -- common errors and limits
- [Events & Consumers](../../events-consumers/README.md) -- event consumer registration
