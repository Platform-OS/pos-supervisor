# Partials -- Configuration & File Structure

## File Location

View partials reside in `app/views/partials/`. Commands and queries reside in `app/lib/`. The path in render/function maps directly:

- `{% render 'products/card' %}` → `app/views/partials/products/card.liquid`
- `{% function r = 'lib/commands/products/create' %}` → `app/lib/commands/products/create.liquid`
- `{% function r = 'lib/queries/products/search' %}` → `app/lib/queries/products/search.liquid`

## Naming Rules

- NO underscore prefix (use `card.liquid`, NOT `_card.liquid`)
- Use lowercase with hyphens or underscores for multi-word names
- Extension is always `.liquid`

## Recommended Directory Structure

```
app/
├── lib/                          # Logic partials (called via function)
│   ├── commands/
│   │   ├── products/
│   │   │   ├── create.liquid
│   │   │   ├── update.liquid
│   │   │   └── delete.liquid
│   │   └── orders/
│   ├── queries/
│   │   ├── products/
│   │   │   ├── search.liquid
│   │   │   └── find.liquid
│   │   └── orders/
│   ├── helpers/
│   │   ├── format_price.liquid
│   │   └── calculate_tax.liquid
│   ├── consumers/
│   │   └── order_created/
│   │       └── send_email.liquid
│   └── tests/
│       └── products/
│           └── create_test.liquid
└── views/partials/               # UI partials (called via render)
    ├── products/
    │   ├── card.liquid
    │   ├── list.liquid
    │   ├── form.liquid
    │   └── show.liquid
    ├── orders/
    ├── shared/
    │   ├── navigation.liquid
    │   ├── footer.liquid
    │   ├── breadcrumbs.liquid
    │   └── pagination.liquid
    └── layouts/
        └── head.liquid
```

## Invocation Methods

### render (template — produces HTML output)

```liquid
{% render 'products/card', product: product, show_price: true %}
```

Variables must be explicitly passed. The partial cannot access the caller's scope.

### function (returns data via return tag)

```liquid
{% function result = 'lib/commands/products/create', title: "New", price: 19.99 %}
```

The partial must use `{% return value %}` to send data back.

## Variable Scoping

Variables inside a partial are LOCAL. They do not leak to the caller.

### Exporting to context.exports

```liquid
{% export my_var, namespace: 'my_ns' %}
```

Accessible after the partial runs: `{{ context.exports.my_ns.my_var }}`

### Returning from function calls

```liquid
{% return result %}
```

## See Also

- [Partials Overview](README.md)
- [api.md](api.md) — render, function, return, export tags
- [patterns.md](patterns.md) — common partial workflows
- [gotchas.md](gotchas.md) — common errors
- [Pages](../pages/README.md) — pages call partials
- [Liquid Tags](../liquid/tags/README.md) — render, function, return, export reference
