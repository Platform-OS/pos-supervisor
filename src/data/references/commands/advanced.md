# Commands -- Advanced Topics

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). Build/check
> phases live in YOUR app commands, not in `modules/core/commands/`.

## Running Commands as Background Jobs

Commands can be executed asynchronously using the `{% background %}`
tag. Useful for operations that don't need to return a result to the
user immediately.

```liquid
{% background source_name: 'create_report', priority: 'low', max_attempts: 3 %}
  {% function result = 'commands/reports/create',
    params: { user_id: user_id, date_range: date_range }
  %}
  {% if result.valid != true %}
    {% log result.errors, type: 'error' %}
  {% endif %}
{% endbackground %}
```

When running commands in the background, you cannot return the result
to the caller. Use events or polling to communicate outcomes.

## Multi-Step Commands with Transactions

For operations that must succeed or fail atomically, wrap multiple
mutations in a `{% transaction %}` block inside the orchestrator.

```liquid
{% comment %} app/lib/commands/orders/create_with_items.liquid {% endcomment %}
{% liquid
  function object = 'commands/orders/create/build', object: params
  function object = 'commands/orders/create/check', object: object
  if object.valid == false
    return object
  endif
%}

{% transaction %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'orders/create',
    selection: 'record_create',
    object: object
  %}

  {% for item in items %}
    {% assign line_item = { order_id: object.id, product_id: item.product_id, quantity: item.quantity } %}
    {% function line_item = 'modules/core/commands/execute',
      mutation_name: 'order_items/create',
      selection: 'record_create',
      object: line_item
    %}
  {% endfor %}
{% endtransaction %}

{% return object %}
```

If any mutation inside the transaction fails, all changes are rolled
back. Note: there's no `modules/core/commands/build` — line items
either come pre-built from `params`, or you call your own
`commands/order_items/create/build` partial.

## Custom Validation Logic

When the built-in validators aren't sufficient, add custom checks at
the end of your check phase, after the standard validator chain.

```liquid
{% comment %} app/lib/commands/events/create/check.liquid {% endcomment %}
{% doc %}
  @param {object} object - object from the build phase
{% enddoc %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'start_date', object: object
  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'end_date', object: object

  comment
    Custom: ensure end_date is after start_date.
    Append to the contract using the same shape validators emit:
    { field_name: ['translation.key'] }.
  endcomment
  if object.start_date != blank and object.end_date != blank
    assign start = object.start_date | to_time
    assign finish = object.end_date | to_time
    if finish <= start
      assign existing = c.end_date | default: empty
      assign c['end_date'] = existing | array_add: 'app.events.end_after_start'
    endif
  endif

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

This preserves the standard error structure so callers handle custom
errors identically to built-in ones.

## Composing Commands

Complex workflows compose by calling other orchestrators directly with
`{% function %}`. Each composed command is a self-contained
build → check → execute sequence.

```liquid
{% comment %} app/lib/commands/checkout/process.liquid {% endcomment %}
{% doc %}
  @param {string} user_id
  @param {number} cart_total
  @param {string} payment_token
{% enddoc %}
{% liquid
  function order = 'commands/orders/create',
    params: { user_id: user_id, total: cart_total }

  if order.valid
    function payment = 'commands/payments/charge',
      params: { order_id: order.id, amount: cart_total, token: payment_token }

    if payment.valid
      function _ = 'modules/core/commands/events/publish',
        type: 'order_created', object: order
      assign result = payment
    else
      comment Roll back the order if payment fails. endcomment
      function _ = 'commands/orders/cancel', params: { id: order.id }
      assign result = payment
    endif
  else
    assign result = order
  endif

  return result
%}
```

## Optimizing Validator Performance

The `uniqueness` validator issues a database query for each field it
checks. Minimize its use and place it last in the validator chain so
cheaper validators (presence, length, number) fail first and short-
circuit the contract.

```liquid
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'email', object: object

  function c = 'modules/core/lib/validations/matches',
    c: c, field_name: 'email', object: object,
    regexp: '^[^@]+@[^@]+\.[^@]+$', allow_blank: true

  comment uniqueness LAST — DB query is the expensive one. endcomment
  function c = 'modules/core/lib/validations/uniqueness',
    c: c, field_name: 'email', object: object, table: 'user_profile'

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

## Handling File Uploads in Commands

For commands that process file uploads, the file data comes through
`context.params` as an upload object. Pass the relevant properties via
`params`.

```liquid
{% function result = 'commands/documents/create',
  params: { title: context.params.document.title, file: context.params.document.file }
%}
```

In the build phase, normalize the file property; in the check phase,
validate it like any other field. Schema must declare the field as
type `upload`:

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

For operations that might be retried (e.g. background jobs with
`max_attempts > 1`), make commands idempotent by checking for existing
records before creating.

```liquid
{% comment %} app/lib/commands/products/import.liquid {% endcomment %}
{% liquid
  graphql existing = 'products/find_by_external_id', external_id: external_id

  if existing.records.results.size > 0
    assign object = existing.records.results | first
    assign object = object | hash_merge: valid: true, errors: empty
    return object
  endif

  function object = 'commands/products/create/build',
    object: { external_id: external_id, title: title }
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

## Debugging Commands

Use `{% log %}` to inspect command state at each phase boundary.

```liquid
{% liquid
  function object = 'commands/products/create/build', object: params
  log object, type: 'debug'

  function object = 'commands/products/create/check', object: object
  log object, type: 'debug'
%}
```

Monitor output with `pos-cli logs` to see the object state at each
step.

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- File layout and setup
- [api.md](api.md) -- Module-level command runner + validator family
- [patterns.md](patterns.md) -- Standard patterns to build on
- [gotchas.md](gotchas.md) -- Common errors and limits
- [modules/core/advanced.md](../modules/core/advanced.md) -- Custom validators
- [Background Jobs](../background-jobs/) -- Async execution details
- [Events & Consumers](../events-consumers/) -- Event publishing from commands
