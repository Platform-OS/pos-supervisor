# Commands -- API Reference

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). The live
> API surface is the source of truth — call
> `module_info(name: 'core', section: 'api')`. This file gives narrative
> notes on the command-runner shape and validator family.

## Module-Level: Only `modules/core/commands/execute`

There is **no** `modules/core/commands/build` and **no**
`modules/core/commands/check`. The build and check phases are
**app-level** files inside your own command directory — see
[configuration.md](configuration.md) and [patterns.md](patterns.md).
Calling `'modules/core/commands/build'` will fail with "partial not
found" — see [gotchas.md](gotchas.md).

### `modules/core/commands/execute`

Runs a GraphQL mutation with the validated object as `args`.

```liquid
{% function object = 'modules/core/commands/execute',
   mutation_name: 'products/create',
   selection: 'record_create',
   object: object %}
```

| Parameter       | Type   | Required | Description                                    |
|-----------------|--------|----------|------------------------------------------------|
| `mutation_name` | String | Yes      | Path to `.graphql` file (relative to `app/graphql/`) |
| `selection`     | String | No       | Top-level field name in the mutation response (default `record`; record CRUD ops use `record_create` / `record_update` / `record_delete`) |
| `object`        | Hash   | Yes      | Validated object passed as `args`              |

**Returns:** the selected record from the mutation result, with
`object.valid = true` set on success.

### `modules/core/commands/events/publish`

Publishes an event after a successful command execution.

```liquid
{% function _ = 'modules/core/commands/events/publish',
   type: 'product_created', object: object %}
```

| Parameter | Type   | Required | Description                                        |
|-----------|--------|----------|----------------------------------------------------|
| `type`    | String | Yes      | Event-type identifier (matches consumer directory) |
| `object`  | Hash   | Yes      | Payload available to consumers as `event.object`   |

**Returns:** ignored — assign to `_`.

### Other module commands

| Command | Description |
|---------|-------------|
| `modules/core/commands/events/broadcast` | Fan-out to multiple type-prefixed consumers |
| `modules/core/commands/session/get` | Read a session value |
| `modules/core/commands/session/set` | Write a session value (with optional `from` for flash auto-clear) |
| `modules/core/commands/session/clear` | Clear a session value |

Use `module_info(name: 'core', section: 'api')` for the full live list.

## App-Level: Build / Check Phases (your code)

The build and check phases live in your own app, conventionally as
sibling files of the orchestrator under
`app/lib/commands/<resource>/<action>/`. They have no signature
prescribed by the module — they're regular Liquid partials with
`{% doc %}` `@param` declarations.

### Build phase signature

```liquid
{% comment %} app/lib/commands/products/create/build.liquid {% endcomment %}
{% doc %}
  @param {object} object - raw input from the orchestrator
  @param {object} existing - optional, used by update commands
{% enddoc %}
{% liquid
  assign object = object | hash_merge: valid: true, errors: empty
  return object
%}
```

The build phase normalizes input, merges defaults, and seeds the
contract `errors` so the check phase can append to it.

### Check phase signature

