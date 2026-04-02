# Commands -- Configuration Reference

## Directory Structure

Commands live under `app/lib/commands/`. Organize by resource name, then action:

```
app/
├── lib/
│   └── commands/
│       ├── products/
│       │   ├── create.liquid
│       │   ├── update.liquid
│       │   └── delete.liquid
│       ├── orders/
│       │   ├── create.liquid
│       │   ├── update.liquid
│       │   ├── cancel.liquid
│       │   └── fulfill.liquid
│       └── users/
│           ├── create.liquid
│           └── update_profile.liquid
├── graphql/
│   ├── products/
│   │   ├── create.graphql      # mutation used by commands/products/create
│   │   ├── update.graphql
│   │   └── delete.graphql
│   └── orders/
│       ├── create.graphql
│       └── update.graphql
└── schema/
    ├── product.yml              # table definition
    └── order.yml
```

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Command file | `app/lib/commands/<resource>/<action>.liquid` | `app/lib/commands/products/create.liquid` |
| GraphQL mutation | `app/graphql/<resource>/<action>.graphql` | `app/graphql/products/create.graphql` |
| Schema table | `app/schema/<resource>.yml` | `app/schema/product.yml` |
| Command call | `lib/commands/<resource>/<action>` | `lib/commands/products/create` |
| Mutation name | `<resource>/<action>` | `products/create` |

Note: When calling a command, use `lib/commands/...` — the `lib/` prefix maps to `app/lib/`.

## Required GraphQL Mutation

Each command that persists data requires a corresponding `.graphql` mutation file. Example for `products/create`:

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

Commands typically operate on tables defined in `app/schema/`. Example:

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

## Command File Template

Every command file follows this skeleton:

```liquid
{% comment %} app/lib/commands/products/create.liquid {% endcomment %}

{% comment %} === BUILD === {% endcomment %}
{% assign object = { "title": title, "price": price } %}
{% function object = 'modules/core/commands/build', object: object %}

{% comment %} === CHECK === {% endcomment %}
{% assign validators = [
  { "name": "presence", "property": "title" },
  { "name": "numericality", "property": "price" }
] %}
{% function object = 'modules/core/commands/check', object: object, validators: validators %}

{% comment %} === EXECUTE === {% endcomment %}
{% if object.valid %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'products/create',
    selection: 'record_create',
    object: object
  %}
{% endif %}

{% return object %}
```

## Module Dependency

Commands require `pos-module-core`. Ensure it is installed:

```bash
pos-cli modules install core
```

The core module provides the `build`, `check`, and `execute` helpers. Without it, the `modules/core/commands/*` partials will not resolve.

## Configuration Checklist

- [ ] Command file at `app/lib/commands/<resource>/<action>.liquid`
- [ ] GraphQL mutation at `app/graphql/<resource>/<action>.graphql`
- [ ] Schema table at `app/schema/<resource>.yml`
- [ ] `pos-module-core` installed
- [ ] `platformos-check` passes with zero errors

## See Also

- [README.md](README.md) -- Commands overview and getting started
- [api.md](api.md) -- Core module helper signatures and validator details
- [patterns.md](patterns.md) -- Real-world command examples
- [gotchas.md](gotchas.md) -- Common configuration mistakes
- [advanced.md](advanced.md) -- Multi-step commands and advanced configuration
- [Schema Reference](../schema/) -- Table definition syntax
- [GraphQL Reference](../graphql/) -- Mutation file syntax
