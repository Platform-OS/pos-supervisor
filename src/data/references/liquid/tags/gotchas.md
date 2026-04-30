# Liquid Tags — Gotchas & Troubleshooting

Common errors and edge cases when using platformOS-specific Liquid tags.

---

## graphql tag — file-reference syntax only

**Cause:** The `{% graphql %}` tag requires a file path string. There is no inline
query block syntax. Old documentation showing `{% graphql 'name' %}...{% endgraphql %}`
is outdated and does not work in pos-cli v6.0.0+.

```liquid
{# WRONG — inline block syntax does not exist: #}
{% graphql get_user %}
  query GetUser($id: ID!) {
    user(id: $id) { id name email }
  }
{% endgraphql %}

{# RIGHT — file-reference syntax only: #}
{% graphql get_user = 'users/find', id: context.params.id %}
{{ get_user.user.email }}
```

The path is relative to `app/graphql/`. The file must exist at
`app/graphql/users/find.graphql`.

---

## graphql tag — not allowed in partials

**Cause:** `{% graphql %}` may only be called from page files. Partials are
pure rendering components — they receive data and display it.

```liquid
{# WRONG — graphql inside a partial: #}
{% comment %}@prompt: Shows the latest products{% endcomment %}
{% graphql g = 'products/list' %}
{% for p in g.records.results %}
  {{ p.properties_object.title }}
{% endfor %}

{# RIGHT — page fetches, partial renders: #}
{# In the page file: #}
{% graphql g = 'products/list' %}
{% render 'products/list', products: g.records.results %}
```

```liquid
{# In app/views/partials/products/list.liquid: #}
{% comment %}@prompt: Renders a list of products. Required: products (array of records){% endcomment %}
{% for product in products %}
  {{ product.properties_object.title }}
{% endfor %}
```

---

## function tag — calls a partial file, not an inline block

**Cause:** `{% function %}` calls an existing partial file and captures its
`{% return %}` value. It is NOT a block tag — there is no `{% function %}...{% endfunction %}`
inline syntax.

```liquid
{# WRONG — function is not a block tag: #}
{% function get_total %}
  {% assign total = price | times: qty %}
  {% return total %}
{% endfunction %}

{# RIGHT — function calls a partial file: #}
{% function total = 'helpers/calculate_total', price: product.price, qty: qty %}
{{ total }}
```

The partial at `app/lib/helpers/calculate_total.liquid` must contain
the logic and end with `{% return value %}`.

---

## function tag — returns nil when return is missing

**Cause:** The partial called via `{% function %}` has no `{% return %}` tag, or
execution reaches the end without hitting one.

```liquid
{# partial lib/helpers/get_status.liquid — WRONG: no return #}
{% comment %}@prompt: Returns order status string{% endcomment %}
{% assign status = order.properties_object.status | default: 'pending' %}
{# Nothing returned — caller gets nil #}

{# CORRECT: always return #}
{% comment %}@prompt: Returns order status string. Required: order (record){% endcomment %}
{% assign status = order.properties_object.status | default: 'pending' %}
{% return status %}
```

Every code path in a function partial must reach a `{% return %}` statement.
Use `{% return nil %}` to explicitly return nil on error paths.

---

## {% liquid %} block — one statement per line

**Cause:** The `{% liquid %}` tag processes each line as a separate statement.
Line-wrapped expressions break the parser.

```liquid
{# WRONG — wrapped line breaks parsing: #}
{% liquid
  assign message = 'Hello, '
    | append: user.name
%}

{# RIGHT — keep each statement on one line: #}
{% liquid
  assign greeting = 'Hello, '
  assign message = greeting | append: user.name
%}
```

Inside `{% liquid %}`, tag names are written without `{%` and `%}` delimiters:
`assign`, `if`, `endif`, `graphql`, `render`, `for`, `endfor`, etc.

---

## render tag — path does not include partials directory prefix

**Cause:** The path in `{% render %}` is relative to `app/views/partials/`.
It does not start with `partials/`, does not include `.liquid`, and does not
use underscore prefixes.

```liquid
{# WRONG — incorrect path prefixes: #}
{% render 'partials/products/card', product: product %}
{% render '_card', product: product %}
{% render 'products/card.liquid', product: product %}

{# RIGHT — relative to app/views/partials/ without extension: #}
{% render 'products/card', product: product %}
```

File on disk: `app/views/partials/products/card.liquid`

---

## Building hashes -- use assign with literals, not string concatenation

**Cause:** Hand-building JSON strings leads to escaping errors. Use `assign` with hash literals instead.

```liquid
{# WRONG -- brittle string building: #}
{% assign payload = '{"name":"' | append: user.name | append: '"}' %}
{% assign data = payload | parse_json %}

{# RIGHT -- assign with hash literal, variable referenced directly: #}
{% assign data = { "name": user.name } %}
```

For static configuration hashes, assign a literal directly:

```liquid
{# Hash literal: #}
{% assign config = { "timeout": 30, "retries": 3 } %}
{{ config.timeout }}
```

---

## session tag — set to nil to clear

**Cause:** Session values must be explicitly cleared. Setting to a non-nil value persists
the value across requests.

```liquid
{# Set on login: #}
{% session user_id = context.current_user.id %}

{# Clear on logout: #}
{% session user_id = nil %}

{# Read via context.session: #}
{% if context.session.user_id %}
  {{ context.session.user_id }}
{% endif %}
```

---

## Troubleshooting Flowchart

```
Tag not working?
├── graphql tag error?
│   ├── "not allowed in partials" → Move to page, pass result to partial
│   ├── "QueryNotFound" → Check file path relative to app/graphql/
│   └── Inline block syntax → Use file-reference syntax only
├── function tag returns nil?
│   ├── Check partial has {% return value %}
│   └── Check all code paths reach a return statement
├── render — partial not found?
│   ├── Path is relative to app/views/partials/
│   ├── No underscore prefix in filename
│   └── No .liquid extension in path string
├── liquid block — syntax error?
│   └── Each statement must be on one line
└── session not clearing?
    └── Use {% session key = nil %}
```

## See Also

- [Tags API Reference](api.md)
- [Tags Patterns](patterns.md)
- [Tags Advanced](advanced.md)
- [GraphQL Gotchas](../../graphql/gotchas.md)
- [Partials Gotchas](../../partials/gotchas.md)
