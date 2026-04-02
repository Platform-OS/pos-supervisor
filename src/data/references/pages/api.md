# Pages -- API Reference

This document covers the Liquid tags, filters, and context objects available inside page files.

## Liquid Tags in Pages

### graphql

Executes a GraphQL query or mutation from a `.graphql` file. **Only use in pages, never in partials.**

```liquid
{% graphql result = 'path/to/query', arg1: value1, arg2: value2 %}
```

| Parameter | Type   | Description                                      |
|-----------|--------|--------------------------------------------------|
| `result`  | Variable | Variable name to store the response             |
| First string | String | Path to `.graphql` file (relative to `app/graphql/`) |
| Named args | Any    | Variables passed to the GraphQL operation        |

```liquid
{% graphql products = 'products/search', page: 1, limit: 20, title: "Widget" %}
{% graphql product = 'products/find', id: context.params.id %}
{% graphql _ = 'products/delete', id: context.params.id %}
```

#### Passing a hash as args

```liquid
{% assign params = { "page": context.params.page | default: 1, "limit": 10 } %}
{% graphql result = 'products/search', args: params %}
```

### render

Renders a partial template. The partial receives only explicitly passed variables.

```liquid
{% render 'partial/path', var1: value1, var2: value2 %}
```

```liquid
{% render 'products/card', product: product, show_price: true %}
{% render 'shared/pagination', total_pages: result.total_pages, current_page: page %}
```

### function

Calls a partial and captures its return value.

```liquid
{% function result = 'partial/path', arg1: value1 %}
```

```liquid
{% function profile = 'modules/user/queries/user/current' %}
{% function valid = 'lib/commands/products/validate', params: context.params %}
{% function slug = 'lib/helpers/slugify', text: product.title %}
```

### include

Similar to `function` but shares the parent scope. Used primarily for module helpers.

```liquid
{% include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'products.edit' %}
```

### redirect_to

Performs an HTTP redirect. Terminates page execution.

```liquid
{% redirect_to '/path' %}
{% redirect_to '/path', status: 301 %}
{% redirect_to context.params.return_url %}
```

| Parameter | Type   | Default | Description           |
|-----------|--------|---------|-----------------------|
| URL       | String | --      | Target URL (required) |
| `status`  | Int    | 302     | HTTP status code      |

### log

Writes a message to the instance logs.

```liquid
{% log product, type: 'debug' %}
{% log "User not found", type: 'error' %}
```

| Parameter | Type   | Values                              |
|-----------|--------|-------------------------------------|
| `type`    | String | `debug`, `info`, `warn`, `error`    |

### assign (extended)

The `assign` tag handles all variable assignment including nested hashes and arrays.

```liquid
{% comment %} Empty literals {% endcomment %}
{% assign data = {} %}
{% assign items = [] %}

{% comment %} Bracket notation (set nested key) {% endcomment %}
{% assign data['status'] = 'active' %}
{% assign data['user']['id'] = profile.id %}

{% comment %} Dot notation {% endcomment %}
{% assign data.status = 'active' %}

{% comment %} Mixed notation {% endcomment %}
{% assign data.user['role'] = 'admin' %}

{% comment %} Array append {% endcomment %}
{% assign items << 'new item' %}
```

Works in `{% liquid %}` blocks too:

```liquid
{% liquid
  assign result = {}
  assign result['valid'] = true
  assign result['errors'] = []
%}
```

### content_for

Stores content for a named `{% yield %}` slot in the layout.

```liquid
{% content_for 'head' %}
  <link rel="stylesheet" href="{{ 'styles/products.css' | asset_url }}">
{% endcontent_for %}
```

## Context Object

The `context` object is globally available and provides request information.

### context.params

All URL and query parameters merged together:

```liquid
{{ context.params.id }}              {% comment %} From slug :id {% endcomment %}
{{ context.params.page }}            {% comment %} From ?page=2 {% endcomment %}
{{ context.params.authenticity_token }} {% comment %} CSRF token {% endcomment %}
```

For POST/PUT, form fields are also in `context.params`.

### context.location

Current request URL information:

```liquid
{{ context.location.pathname }}      {% comment %} /products/123 {% endcomment %}
{{ context.location.search }}        {% comment %} ?page=2 {% endcomment %}
{{ context.location.host }}          {% comment %} example.com {% endcomment %}
{{ context.location.href }}          {% comment %} Full URL {% endcomment %}
```

### context.page

Page metadata from front matter:

```liquid
{{ context.page.metadata.title }}
{{ context.page.slug }}
```

### context.current_user

Current authenticated user (if logged in):

```liquid
{{ context.current_user.id }}
{{ context.current_user.email }}
```

### context.authenticity_token

CSRF token for form submissions:

```liquid
{{ context.authenticity_token }}
```

### context.headers

Request HTTP headers:

```liquid
{{ context.headers.HTTP_ACCEPT }}
{{ context.headers.HTTP_USER_AGENT }}
```

### context.exports

Variables exported from partials via `{% export %}`:

```liquid
{{ context.exports.namespace.variable_name }}
```

## Useful Filters

| Filter              | Description                    | Example                              |
|---------------------|--------------------------------|--------------------------------------|
| `json`              | Converts to JSON string        | `{{ hash \| json }}`                 |
| `parse_json`        | Parses JSON string to object   | `{{ string \| parse_json }}`         |
| `t`                 | Translation lookup             | `{{ 'app.title' \| t }}`            |
| `asset_url`         | URL for asset file             | `{{ 'app.css' \| asset_url }}`      |
| `default`           | Fallback for nil/empty         | `{{ var \| default: "none" }}`       |
| `url_encode`        | URL-encodes a string           | `{{ query \| url_encode }}`          |

## See Also

- [Pages Overview](README.md) -- introduction and key concepts
- [Pages Configuration](configuration.md) -- front matter and file structure
- [Liquid Tags Reference](../liquid/tags/README.md) -- complete tag reference
- [Liquid Filters Reference](../liquid/filters/README.md) -- complete filter reference
- [GraphQL Reference](../graphql/README.md) -- query and mutation details
