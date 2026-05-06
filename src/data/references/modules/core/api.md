# pos-module-core — API Reference

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). The live
> API surface is the source of truth — call
> `module_info(name: 'core', section: 'api')`. This file gives narrative
> notes on the validator family + the canonical command-runner shape.

## Command Runner: `modules/core/commands/execute`

`execute` is the only top-level command-runner the module ships. There is
NO `modules/core/commands/build` or `modules/core/commands/check` — those
phases live INSIDE your app commands (or domain-specific module commands
like `commands/email/send/build`). Calling
`'modules/core/commands/build'` will fail with "partial not found" — see
gotchas.md.

```liquid
{% function object = 'modules/core/commands/execute',
   mutation_name: 'products/create',
   selection: 'record_create',
   object: object %}
```

| Parameter       | Type   | Required | Description                                    |
|-----------------|--------|----------|------------------------------------------------|
| `mutation_name` | String | Yes      | GraphQL mutation path                          |
| `selection`     | String | No       | GraphQL result selection key (default `record`) |
| `object`        | Hash   | Yes      | Validated object passed as `args`              |

**Returns:** the selected record from the mutation result, with
`object.valid = true` set on success.

## Domain Commands

The core module ships several domain-specific commands that themselves use
the build/check pattern internally:

- `commands/email/send` — calls `email/send/build`, `email/send/check`,
  then `graphql modules/core/email/send`.
- `commands/events/create` — calls `events/create/build`,
  `events/create/check`, then `events/create/execute`.
- `commands/statuses/create` and `commands/statuses/delete` — same shape.

Use `module_info(name: 'core', section: 'api')` for the live param lists.

## Event Commands

```liquid
{% function _ = 'modules/core/commands/events/publish',
   type: 'product_created',
   object: object %}

{% function _ = 'modules/core/commands/events/broadcast',
   type: 'inventory.changed',
   object: object %}
```

| Param   | Type   | Description                              |
|---------|--------|------------------------------------------|
| `type`  | String | Event-type identifier                    |
| `object`| Hash   | Payload passed to subscribers            |

## Session Commands

```liquid
{% function value = 'modules/core/commands/session/get', key: 'sflash' %}

{% function _ = 'modules/core/commands/session/set',
   key: 'sflash', value: 'Saved.',
   from: context.location.pathname %}

{% function _ = 'modules/core/commands/session/clear', key: 'sflash' %}
```

`from` is used by the flash auto-clear pattern: a flash set with `from`
is cleared on the next request that did NOT come from that origin path.

## Helpers

### `modules/core/helpers/redirect_to`

```liquid
{% function _ = 'modules/core/helpers/redirect_to',
   url: '/products', notice: 'app.product_created' %}
```

| Param    | Type   | Description                              |
|----------|--------|------------------------------------------|
| `url`    | String | Redirect target                          |
| `notice` | String | Translation key for the flash notice     |
| `error`  | String | Translation key for an error flash       |
| `info`   | String | Translation key for an info flash        |
| `default`| String | Translation key for a default flash      |
| `format` | String | Optional format for the flash payload    |

### `modules/core/helpers/flash`

Reads or composes flash messages. Used internally by `redirect_to` and by
your layout when rendering a flash banner.

## Validators (canonical name + option shapes)

All validators take `c` (contract / errors hash), `field_name`, `object`,
optional `message`, and validator-specific options. They APPEND to the
contract and RETURN it; chain them in your `check` partial.

| Validator                | Options (modern names)                                  | Notes |
|--------------------------|---------------------------------------------------------|-------|
| `presence`               | `allow_blank`, `message`                                 | Falsey-blank fails |
| `length`                 | `min`, `max`, `eq`                                      | String length |
| `number`                 | `gt`, `gte`, `lt`, `lte`, `eq`, `ne`                    | Replaces legacy `numericality` with `greater_than`/`less_than` |
| `date`                   | `format`, `before`, `after`                             | |
| `email`                  | (none)                                                  | |
| `is_url`                 | (none)                                                  | |
| `matches`                | `regexp`, `allow_blank`                                 | Replaces legacy `format` (with param `pattern`) |
| `equal`                  | `to`                                                    | Replaces legacy `confirmation` — set `to: 'password_confirmation'` for the pwd-match case |
| `included`               | `in`                                                    | Replaces legacy `inclusion.values` |
| `elements_included`      | `in`                                                    | Same as `included` but on array fields |
| `unique_elements`        | (none)                                                  | Array elements must be unique |
| `each_element_length`    | `min`, `max`                                            | |
| `uniqueness`             | `table`, `scope`                                        | |
| `password_complexity`    | `min_length`, `require_digit`, `require_special`, ...   | |
| `hcaptcha`               | (none)                                                  | hCaptcha verification |
| `truthy`                 | (none)                                                  | Field must be truthy |
| `not_null`               | (none)                                                  | Field must not be `nil` |
| `exist_in_db`            | `table`, `field`                                        | Foreign-key existence |
| `valid_object`           | `validators`                                            | Recursive sub-object validation |

### Calling pattern

```liquid
{% comment %} app/lib/commands/products/create/check.liquid {% endcomment %}
{% function c = 'modules/core/lib/validations/presence',
   c: object.errors, field_name: 'title', object: object %}

{% function c = 'modules/core/lib/validations/number',
   c: c, field_name: 'price', object: object, gt: 0 %}

{% function c = 'modules/core/lib/validations/matches',
   c: c, field_name: 'sku', object: object,
   regexp: '^[A-Z]{2,4}-[0-9]{4}$', allow_blank: true %}

{% assign object.errors = c %}
{% assign object.valid  = c == empty %}
{% return object %}
```

Legacy validator names that NO LONGER EXIST: `numericality` (use `number`),
`format` (use `matches`), `confirmation` (use `equal`), `inclusion` (use
`included`). Code that still references those will fail at function-resolve
time.

## See Also

- [Core Overview](README.md) — introduction
- [Core Configuration](configuration.md) — installation + module layout
- [Core Patterns](patterns.md) — build/check/execute workflows
- [Core Gotchas](gotchas.md) — common errors (esp. phantom build/check)
- [Core Advanced](advanced.md) — custom validators, event chaining
- Live API: `module_info(name: 'core', section: 'api')`
