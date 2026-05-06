# pos-module-core

The core module provides the canonical **build → check → execute** command
pattern, the **event system**, a comprehensive **validator** family, **session
helpers**, **flash messages**, and **redirect utilities** for every
platformOS application.

**Required module** — every other module depends on it.
Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Key Purpose

pos-module-core ships the foundational primitives a platformOS app composes:

1. **Command pattern** — `build → check → execute` is APP-LEVEL: each app
   command defines its own `build` and `check` partials and finishes by
   calling the shared `modules/core/commands/execute` to run the
   underlying GraphQL mutation. The core module does NOT ship top-level
   `commands/build` or `commands/check` files.
2. **Event system** — publish/subscribe via
   `modules/core/commands/events/...` for decoupled side effects.
3. **Validators** — 19 validators under `modules/core/lib/validations/`:
   presence, length, number, date, email, is_url, matches, equal,
   uniqueness, included, elements_included, unique_elements,
   each_element_length, password_complexity, hcaptcha, truthy, not_null,
   exist_in_db, valid_object.
4. **Helpers** — `helpers/redirect_to`, `helpers/flash`, timezone utilities.
5. **Generators** — `pos-cli generators run command|crud` produces
   build/check/execute scaffolds (templates ship under
   `modules/core/generators/`).

## When to Use

- **Creating / updating records** — write your build + check partials, then
  call `modules/core/commands/execute` for the mutation.
- **Validating user input** — call core validators from `check`, attaching
  errors to a contract object via `modules/core/helpers/register_error`.
- **Publishing events** — `modules/core/commands/events/publish` fires
  side-effect chains.
- **Flash messages** — `modules/core/helpers/flash` stashes one-shot
  messages; `helpers/redirect_to` combines redirect + flash.

You DO NOT call `commands/build` or `commands/check` from a page. Build/check
live INSIDE your own app commands; pages call your app command via
`{% function %}`.

## How It Works

```
Page → app/lib/commands/products/create
        → app/lib/commands/products/create/build       (your build)
        → app/lib/commands/products/create/check       (your check w/ validators)
        → modules/core/commands/execute                (mutation runner)
        → modules/core/commands/events/publish         (optional)
```

1. The page collects `context.params` and calls your app command via
   `{% function %}`.
2. Your app command's `build` partial assembles the object hash.
3. Your app command's `check` partial runs validators against the contract,
   returning `object.valid` + `object.errors`.
4. If valid, your app command calls `modules/core/commands/execute` to run
   the GraphQL mutation.
5. Optionally publish an event afterwards.

### Minimal app command (canonical)

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% function object = 'commands/products/create/build', object: params %}
{% function object = 'commands/products/create/check', object: object %}
{% if object.valid == false %}
  {% return object %}
{% endif %}
{% function object = 'modules/core/commands/execute',
   mutation_name: 'products/create',
   selection: 'record_create',
   object: object %}
{% return object %}
```

```liquid
{% comment %} app/lib/commands/products/create/check.liquid {% endcomment %}
{% function c = 'modules/core/lib/validations/presence',
   c: object.errors, field_name: 'title', object: object %}
{% function c = 'modules/core/lib/validations/number',
   c: c, field_name: 'price', object: object, gt: 0 %}
{% assign object.errors = c %}
{% assign object.valid = c == empty %}
{% return object %}
```

## Getting Started

1. Install: `pos-cli modules install core`
2. Generate scaffolds:
   `pos-cli generators run crud --resource products`
3. Customize the generated `build` / `check` partials.
4. Call the command from your page:
   `{% function result = 'commands/products/create', object: context.params %}`
5. Handle `result.errors` in the page.

## See Also

- [Core Configuration](configuration.md) — installation and module layout
- [Core API](api.md) — validator family, helpers, command runner shape
- [Core Patterns](patterns.md) — real-world build/check/execute workflows
- [Core Gotchas](gotchas.md) — common errors (esp. "core/commands/build doesn't exist")
- [Core Advanced](advanced.md) — custom validators, event chaining
- Live API surface: `module_info(name: 'core', section: 'api')`
- Upstream: https://github.com/Platform-OS/pos-module-core
