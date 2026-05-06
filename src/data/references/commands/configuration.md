# Commands -- Configuration Reference

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Directory Structure

Commands live under `app/lib/commands/`. Each action is **three** files:
the orchestrator and a sibling directory holding `build.liquid` and
`check.liquid`.

```
app/
├── lib/
│   └── commands/
│       ├── products/
│       │   ├── create.liquid              # orchestrator
│       │   ├── create/
│       │   │   ├── build.liquid           # build phase
│       │   │   └── check.liquid           # check phase
│       │   ├── update.liquid
│       │   ├── update/
│       │   │   ├── build.liquid
│       │   │   └── check.liquid
│       │   └── delete.liquid              # delete typically skips build/check
│       ├── orders/
│       │   ├── create.liquid
│       │   ├── create/
│       │   │   ├── build.liquid
│       │   │   └── check.liquid
│       │   ├── cancel.liquid
│       │   └── fulfill.liquid
│       └── users/
│           ├── create.liquid
│           └── create/
│               ├── build.liquid
│               └── check.liquid
├── graphql/
│   ├── products/
│   │   ├── create.graphql
│   │   ├── update.graphql
│   │   └── delete.graphql
│   └── orders/
│       ├── create.graphql
│       └── update.graphql
└── schema/
    ├── product.yml
    └── order.yml
```

The build/check phases for each action are **inline phases of your
command** — there is **no** module-level `commands/build` or
`commands/check`. Only `modules/core/commands/execute` runs at the
module top level.

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Orchestrator | `app/lib/commands/<resource>/<action>.liquid` | `app/lib/commands/products/create.liquid` |
| Build phase | `app/lib/commands/<resource>/<action>/build.liquid` | `app/lib/commands/products/create/build.liquid` |
| Check phase | `app/lib/commands/<resource>/<action>/check.liquid` | `app/lib/commands/products/create/check.liquid` |
| GraphQL mutation | `app/graphql/<resource>/<action>.graphql` | `app/graphql/products/create.graphql` |
| Schema table | `app/schema/<resource>.yml` | `app/schema/product.yml` |
| Command call | `commands/<resource>/<action>` | `commands/products/create` |
| Phase call (from orchestrator) | `commands/<resource>/<action>/<phase>` | `commands/products/create/build` |
| Mutation name | `<resource>/<action>` | `products/create` |

Note: When calling a command, use `commands/...` (NOT `lib/commands/...`).
The platformOS partial resolver searches `app/lib/` automatically —
adding a `lib/` prefix produces an invalid path like
`app/lib/lib/commands/...`.

## Required GraphQL Mutation

Each command that persists data requires a corresponding `.graphql`
mutation file. Example for `products/create`:

```graphql
# app/graphql/products/create.graphql
mutation products_create($object: HashObject!) {
  record_create(
    record: {
      table: "product"
      properties: [
        { name: "title", value: $object.title }
        { name: "price", value: $object.price }
        { name: "description", value: $object.description }
      ]
    }
  ) {
    id
    created_at
    table
    properties
  }
}
```

## Required Schema Table

Commands typically operate on tables defined in `app/schema/`:

```yaml
# app/schema/product.yml
name: product
properties:
  - name: title
    type: string
  - name: price
    type: float
  - name: description
    type: text
```

## Command File Templates

### Orchestrator template

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}
{% doc %}
  @param {object} params - raw input (typically context.params.<resource>)
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

### Build phase template

```liquid
{% comment %} app/lib/commands/products/create/build.liquid {% endcomment %}
{% doc %}
  @param {object} object - raw input from the orchestrator
{% enddoc %}
{% liquid
  assign object = object | hash_merge: valid: true, errors: empty
  return object
%}
```

### Check phase template

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

## Module Dependency

Commands require `pos-module-core` for `commands/execute` and the
validator family. Ensure it's installed:

```bash
pos-cli modules install core
```

Without it, every `modules/core/...` partial reference will fail to
resolve. Note: installing core does **not** make
`modules/core/commands/build` or `modules/core/commands/check` exist —
those phases are app-level files you write yourself.

## Scaffolding

Run the CRUD generator to create the canonical layout in one command:

```bash
pos-cli generators run crud --resource product --include-views
```

This produces the orchestrator + build/check siblings + GraphQL
mutation + schema entry + view partials in one shot, all wired with
the canonical syntax.

## Configuration Checklist

- [ ] Orchestrator at `app/lib/commands/<resource>/<action>.liquid`
- [ ] Build phase at `app/lib/commands/<resource>/<action>/build.liquid`
- [ ] Check phase at `app/lib/commands/<resource>/<action>/check.liquid`
- [ ] GraphQL mutation at `app/graphql/<resource>/<action>.graphql`
- [ ] Schema table at `app/schema/<resource>.yml`
- [ ] `pos-module-core` installed
- [ ] `platformos-check` passes with zero errors

## See Also

- [README.md](README.md) -- Commands overview and getting started
- [api.md](api.md) -- Module-level command runner + validator family
- [patterns.md](patterns.md) -- Real-world command examples
- [gotchas.md](gotchas.md) -- Common configuration mistakes
- [advanced.md](advanced.md) -- Multi-step commands and advanced configuration
- [Schema Reference](../schema/) -- Table definition syntax
- [GraphQL Reference](../graphql/) -- Mutation file syntax