```liquid
{% comment %} app/lib/commands/products/create/check.liquid {% endcomment %}
{% doc %}
  @param {object} object - object from the build phase
{% enddoc %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'title', object: object
  function c = 'modules/core/lib/validations/number',
    c: c, field_name: 'price', object: object, gt: 0

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

The check phase chains validator calls, threading the contract `c`
through each. At the end it sets `object.errors` and `object.valid`.

## Validator Family

All validators live at `modules/core/lib/validations/<name>` (note the
`lib/` segment — `modules/core/validations/<name>` does not exist).
They take `c` (contract / errors hash), `field_name`, `object`, and
validator-specific options. They APPEND to `c` and RETURN it; chain
them by passing the result back as the next call's `c`.

| Validator                | Options (modern names)                                  | Notes |
|--------------------------|---------------------------------------------------------|-------|
| `presence`               | `allow_blank`, `message`                                | Falsey-blank fails |
| `length`                 | `min`, `max`, `eq`                                      | String length |
| `number`                 | `gt`, `gte`, `lt`, `lte`, `eq`, `ne`                    | Replaces legacy `numericality` (with `greater_than`/`less_than`) |
| `date`                   | `format`, `before`, `after`                             | |
| `email`                  | (none)                                                  | |
| `is_url`                 | (none)                                                  | |
| `matches`                | `regexp`, `allow_blank`                                 | Replaces legacy `format` (with param `pattern`) |
| `equal`                  | `to`                                                    | Replaces legacy `confirmation` — set `to: 'password_confirmation'` for the pwd-match case |
| `included`               | `in`                                                    | Replaces legacy `inclusion.values` |
| `elements_included`      | `in`                                                    | Same as `included` but on array fields |
| `unique_elements`        | (none)                                                  | Array elements must be unique |
| `each_element_length`    | `min`, `max`                                            | |
| `uniqueness`             | `table`, `scope`                                        | DB query — keep last in the chain so cheaper validators short-circuit |
| `password_complexity`    | `min_length`, `require_digit`, `require_special`, ...   | |
| `hcaptcha`               | (none)                                                  | hCaptcha verification |
| `truthy`                 | (none)                                                  | Field must be truthy |
| `not_null`               | (none)                                                  | Field must not be `nil` |
| `exist_in_db`            | `table`, `field`                                        | Foreign-key existence |
| `valid_object`           | `validators`                                            | Recursive sub-object validation |

### Calling pattern (canonical)

```liquid
{% function c = 'modules/core/lib/validations/presence',
   c: object.errors, field_name: 'title', object: object %}

{% function c = 'modules/core/lib/validations/number',
   c: c, field_name: 'price', object: object, gt: 0 %}

{% function c = 'modules/core/lib/validations/matches',
   c: c, field_name: 'sku', object: object,
   regexp: '^[A-Z]{2,4}-[0-9]{4}$', allow_blank: true %}
```

Argument order: `c, field_name, object, [options...]` — matches the
`@param` order in each validator file. See
[modules/core/api.md](../modules/core/api.md) for the full validator
reference and option semantics.

## Legacy Forms — No Longer Supported

The following forms appear in older docs and code; they will fail at
function-resolve time on pos-cli 6.0.7+:

- `'modules/core/commands/build'` — does not exist (the build phase is
  app-level; see above).
- `'modules/core/commands/check'` — does not exist; same reason.
- `'modules/core/validations/<name>'` — wrong path; the validators
  live at `modules/core/lib/validations/<name>`.
- `validators` array passed to a single check helper —
  `validators: [{ name: 'presence', property: 'X' }, ...]` was the
  legacy shape that's no longer supported. Modern code chains
  individual validator calls (see calling pattern above).
- `numericality` validator — replaced by `number`.
- `format` validator — replaced by `matches` (option `pattern` →
  `regexp`).
- `confirmation` validator — replaced by `equal` with explicit `to:`.
- `inclusion` validator — replaced by `included` with `in:`.

## Result Object Structure

After a successful execute:

```json
{
  "title": "Widget",
  "price": 19.99,
  "valid": true,
  "errors": {},
  "id": "12345",
  "created_at": "2025-01-15T10:30:00Z"
}
```

After validation failure:

```json
{
  "title": "",
  "price": null,
  "valid": false,
  "errors": {
    "title": ["modules/core/validation.blank"],
    "price": ["modules/core/validation.blank", "modules/core/validation.number"]
  }
}
```

Error values are translation KEYS — translate at the display layer with
`| t`.

## Calling a Command from a Page

```liquid
{% function result = 'commands/products/create',
   params: context.params.product %}
```

Parameters are passed as named arguments and become local variables
inside the orchestrator file.

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- File layout and naming
- [patterns.md](patterns.md) -- Real-world usage examples
- [gotchas.md](gotchas.md) -- Common API misuse
- [advanced.md](advanced.md) -- Nested commands, transactions, background jobs
- [modules/core/api.md](../modules/core/api.md) -- Authoritative validator
  reference (this file mirrors it for the commands domain).
- [Liquid Tags](../liquid/tags/) -- `function`, `assign`, and other tag references
