# platformOS Liquid Objects

## context (Global Object)

The primary global object accessible everywhere in platformOS.

### context.params
HTTP parameters from query string and request body.

```liquid
{{ context.params.id }}
{{ context.params.product.title }}
{{ context.params.page }}
```

### context.session
Server-side session storage. Set via `{% session %}` tag.

```liquid
{{ context.session.cart_id }}
```

### context.location
URL information for the current request.

```liquid
{{ context.location.pathname }}   → /products/123
{{ context.location.search }}     → ?page=2
{{ context.location.host }}       → example.com
{{ context.location.href }}       → full URL
```

### context.environment
Returns `"staging"` or `"production"`.

```liquid
{% if context.environment == 'staging' %}
  {% log data, type: 'debug' %}
{% endif %}
```

### context.is_xhr
Boolean `true` for AJAX/XMLHttpRequest; `null` otherwise.

```liquid
{% if context.is_xhr %}
  {% render 'products/list_partial', products: products %}
{% else %}
  {% render 'products/list_page', products: products %}
{% endif %}
```

### context.authenticity_token
CSRF token for non-GET forms.

```liquid
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

### context.current_user
User data (id, email, first_name, last_name, slug). **NEVER use directly** — use `modules/user/queries/user/current` instead.

### context.constants
Environment constants (API keys, secrets). Hidden from `{{ context }}` output for security.

```liquid
{{ context.constants.STRIPE_SK_KEY }}
{{ context.constants.API_BASE_URL }}
```

### context.headers
HTTP request headers.

```liquid
{{ context.headers.HTTP_USER_AGENT }}
{{ context.headers.HTTP_ACCEPT }}
{{ context.headers.SERVER_NAME }}
{{ context.headers.REQUEST_METHOD }}
```

### context.cookies
All site cookies.

```liquid
{{ context.cookies.my_cookie }}
```

### context.device
UserAgent-based device info.

```liquid
{{ context.device.device_type }}   → desktop, smartphone, tablet
```

### context.page
Current page metadata.

```liquid
{{ context.page.id }}
{{ context.page.slug }}
{{ context.page.layout }}
{{ context.page.metadata.title }}
```

### context.language
ISO language code for the current request.

```liquid
{{ context.language }}   → "en"
```

### context.flash
Flash messages from form submissions.

```liquid
{{ context.flash.notice }}
{{ context.flash.alert }}
```

### context.modules
Information about installed modules (version, subscription status).

### context.visitor
Browser visitor info.

```liquid
{{ context.visitor.ip }}
```

### context.exports
Variables exported from partials via the `export` tag.

```liquid
{{ context.exports.namespace.variable_name }}
```

## forloop Object

Available inside `{% for %}` loops.

| Property | Description |
|----------|-------------|
| `forloop.first` | `true` on first iteration |
| `forloop.last` | `true` on last iteration |
| `forloop.index` | Current index (1-based) |
| `forloop.index0` | Current index (0-based) |
| `forloop.rindex` | Reverse index (1-based) |
| `forloop.rindex0` | Reverse index (0-based) |
| `forloop.length` | Total iterations |
| `forloop.parentloop` | Access parent loop in nested loops |

## tablerowloop Object

Available inside `{% tablerow %}` loops. Same properties as forloop plus:

| Property | Description |
|----------|-------------|
| `tablerowloop.col` | Current column (1-based) |
| `tablerowloop.col0` | Current column (0-based) |
| `tablerowloop.col_first` | `true` if first column |
| `tablerowloop.col_last` | `true` if last column |
