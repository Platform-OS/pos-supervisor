# Commands (Business Logic)

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

Commands encapsulate business rules in platformOS following the
**build → check → execute** pattern. They provide a structured,
testable approach to all create / update / delete operations using the
`pos-module-core` execute helper.

## Key Purpose

Commands are the single place for business logic in a platformOS
application. They enforce a strict three-phase pipeline that
separates data construction, validation, and persistence. This keeps
pages thin (controller-only) and partials focused on presentation.

## When to Use

- Creating, updating, or deleting any record in the database
- Validating user input before persistence
- Encapsulating business rules that must be enforced consistently
- Operations that should optionally trigger side effects (events)
- Any data mutation callable from pages, background jobs, or other commands

Do NOT use commands for:

- Read-only queries (use `app/lib/queries/` instead)
- Pure presentation logic (use partials)
- One-off data transformations with no persistence

## How It Works

```
User Request
    |
    v
Page (Controller) --- calls ---> Command orchestrator
                                       |
                          +------------+------------+
                          |            |            |
                        Build        Check       Execute
                       (your app)  (your app)   (modules/core/commands/execute)
                          |            |            |
                       Construct    Validate      Persist
                        object      fields       via GraphQL
                          |            |            |
                          +-----+------+-----+------+
                                |            |
                            Return       Publish event
                            result       (optional)
```

1. **Build** — Your `app/lib/commands/<resource>/<action>/build.liquid`
   normalizes input from the orchestrator and seeds the validation
   contract.
2. **Check** — Your `app/lib/commands/<resource>/<action>/check.liquid`
   chains calls to `modules/core/lib/validations/<name>`, threading
   the contract through each call.
3. **Execute** — `modules/core/commands/execute` runs the GraphQL
   mutation if `object.valid == true`.

Important: there is **no** `modules/core/commands/build` and **no**
`modules/core/commands/check`. Those phases are app-level files inside
your own command directory. Only `commands/execute` runs at the
module level.

The result object always contains `valid` (boolean), `errors`
(hash keyed by field name with translation-key arrays), and the
original data fields.

## Getting Started

Run the CRUD generator to scaffold the canonical layout in one
command:

```bash
pos-cli generators run crud --resource product --include-views
```

This creates the orchestrator + build + check trio + GraphQL mutation
+ schema + view partials, all wired with the canonical syntax.

To call the command from a page:

```liquid
{% function result = 'commands/products/create',
   params: context.params.product %}

{% if result.valid %}
  {% function _ = 'modules/core/helpers/redirect_to',
     url: '/products', notice: 'app.products.created' %}
{% else %}
  {% render 'products/form', product: result %}
{% endif %}
```

Minimal orchestrator (what the generator produces):

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% doc %}
  @param {object} params - raw input
{% enddoc %}
{% liquid
  function object = 'commands/products/create/build', object: params
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

## See Also

- [configuration.md](configuration.md) — File naming, directory layout, setup
- [api.md](api.md) — Module-level runner + validator family signatures
- [patterns.md](patterns.md) — Common command workflows (canonical examples)
- [gotchas.md](gotchas.md) — Common errors (esp. phantom build/check)
- [advanced.md](advanced.md) — Nested commands, background jobs, transactions
- [modules/core/README.md](../modules/core/README.md) — pos-module-core overview
- [Events & Consumers](../events-consumers/) — Publishing events from commands
- [Background Jobs](../background-jobs/) — Running commands asynchronously
- [GraphQL](../graphql/) — Mutation files used by commands
- [Schema](../schema/) — Table definitions that commands operate on
