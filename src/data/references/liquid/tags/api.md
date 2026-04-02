# Liquid Tags -- API Reference

Complete syntax reference for all 25 platformOS-specific Liquid tags.

## graphql

Execute a GraphQL query or mutation.

```liquid
{% graphql result = "query_name" %}
{% graphql result = "query_name", param1: value1, param2: value2 %}
{% graphql result = "query_name", args: hash_variable %}
```

Inline query (no file):

```liquid
{% graphql result %}
  mutation {
    record_create(record: { table: "orders", properties: [{ name: "status", value: "pending" }] }) {
      id
    }
  }
{% endgraphql %}
```

Result is a hash with query name as key, or `errors` on failure.

## function

Call a partial as a function, capturing its return value.

```liquid
{% function result = 'path/to/partial' %}
{% function result = 'path/to/partial', arg1: val1, arg2: val2 %}
```

The partial MUST use `{% return %}` to send data back. Only passed arguments are accessible inside the partial.

## render

Render a partial template inline. Output replaces the tag.

```liquid
{% render 'path/to/partial' %}
{% render 'path/to/partial', product: product, show_price: true %}
```

## background

Execute code asynchronously.

```liquid
{% background source_name: 'send_email', delay: 0.1, priority: 'low', max_attempts: 3 %}
  {% graphql _ = 'emails/send', to: email %}
{% endbackground %}
```

Partial form:

```liquid
{% background job = 'lib/jobs/send_email', email: email, delay: 1, priority: 'high' %}
```

## cache

Cache a rendered fragment.

```liquid
{% cache 'product_list', expire: 3600 %}
  {% graphql products = 'products/search' %}
  {% render 'products/grid', products: products.records.results %}
{% endcache %}
```

## assign (hash/array literals)

Assign a hash or array literal directly to a variable. This is the modern replacement for the deprecated `parse_json` block tag.

```liquid
{% assign config = { "per_page": 20, "sort": "created_at", "tags": ["featured", "new"] } %}
```

Use variables directly (no quotes, no `| json` filter needed):

```liquid
{% assign payload = { "name": name, "email": email } %}
```

## redirect_to

Issue an HTTP redirect.

```liquid
{% redirect_to '/products' %}
{% redirect_to '/old-page', status: 301 %}
{% redirect_to context.params.return_url %}
```

## session

Set or clear session data.

```liquid
{% session cart_id = order.id %}
{% session user_token = token %}
{% session cart_id = null %}
```

## log

Write to environment logs.

```liquid
{% log variable %}
{% log data, type: 'debug' %}
{% log error_msg, type: 'error', env: 'staging' %}
```

## sign_in

Authenticate a user.

```liquid
{% sign_in user_id: user.id %}
{% sign_in user_id: user.id, timeout_in_minutes: 120 %}
```

## transaction / rollback

Atomic database operations with optional manual rollback.

```liquid
{% transaction timeout: 5 %}
  {% graphql order = 'orders/create', data: order_data %}
  {% graphql _ = 'inventory/decrement', product_id: pid, qty: qty %}
  {% if order.errors %}
    {% rollback %}
  {% endif %}
{% endtransaction %}
```

## try / catch

Exception handling.

```liquid
{% try %}
  {% graphql result = 'external/api_call', url: url %}
{% catch error %}
  {% log error, type: 'error' %}
  {% assign result = nil %}
{% endtry %}
```

The error variable contains the exception message string.

## export

Share a variable from a partial via `context.exports`.

```liquid
{% export my_data, namespace: 'products' %}
```

Access later: `{{ context.exports.products.my_data }}`

## return

Return a value from a `function`-invoked partial. Stops execution of the partial.

```liquid
{% return result %}
{% return null %}
```

## content_for / yield

Store markup in a named block (page/partial), render it in a layout.

```liquid
{% content_for 'page_scripts' %}
  <script src="{{ 'app.js' | asset_url }}"></script>
{% endcontent_for %}
```

In layout:

```liquid
{% yield 'page_scripts' %}
```

## response_status

Set the HTTP response status code.

```liquid
{% response_status 404 %}
{% response_status 201 %}
{% response_status 503 %}
```

## response_headers

Set custom HTTP response headers. Pass a JSON string.

```liquid
{% response_headers '{"Content-Type": "application/json"}' %}
{% response_headers '{"Cache-Control": "no-store", "X-Robots-Tag": "noindex"}' %}
```

## assign (hash key mutation)

Modify hash values by key. Supports nested keys. This is the modern replacement for the deprecated `hash_assign` tag.

```liquid
{% assign user["name"] = "Alice" %}
{% assign config["settings"]["theme"] = "dark" %}
{% assign cart["items"] = cart["items"] | array_add: new_item %}
```

## print

Output without HTML escaping (unescaped). Equivalent to `| html_safe`.

```liquid
{% print rendered_html %}
{% print svg_content %}
```

**Warning:** Never use with user-supplied input. Use `{{ variable }}` (escaped) for user data.

## spam_protection

Render CAPTCHA markup for form spam protection.

```liquid
{% spam_protection "recaptcha_v2" %}
{% spam_protection "recaptcha_v3", action: "login" %}
{% spam_protection "hcaptcha" %}
```

## context (tag)

Set the locale for the current request.

```liquid
{% context language: 'en' %}
{% context language: 'de' %}
{% context language: context.params.lang %}
```

## theme_render_rc

Render a theme partial with configurable search paths.

```liquid
{% theme_render_rc 'header' %}
{% theme_render_rc 'components/button' %}
```

## form / include_form

Legacy form rendering tags. Prefer standard HTML forms.

```liquid
{% form %}
  <input name="name" value="">
{% endform %}

{% include_form 'contact_form' %}
```

## Output Escaping Summary

| Method | Escaped | Use For |
|--------|---------|---------|
| `{{ var }}` | Yes (safe) | User-facing data, any untrusted input |
| `{% print var %}` | No (raw) | Pre-sanitized HTML, SVG, trusted markup |
| `{{ var \| html_safe }}` | No (raw) | Same as print -- marks string as safe |

## See Also

- [Tags Overview](README.md) -- introduction and categories
- [Tags Configuration](configuration.md) -- detailed parameter tables
- [Tags Patterns](patterns.md) -- real-world usage examples
- [Tags Gotchas](gotchas.md) -- common errors and limits
- [Tags Advanced](advanced.md) -- optimization and edge cases
- [Liquid Filters API](../filters/api.md) -- filter syntax reference
- [Liquid Objects API](../objects/api.md) -- global object reference
