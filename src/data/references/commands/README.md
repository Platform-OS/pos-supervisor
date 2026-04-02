# Commands (Business Logic)

Commands encapsulate business rules in platformOS following the **build, check, execute** pattern. They provide a structured, testable approach to all create, update, and delete operations using pos-module-core helpers.

## Key Purpose

Commands are the single place for business logic in a platformOS application. They enforce a strict three-stage pipeline that separates data construction, validation, and persistence. This keeps pages thin (controller-only) and partials focused on presentation.

## When to Use

- Creating, updating, or deleting any record in the database
- Validating user input before persistence
- Encapsulating business rules that must be enforced consistently
- Operations that should optionally trigger side effects (events)
- Any data mutation that needs to be callable from pages, background jobs, or other commands

Do NOT use commands for:
- Read-only queries (use `app/lib/queries/` instead)
- Pure presentation logic (use partials)
- One-off data transformations with no persistence

## How It Works

```
User Request
    |
    v
Page (Controller) --- calls ---> Command partial
                                     |
                           +---------+---------+
                           |         |         |
                         Build     Check    Execute
                           |         |         |
                       Construct  Validate  Persist
                        object    fields    via GraphQL
                           |         |         |
                           +----+----+----+----+
                                |         |
                            Return     Publish
                            result     event (optional)
```

1. **Build** -- Assemble a data object from input parameters using `assign` with hash literals and `modules/core/commands/build`.
2. **Check** -- Validate the object against a JSON array of validators using `modules/core/commands/check`.
3. **Execute** -- If `object.valid` is true, persist via `modules/core/commands/execute` with a GraphQL mutation.

The result object always contains `valid` (boolean), `errors` (hash), and the original data fields.

## Getting Started

1. Create a command file at `app/lib/commands/<resource>/<action>.liquid` (e.g., `app/lib/commands/products/create.liquid`).
2. Implement the three stages: build, check, execute.
3. Call from a page via `{% function result = 'lib/commands/products/create', title: title, price: price %}`.
4. Check `result.valid` to determine success or failure.
5. On failure, re-render the form with `result.errors` for display.

Minimal command:

```liquid
{% assign object = { "title": title } %}
{% function object = 'modules/core/commands/build', object: object %}

{% assign validators = [{ "name": "presence", "property": "title" }] %}
{% function object = 'modules/core/commands/check', object: object, validators: validators %}

{% if object.valid %}
  {% function object = 'modules/core/commands/execute', mutation_name: 'products/create', selection: 'record_create', object: object %}
{% endif %}
{% return object %}
```

## See Also

- [configuration.md](configuration.md) -- File naming, directory layout, and setup conventions
- [api.md](api.md) -- Core module helpers, validator signatures, and return types
- [patterns.md](patterns.md) -- Common command workflows and real-world examples
- [gotchas.md](gotchas.md) -- Common errors, limits, and troubleshooting
- [advanced.md](advanced.md) -- Nested commands, background execution, and optimization
- [Events & Consumers](../events-consumers/) -- Publishing events from commands
- [Background Jobs](../background-jobs/) -- Running commands asynchronously
- [GraphQL](../graphql/) -- Mutation files used by commands
- [Schema](../schema/) -- Table definitions that commands operate on
