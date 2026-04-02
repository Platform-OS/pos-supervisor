# Commands -- Common Patterns

## Pattern: Basic CRUD Command

The most common pattern is a create command called from a POST page.

### Command file

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}

{% assign object = { "title": title, "price": price, "description": description, "user_id": user_id } %}
{% function object = 'modules/core/commands/build', object: object %}

{% assign validators = [
  { "name": "presence", "property": "title" },
  { "name": "presence", "property": "price" },
  { "name": "numericality", "property": "price" },
  { "name": "length", "property": "title", "options": { "minimum": 3, "maximum": 255 } }
] %}
{% function object = 'modules/core/commands/check', object: object, validators: validators %}

{% if object.valid %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'products/create',
    selection: 'record_create',
    object: object
  %}
{% endif %}
{% return object %}
```

### Page calling the command

```liquid
{% comment %} app/views/pages/products/create.liquid {% endcomment %}
---
slug: products
method: post
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.create'

  function result = 'lib/commands/products/create',
    title: context.params.product.title,
    price: context.params.product.price,
    description: context.params.product.description,
    user_id: profile.id

  if result.valid
    include 'modules/core/helpers/redirect_to', url: '/products', notice: 'app.products.created'
  else
    render 'products/form', product: result
  endif
%}
```

## Pattern: Update Command

Update commands fetch the existing record, merge changes, and persist.

```liquid
{% comment %} app/lib/commands/products/update.liquid {% endcomment %}

{% assign object = { "id": id, "title": title, "price": price } %}
{% function object = 'modules/core/commands/build', object: object %}

{% assign validators = [
  { "name": "presence", "property": "id" },
  { "name": "presence", "property": "title" }
] %}
{% function object = 'modules/core/commands/check', object: object, validators: validators %}

{% if object.valid %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'products/update',
    selection: 'record_update',
    object: object
  %}
{% endif %}
{% return object %}
```

## Pattern: Delete Command

Delete commands typically only need an ID and authorization.

```liquid
{% comment %} app/lib/commands/products/delete.liquid {% endcomment %}

{% assign object = { "id": id } %}
{% function object = 'modules/core/commands/build', object: object %}

{% assign validators = [{ "name": "presence", "property": "id" }] %}
{% function object = 'modules/core/commands/check', object: object, validators: validators %}

{% if object.valid %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'products/delete',
    selection: 'record_delete',
    object: object
  %}
{% endif %}
{% return object %}
```

## Pattern: Command with Event Publishing

Publish an event after successful execution to trigger side effects.

```liquid
{% if object.valid %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'orders/create',
    selection: 'record_create',
    object: object
  %}

  {% function _ = 'modules/core/commands/events/publish',
    type: 'order_created',
    object: object
  %}
{% endif %}
{% return object %}
```

## Pattern: Command with Conditional Validation

Add validators conditionally based on the data.

```liquid
{% assign validators = [
  { "name": "presence", "property": "email" },
  { "name": "format", "property": "email", "options": { "pattern": "^[^@]+@[^@]+$" } }
] %}

{% if object.role == 'admin' %}
  {% assign admin_validators = [{ "name": "presence", "property": "admin_code" }] %}
  {% assign validators = validators | array_add: admin_validators %}
{% endif %}

{% function object = 'modules/core/commands/check', object: object, validators: validators %}
```

## Pattern: Displaying Validation Errors

Render errors in a form partial:

```liquid
{% comment %} app/views/partials/products/form.liquid {% endcomment %}

{% if product.errors.size > 0 %}
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

Commands can compose by calling other commands internally.

```liquid
{% comment %} app/lib/commands/orders/create_with_items.liquid {% endcomment %}

{% function order = 'lib/commands/orders/create', user_id: user_id, total: total %}

{% if order.valid %}
  {% for item in items %}
    {% function line = 'lib/commands/order_items/create',
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity
    %}
  {% endfor %}
{% endif %}

{% return order %}
```

## Best Practices

1. **One responsibility per command** -- a command should do one thing (create a product, update an order).
2. **Always return the object** -- callers rely on `result.valid` and `result.errors`.
3. **Use hash literals with `assign`** -- build data objects using `{% assign object = { "key": variable } %}` rather than the deprecated `parse_json` tag.
4. **Keep pages thin** -- pages call commands and handle routing; no business logic in pages.
5. **Validate everything** -- never trust user input; always include a check stage.

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- File layout and setup
- [api.md](api.md) -- Helper signatures and validator reference
- [gotchas.md](gotchas.md) -- Common mistakes and troubleshooting
- [advanced.md](advanced.md) -- Advanced patterns and optimization
- [Events & Consumers](../events-consumers/) -- Handling events published by commands
- [Forms Reference](../forms/) -- Building forms that submit to commands
