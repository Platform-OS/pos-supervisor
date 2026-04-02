# pos-module-core

The core module provides the **command pattern** infrastructure, **event system**, **validators**, **session helpers**, **flash messages**, and **redirect utilities** for every platformOS application.

**Required module** -- must be installed in every project. All other modules depend on it.

## Key Purpose

pos-module-core establishes the foundational architecture patterns for platformOS apps:

1. **Command pattern** -- a three-step workflow (`build` -> `check` -> `execute`) for all data mutations
2. **Event system** -- publish/subscribe mechanism for decoupled side effects
3. **Validation** -- seven built-in validators (presence, numericality, uniqueness, length, format, inclusion, confirmation)
4. **Session management** -- get and clear session data for flash messages and temporary state
5. **Redirect helpers** -- redirect with flash messages in a single call

Every create, update, and delete operation in a platformOS app should flow through the core command pattern.

## When to Use

- **Creating or updating records** -- use `build`, `check`, `execute` commands in your command partials
- **Validating user input** -- attach validators to fields before persisting
- **Publishing events** -- trigger side effects (emails, notifications, logging) after mutations
- **Flash messages** -- set a message in session before redirect, display on next page load
- **Redirecting with notice** -- use `redirect_to` helper to combine redirect and flash in one call

You do NOT call core commands directly from pages. Instead, your `lib/commands/` partials call them internally.

## How It Works

```
Page -> lib/commands/products/create -> core/commands/build
                                     -> core/commands/check (with validators)
                                     -> core/commands/execute (runs mutation)
                                     -> core/commands/events/publish (optional)
```

1. A page collects `context.params` and calls a command partial via `{% function %}`
2. The command partial calls `build` to construct the object hash
3. The command partial calls `check` with a validators array to validate
4. If valid, the command partial calls `execute` to run the GraphQL mutation
5. Optionally, an event is published for side effects

### Minimal command example

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% function object = 'modules/core/commands/build', object: params %}
{% assign validators = [{ "name": "presence", "property": "title" }] %}
{% function object = 'modules/core/commands/check', object: object, validators: validators %}
{% if object.errors != blank %}
  {% return object %}
{% endif %}
{% function object = 'modules/core/commands/execute',
  mutation_name: 'products/create', selection: 'record_create', object: object
%}
{% return object %}
```

## Getting Started

1. Install the module:
   ```bash
   pos-cli modules install core
   ```
2. Create a command partial in `app/lib/commands/<resource>/create.liquid`
3. Use `build`, `check`, `execute` inside the command
4. Call the command from your page via `{% function result = 'lib/commands/products/create', params: context.params %}`
5. Handle `result.errors` in the page if validation fails

## See Also

- [Core Configuration](configuration.md) -- installation and setup details
- [Core API](api.md) -- all commands, events, session, and validator functions
- [Core Patterns](patterns.md) -- real-world command and event workflows
- [Core Gotchas](gotchas.md) -- common errors and limits
- [Core Advanced](advanced.md) -- custom validators, event chaining, overrides
- [User Module](../user/README.md) -- authentication and RBAC (depends on core)
- [Commands Reference](../../commands/README.md) -- the command pattern in detail
- GitHub: https://github.com/Platform-OS/pos-module-core
