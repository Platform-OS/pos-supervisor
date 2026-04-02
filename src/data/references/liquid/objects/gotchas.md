# Liquid Objects — Gotchas & Troubleshooting

Common pitfalls when working with the `context` object and other platformOS Liquid objects.

---

## context.current_user — always check for nil

**Cause:** `context.current_user` is nil when no user is logged in. Accessing properties on nil returns nil without error, which causes blank output silently.

```liquid
{# WRONG — crashes silently if not logged in: #}
{{ context.current_user.email }}

{# RIGHT — guard before accessing: #}
{% if context.current_user %}
  {{ context.current_user.email }}
  {{ context.current_user.first_name }}
{% else %}
  {% redirect_to '/sign-in' %}
{% endif %}
```

`context.current_user` is the correct, documented platformOS object for the logged-in user.
Available fields: `id`, `email`, `name`, `first_name`, `last_name`, `created_at`, `jwt_token`,
`temporary_token`, plus any custom properties set on the user table.

Do NOT replace `context.current_user` with `context.exports` — those are completely different
concepts. `context.exports` is for passing data UP from a child partial to its caller via
`{% export %}`. It has nothing to do with user authentication.

---

## Session — set and clear with {% session %}, not GraphQL

**Cause:** Sessions are set and read via the `{% session %}` Liquid tag. There is no
`setSessionVariable` GraphQL mutation — it does not exist.

```liquid
{# Set a session value: #}
{% session user_id = user.id %}

{# Clear a session value: #}
{% session user_id = nil %}

{# Read a session value: #}
{% if context.session.user_id %}
  Logged in as: {{ context.session.user_id }}
{% endif %}
```

Session values persist across requests until explicitly cleared. To log out, set all
auth-related session values to nil.

---

## context.params — always provide defaults

**Cause:** URL and query parameters are nil when not present in the request. Arithmetic
on nil returns nil instead of a number.

```liquid
{# WRONG — nil if param not in URL: #}
{% assign page = context.params.page %}
{% assign offset = page | minus: 1 | times: 20 %}

{# RIGHT — default before arithmetic: #}
{% assign page = context.params.page | default: 1 | plus: 0 %}
{% assign offset = page | minus: 1 | times: 20 %}
```

`| plus: 0` coerces the string "3" to the integer 3. Without it, string arithmetic may
produce unexpected results.

### Multiple values for the same parameter

When a query string contains `?ids=1&ids=2&ids=3`, `context.params.ids` may be an array
or a string depending on how it was submitted. Guard against both:

```liquid
{% assign ids = context.params.ids %}
{% if ids %}
  {% if ids.size > 0 and ids[0] %}
    {# It's an array #}
    {% for id in ids %}{{ id }}{% endfor %}
  {% else %}
    {# It's a single string value #}
    {% assign ids = ids | split: ',' %}
    {% for id in ids %}{{ id }}{% endfor %}
  {% endif %}
{% endif %}
```

---

## context.session — check before iterating

**Cause:** Session values can expire or be cleared. Iterating nil raises an error.

```liquid
{# WRONG — nil if session expired: #}
{% for item in context.session.cart %}
  {{ item.name }}
{% endfor %}

{# RIGHT — check first: #}
{% if context.session.cart %}
  {% for item in context.session.cart %}
    {{ item.name }}
  {% endfor %}
{% else %}
  <p>Cart is empty.</p>
{% endif %}
```

---

## context.headers — case-insensitive access

Header names in `context.headers` are normalized to lowercase by platformOS.
Always use lowercase keys:

```liquid
{# Access headers with lowercase keys: #}
{% assign ua = context.headers['user-agent'] %}
{% assign content_type = context.headers['content-type'] %}
```

`X-Forwarded-For` is also accessible but can be spoofed by clients — do not rely on it
for security decisions. Use `context.visitor.ip` for the server-determined IP.

---

## context.cookies — nil when not set

```liquid
{# WRONG — nil if cookie absent: #}
{% assign prefs = context.cookies.user_prefs | parse_json %}

{# RIGHT — default before parse: #}
{% assign raw = context.cookies.user_prefs | default: '{}' %}
{% assign prefs = raw | parse_json %}
```

---

## context.location — paths include no trailing slash

`context.location.pathname` never includes a trailing slash (except for the root `/`).
`context.location.search` returns the raw query string including `?`.
Use `context.params` to access parsed query string values instead.

```liquid
{# context.location.search = "?page=2&sort=name" — raw string #}
{# context.params.page = "2"                     — already parsed #}

{% assign current_path = context.location.pathname %}
{% if current_path == '/products' %}
  ...
{% endif %}
```

---

## context.constants — may differ between environments

Constants set via `pos-cli constants` are per-environment. A constant set in production
is not automatically available in staging.

```liquid
{# Guard when constant might be absent: #}
{% assign api_key = context.constants.payment_api_key %}
{% if api_key == blank %}
  {% log "payment_api_key constant not set", type: 'error' %}
{% endif %}
```

---

## Troubleshooting Flowchart

```
context object returning nil?
├── context.current_user nil?
│   └── User is not logged in — guard with {% if context.current_user %}
├── context.params.X nil?
│   └── Param not in request — add | default: value
├── context.session.X nil?
│   └── Session expired or never set — check before using
├── context.constants.X nil?
│   └── Constant not set for this environment — set via pos-cli constants
└── context.headers.X nil?
    └── Use lowercase key — headers are normalized to lowercase
```

## See Also

- [Objects Configuration](configuration.md)
- [Objects API Reference](api.md)
- [Objects Patterns](patterns.md)
- [Advanced Techniques](advanced.md)
- [Sessions](../../sessions/README.md) — session tag and context.session
- [Authentication](../../authentication/README.md) — context.current_user usage
