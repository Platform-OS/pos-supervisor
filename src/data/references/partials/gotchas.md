# Partials -- Gotchas & Troubleshooting

## Architecture Rules (Type 2 failures — linter does not catch these)

### Every partial needs an @prompt contract

**Cause:** Partials without documentation force the agent (and other developers) to open the file
to understand what it does and what it expects. The plugin uses `@prompt` annotations to annotate
partial usage automatically — without them, callers get no guidance.

```liquid
{# At the top of EVERY partial — required: #}
{% comment %}
  @prompt: Renders a product card with title, price, and add-to-cart button.
           Required params: product (hash — properties_object with title, price fields),
                            show_actions (boolean, default true)
{% endcomment %}
```

The `@prompt` text:
- First line: one sentence describing what the partial renders
- Second line (optional): list required and optional parameters with types
- Shown automatically by the plugin when a page renders this partial

### Partials never call GraphQL

**Cause:** Placing a `{% graphql %}` tag inside a partial. The linter catches this, but
understanding WHY prevents the mistake: partials are pure rendering components — they receive
data and display it. They have no concept of "what page called me" or what context is needed.

```liquid
{# WRONG — GraphQL in partial: #}
{% comment %}@prompt: Shows user profile{% endcomment %}
{% graphql g = 'users/find', id: context.params.id %}
{{ g.user.email }}

{# RIGHT — receive data as parameter: #}
{% comment %}@prompt: Shows user profile. Required: user (hash with email, name){% endcomment %}
{{ user.email }}
```

```liquid
{# In the page that renders it: #}
{% graphql g = 'users/find', id: context.params.id %}
{% render 'users/profile', user: g.user %}
```

---

## Common Errors

### "Partial not found"

**Cause:** The path in render/function does not match a file in `app/views/partials/`.

**Solution:** Verify the path maps correctly. `{% render 'products/card' %}` expects `app/views/partials/products/card.liquid`. Check for typos and ensure the `.liquid` extension exists on disk.

### "Variable is nil inside partial"

**Cause:** Variables are LOCAL to each partial. The caller's variables are not accessible unless explicitly passed.

**Solution:** Pass all needed variables as parameters:
```liquid
{% render 'products/card', product: product, user: profile %}
```

### "GraphQL tag in partial causes error or is ignored"

**Cause:** GraphQL calls should only be made in pages. Using `{% graphql %}` in partials violates the architecture rule and may fail with platformos-check.

**Solution:** Move the GraphQL call to the page and pass the result to the partial as a parameter.

### "Function returns nil"

**Cause:** The partial called via `{% function %}` does not have a `{% return %}` tag, or execution does not reach the return statement.

**Solution:** Ensure every code path in a function partial ends with `{% return value %}`.

### "Underscore-prefixed partial not found"

**Cause:** platformOS does NOT use underscore prefixes for partials (unlike Rails/Shopify conventions).

**Solution:** Rename `_card.liquid` to `card.liquid`. The platformos-check linter flags this.

### "Export variable not accessible"

**Cause:** Missing namespace in export tag, or accessing wrong namespace path.

**Solution:** Always provide namespace: `{% export var, namespace: 'ns' %}`. Access via `{{ context.exports.ns.var }}`.

### "Hardcoded text flagged by linter"

**Cause:** User-facing strings must use translations.

**Solution:** Replace `<h1>Products</h1>` with `<h1>{{ 'app.products.title' | t }}</h1>`.

## Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Nested render depth | 10 levels | Default max_deep_level |
| Partial file size | 1 MB | Keep partials focused and small |
| Variables per render | No hard limit | Pass only what's needed |
| Partials per page | No hard limit | But more partials = slower render |

## Troubleshooting Flowchart

```
Partial problem?
├── Partial not found?
│   ├── Check path matches app/views/partials/<path>.liquid
│   ├── Check no underscore prefix in filename
│   └── Check file has .liquid extension
├── Variable is nil?
│   ├── Check variable is passed as parameter in render/function
│   ├── Check parameter name matches (case-sensitive)
│   └── Remember: variables are LOCAL to each partial
├── Function returns nil?
│   ├── Check {% return %} exists in the partial
│   ├── Check all code paths reach return
│   └── Check partial is called via function (not render)
└── Linter errors?
    ├── No underscore prefix in filenames
    ├── No hardcoded text (use translations)
    └── No GraphQL calls in partials
```

## See Also

- [Partials Overview](README.md)
- [configuration.md](configuration.md) — file naming and structure
- [api.md](api.md) — render, function, return, export reference
- [patterns.md](patterns.md) — best practices
- [CLI](../cli/README.md) — platformos-check linter
