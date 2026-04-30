# Partials -- Patterns & Best Practices

## UI Component Pattern

Presentational partials receive all data as parameters and produce HTML.

```liquid
{% comment %} app/views/partials/products/card.liquid {% endcomment %}
<div class="pos-card">
  <h3 class="pos-card__title">{{ product.title }}</h3>
  {% if show_price %}
    <p class="pos-card__price">{{ product.price | pricify }}</p>
  {% endif %}
  <a href="/products/{{ product.id }}" class="pos-button">{{ 'app.products.view' | t }}</a>
</div>
```

Pages delegate to a list partial which loops:

```liquid
{# In the page (controller): #}
{% graphql products = 'products/search' %}
{% render 'products/list', products: products.records.results %}
```

```liquid
{# In app/views/partials/products/list.liquid: #}
{% for product in products %}
  {% render 'products/card', product: product, show_price: true %}
{% endfor %}
```

## Function Partial Pattern (Query Wrapper)

Wrap a GraphQL call location in a query partial so the actual graphql tag stays in the page layer but the query logic is reusable.

```liquid
{% comment %} app/lib/queries/products/search.liquid {% endcomment %}
{% comment %} NOTE: This is called from pages which pass graphql results {% endcomment %}
{% assign filtered = products | array_select: available: true %}
{% assign sorted = filtered | array_sort_by: 'title' %}
{% return sorted %}
```

## Command Partial Pattern

See [Commands](../commands/README.md) for the full build/check/execute
pattern. The command is **three** files: orchestrator + sibling
`build.liquid` + sibling `check.liquid`. There is **no**
`modules/core/commands/build` / `…/check` — only `commands/execute`
runs at the module level.

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

## Form Partial with Validation Errors

```liquid
{% comment %} app/views/partials/products/form.liquid {% endcomment %}
<form method="post" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <div class="pos-form-group {% if product.errors.title %}pos-form-group--error{% endif %}">
    <label for="title">{{ 'app.products.title' | t }}</label>
    <input type="text" id="title" name="product[title]" value="{{ product.title }}">
    {% if product.errors.title %}
      <span class="pos-form-error">{{ product.errors.title | join: ', ' }}</span>
    {% endif %}
  </div>

  <button type="submit" class="pos-button pos-button--primary">{{ 'app.save' | t }}</button>
</form>
```

## Nested Partials

Partials can render other partials (but watch nesting depth):

```liquid
{% comment %} products/list.liquid {% endcomment %}
<div class="products-grid">
  {% for product in products %}
    {% render 'products/card', product: product, show_price: true %}
  {% endfor %}
</div>
{% render 'shared/pagination', total_pages: total_pages %}
```

## Helper Function Pattern

Small utility partials that return computed values:

```liquid
{% comment %} lib/helpers/format_price.liquid {% endcomment %}
{% if currency == blank %}
  {% assign currency = 'USD' %}
{% endif %}
{% assign formatted = amount | pricify: currency %}
{% return formatted %}
```

## Best Practices

1. **Never call GraphQL from partials** — receive data from pages as parameters
2. **Never hardcode text** — use `{{ 'app.key' | t }}` for all user-facing strings
3. **No underscore prefix** — `card.liquid` not `_card.liquid`
4. **Keep partials focused** — one component or one function per file
5. **Use function for data, render for HTML** — clear separation of concerns
6. **Pass only needed data** — don't pass the entire context object

## See Also

- [Partials Overview](README.md)
- [api.md](api.md) — tag reference
- [gotchas.md](gotchas.md) — common errors
- [Commands](../commands/README.md) — command partial pattern
- [Translations](../translations/README.md) — i18n for partial text
