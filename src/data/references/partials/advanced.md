# Partials -- Advanced Topics

## Recursive Partials

Partials can call themselves for tree-like data structures (watch nesting depth limit of 10):

```liquid
{% comment %} app/views/partials/categories/tree.liquid {% endcomment %}
<ul>
  {% for item in items %}
    <li>
      {{ item.name }}
      {% if item.children != blank %}
        {% render 'categories/tree', items: item.children %}
      {% endif %}
    </li>
  {% endfor %}
</ul>
```

## Dynamic Partial Names

You cannot dynamically construct partial names in render/function tags. The path must be a string literal.

```liquid
{% comment %} THIS DOES NOT WORK {% endcomment %}
{% assign partial_name = 'products/' | append: view_type %}
{% render partial_name %}

{% comment %} WORKAROUND: use conditionals {% endcomment %}
{% if view_type == 'card' %}
  {% render 'products/card', product: product %}
{% elsif view_type == 'row' %}
  {% render 'products/row', product: product %}
{% endif %}
```

## Partial as Configuration

Use function partials to return configuration hashes:

```liquid
{% comment %} lib/config/navigation.liquid {% endcomment %}
{% assign nav = [
  { "label": "app.nav.home", "url": "/", "icon": "home" },
  { "label": "app.nav.products", "url": "/products", "icon": "box" },
  { "label": "app.nav.orders", "url": "/orders", "icon": "cart", "permission": "orders.view" }
] %}
{% return nav %}
```

```liquid
{% function nav_items = 'lib/config/navigation' %}
{% for item in nav_items %}
  {% assign label = item.label | t %}
  {% render 'shared/nav_link', label: label, url: item.url %}
{% endfor %}
```

## Module Partial Overrides

To override a module's partial, copy it from `modules/` to `app/modules/`:

```bash
mkdir -p app/modules/user/public/lib/queries/role_permissions
cp modules/user/public/lib/queries/role_permissions/permissions.liquid \
   app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

The app version takes precedence. Only override via this documented mechanism.

## Performance: Partial Render Cost

Each `{% render %}` and `{% function %}` call has overhead. Optimize by:

1. **Reducing nesting depth** — flatten deeply nested partial chains
2. **Caching expensive partials** — wrap in `{% cache %}` when appropriate
3. **Batching data** — pass arrays and loop inside the partial instead of calling render per item

```liquid
{% comment %} SLOWER: render per item {% endcomment %}
{% for product in products %}
  {% render 'products/card', product: product %}
{% endfor %}

{% comment %} FASTER: pass array, loop inside {% endcomment %}
{% render 'products/card_list', products: products %}
```

## Testing Function Partials

Function partials (commands, helpers) are testable via pos-module-tests:

```liquid
{% comment %} app/lib/tests/helpers/format_price_test.liquid {% endcomment %}
{% function result = 'lib/helpers/format_price', amount: 19.99, currency: 'USD' %}
{% function contract = 'modules/tests/assertions/equal', contract: contract, given: result, expected: '$19.99' %}
{% return contract %}
```

## See Also

- [Partials Overview](README.md)
- [patterns.md](patterns.md) — common workflows
- [gotchas.md](gotchas.md) — errors and limits
- [Testing](../testing/README.md) — testing partials
- [Caching](../caching/README.md) — caching partial output
- [Modules](../modules/core/README.md) — module override mechanism
