# Commands -- Advanced Topics

## Running Commands as Background Jobs

Commands can be executed asynchronously using the `{% background %}` tag. This is useful for operations that do not need to return a result to the user immediately.

```liquid
{% background source_name: 'create_report', priority: 'low', max_attempts: 3 %}
  {% function result = 'lib/commands/reports/create',
    user_id: user_id,
    date_range: date_range
  %}
  {% if result.valid != true %}
    {% log result.errors, type: 'error' %}
  {% endif %}
{% endbackground %}
```

When running commands in the background, you cannot return the result to the caller. Use events or polling to communicate outcomes.

## Multi-Step Commands with Transactions

For operations that must succeed or fail atomically, wrap multiple mutations in a `{% transaction %}` block inside the execute stage.

```liquid
{% if object.valid %}
  {% transaction %}
    {% function object = 'modules/core/commands/execute',
      mutation_name: 'orders/create',
      selection: 'record_create',
      object: object
    %}

    {% for item in items %}
      {% assign line_item = { "order_id": object.id, "product_id": item.product_id, "quantity": item.quantity } %}
      {% function line_item = 'modules/core/commands/build', object: line_item %}
      {% function line_item = 'modules/core/commands/execute',
        mutation_name: 'order_items/create',
        selection: 'record_create',
        object: line_item
      %}
    {% endfor %}
  {% endtransaction %}
{% endif %}
```

If any mutation inside the transaction fails, all changes are rolled back.

## Custom Validation Logic

When built-in validators are not sufficient, add custom checks after the standard check stage.

```liquid
{% function object = 'modules/core/commands/check', object: object, validators: validators %}

{% comment %} Custom: ensure end_date is after start_date {% endcomment %}
{% if object.valid %}
  {% assign start = object.start_date | to_time %}
  {% assign end = object.end_date | to_time %}
  {% if end <= start %}
    {% assign object = object | hash_merge: valid: false %}
    {% assign date_error = ["must be after start date"] %}
    {% assign errors = object.errors | hash_merge: end_date: date_error %}
    {% assign object = object | hash_merge: errors: errors %}
  {% endif %}
{% endif %}
```

This preserves the standard error structure so callers can handle custom errors identically to built-in ones.

## Composing Commands

Complex workflows can be built by calling commands from within commands. Keep each command focused on a single resource.

```liquid
{% comment %} app/lib/commands/checkout/process.liquid {% endcomment %}

{% function order = 'lib/commands/orders/create',
  user_id: user_id,
  total: cart_total
%}

{% if order.valid %}
  {% function payment = 'lib/commands/payments/charge',
    order_id: order.id,
    amount: cart_total,
    token: payment_token
  %}

  {% if payment.valid %}
    {% function _ = 'modules/core/commands/events/publish',
      type: 'order_created',
      object: order
    %}
  {% else %}
    {% comment %} Roll back the order if payment fails {% endcomment %}
    {% function _ = 'lib/commands/orders/cancel', id: order.id %}
  {% endif %}

  {% assign result = payment %}
{% else %}
  {% assign result = order %}
{% endif %}

{% return result %}
```

## Optimizing Validator Performance

The `uniqueness` validator issues a database query for each field it checks. Minimize its use and place it last in the validators array so cheaper validators (presence, numericality) fail first.

```liquid
{% assign validators = [
  { "name": "presence", "property": "email" },
  { "name": "format", "property": "email", "options": { "pattern": "^[^@]+@[^@]+\\.[^@]+$" } },
  { "name": "uniqueness", "property": "email", "options": { "table": "user_profile" } }
] %}
```

## Handling File Uploads in Commands

For commands that process file uploads, the file data comes through `context.params` as an upload object. Pass the relevant properties to your command.

```liquid
{% function result = 'lib/commands/documents/create',
  title: context.params.document.title,
  file: context.params.document.file
%}
```

In the command, include the file property in the object and ensure the schema defines the field with type `upload`:

```yaml
# app/schema/document.yml
name: document
properties:
  - name: title
    type: string
  - name: file
    type: upload
```

## Idempotent Commands

For operations that might be retried (e.g., background jobs with `max_attempts > 1`), design commands to be idempotent.

```liquid
{% comment %} Check if the record already exists before creating {% endcomment %}
{% graphql existing = 'products/find_by_external_id', external_id: external_id %}

{% if existing.records.results.size > 0 %}
  {% assign object = existing.records.results.first %}
  {% assign object = object | hash_merge: valid: true, errors: {} %}
{% else %}
  {% comment %} Standard build/check/execute {% endcomment %}
  {% function object = 'modules/core/commands/build', object: object %}
  {% function object = 'modules/core/commands/check', object: object, validators: validators %}
  {% if object.valid %}
    {% function object = 'modules/core/commands/execute',
      mutation_name: 'products/create',
      selection: 'record_create',
      object: object
    %}
  {% endif %}
{% endif %}
{% return object %}
```

## Debugging Commands

Use the `{% log %}` tag to inspect command state at each stage:

```liquid
{% function object = 'modules/core/commands/build', object: object %}
{% log object, type: 'debug' %}

{% function object = 'modules/core/commands/check', object: object, validators: validators %}
{% log object, type: 'debug' %}
```

Monitor output with `pos-cli logs` to see the object state at each step.

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- File layout and setup
- [api.md](api.md) -- Core helper signatures
- [patterns.md](patterns.md) -- Standard patterns to build on
- [gotchas.md](gotchas.md) -- Common errors and limits
- [Background Jobs](../background-jobs/) -- Async execution details
- [Events & Consumers](../events-consumers/) -- Event publishing from commands
- [Caching](../caching/) -- Caching strategies around commands
