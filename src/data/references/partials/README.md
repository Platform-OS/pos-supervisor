# Partials (Templates & Functions)

Partials contain all presentation HTML and reusable logic. They are the building blocks of the UI layer.

## Location

`app/views/partials/`

## Rendering Partials

### As a template (render)
```liquid
{% render 'products/card', product: product, show_price: true %}
```

### As a function (returns data)
```liquid
{% function result = 'lib/commands/products/create', title: "New Product", price: 19.99 %}
```

## Naming Rules

- **NO underscore prefix** in filenames (e.g., `card.liquid`, NOT `_card.liquid`)
- View partials: `render 'products/card'` → `app/views/partials/products/card.liquid`
- Commands/queries: `function r = 'lib/commands/products/create'` → `app/lib/commands/products/create.liquid`

## Variable Scope

Variables in platformOS partials are **LOCAL**. A variable defined inside a partial is NOT available in the page that includes it.

### Exporting variables
Use the `export` tag to make variables available via `context.exports`:

```liquid
{% comment %} In partial {% endcomment %}
{% export my_var, namespace: 'my_namespace' %}

{% comment %} In page after calling partial {% endcomment %}
{{ context.exports.my_namespace.my_var }}
```

### Returning data from function partials
Use the `return` tag:

```liquid
{% comment %} app/lib/helpers/calculate_tax.liquid {% endcomment %}
{% assign tax = price | times: 0.2 %}
{% return tax %}
```

## Partial Organization

```
app/views/partials/
├── lib/
│   ├── commands/        # Business logic partials
│   ├── queries/         # Data query wrappers
│   └── helpers/         # Utility functions
├── products/            # Product-related templates
│   ├── card.liquid
│   ├── list.liquid
│   └── form.liquid
├── shared/              # Shared UI components
│   ├── navigation.liquid
│   └── footer.liquid
└── layouts/             # Layout sub-components
```

## Rules

- Partials contain ALL HTML/JS/CSS presentation
- NO GraphQL calls in partials (data comes from pages via parameters)
- NO hardcoded user-facing text (use `{{ 'app.key' | t }}`)
- Use `render` for display-only partials
- Use `function` for partials that return data
