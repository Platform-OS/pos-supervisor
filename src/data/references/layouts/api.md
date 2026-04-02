# Layouts -- API Reference

This document covers the Liquid tags, filters, and context objects available inside layout files.

## Liquid Tags in Layouts

### content_for_layout

Outputs the rendered content from the current page. This is the primary insertion point.

```liquid
{{ content_for_layout }}
```

This is a special variable, not a tag. It contains the complete output of the page's Liquid execution. Every layout must include it exactly once.

### yield

Renders content stored by pages or partials via `{% content_for %}`.

```liquid
{% yield 'slot_name' %}
```

| Parameter | Type   | Description                                  |
|-----------|--------|----------------------------------------------|
| Name      | String | The slot name matching a `content_for` block |

```liquid
{% yield 'head' %}
{% yield 'footer_scripts' %}
{% yield 'sidebar' %}
```

If no `{% content_for %}` block matches the name, `{% yield %}` outputs nothing.

### content_for

Stores content into a named slot for `{% yield %}` to render. Typically called from pages or partials, but can also be used in layouts.

```liquid
{% content_for 'head' %}
  <link rel="stylesheet" href="{{ 'custom.css' | asset_url }}">
{% endcontent_for %}
```

Multiple `{% content_for %}` blocks with the same name append content (they do not overwrite).

### render

Renders a partial template. Used in layouts for shared components.

```liquid
{% render 'shared/navigation' %}
{% render 'shared/footer' %}
{% render 'modules/common-styling/init' %}
{% render 'modules/common-styling/toasts', params: flash %}
```

| Parameter     | Type   | Description                                   |
|---------------|--------|-----------------------------------------------|
| Partial path  | String | Path relative to `app/views/partials/`        |
| Named args    | Any    | Variables passed to the partial               |

### function

Calls a partial and captures its return value. Used in layouts for data retrieval (e.g., flash messages).

```liquid
{% function flash = 'modules/core/commands/session/get', key: 'sflash' %}
{% function _ = 'modules/core/commands/session/clear', key: 'sflash' %}
```

### include

Shares the parent scope with the included partial. Used sparingly in layouts.

```liquid
{% include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.access' %}
```

### liquid

Block form for writing multiple Liquid statements without repeating `{% %}` delimiters. Common in layouts for flash message logic.

```liquid
{% liquid
  function flash = 'modules/core/commands/session/get', key: 'sflash'
  if context.location.pathname != flash.from or flash.force_clear
    function _ = 'modules/core/commands/session/clear', key: 'sflash'
  endif
  render 'modules/common-styling/toasts', params: flash
%}
```

**Important:** Do not line-wrap statements inside `{% liquid %}` blocks. Each statement must be on its own line.

### log

Writes to instance logs. Useful for debugging layout rendering.

```liquid
{% log context.page.metadata, type: 'debug' %}
```

## Context Object in Layouts

The full `context` object is available in layouts.

### context.page

Information about the current page being rendered:

```liquid
{{ context.page.metadata.title }}        {% comment %} From front matter {% endcomment %}
{{ context.page.metadata.description }}  {% comment %} From front matter {% endcomment %}
{{ context.page.slug }}                  {% comment %} Current page slug {% endcomment %}
```

### context.location

Current request URL:

```liquid
{{ context.location.pathname }}    {% comment %} /products/123 {% endcomment %}
{{ context.location.host }}        {% comment %} example.com {% endcomment %}
{{ context.location.href }}        {% comment %} Full URL {% endcomment %}
```

### context.current_user

The authenticated user (if any):

```liquid
{% if context.current_user %}
  {% render 'shared/user_nav', user: context.current_user %}
{% else %}
  {% render 'shared/guest_nav' %}
{% endif %}
```

### context.exports

Variables exported from partials via `{% export %}`:

```liquid
{{ context.exports.namespace.variable }}
```

### context.authenticity_token

CSRF token for forms rendered in the layout:

```liquid
{{ context.authenticity_token }}
```

### context.headers

HTTP request headers:

```liquid
{{ context.headers.HTTP_ACCEPT }}
```

## Useful Filters in Layouts

| Filter       | Description                        | Example                                    |
|--------------|------------------------------------|--------------------------------------------|
| `asset_url`  | Returns URL for an asset file      | `{{ 'app.css' \| asset_url }}`             |
| `default`    | Fallback for nil/empty values      | `{{ title \| default: "My App" }}`         |
| `t`          | Translation lookup                 | `{{ 'nav.home' \| t }}`                    |
| `json`       | Converts value to JSON             | `{{ data \| json }}`                       |
| `escape`     | HTML-escapes a string              | `{{ user_input \| escape }}`               |

## Special Variables

| Variable              | Type    | Description                                |
|-----------------------|---------|--------------------------------------------|
| `content_for_layout`  | String  | Rendered page output                       |
| `context`             | Object  | Request context (params, user, location)   |

## See Also

- [Layouts Overview](README.md) -- introduction and key concepts
- [Layouts Configuration](configuration.md) -- file structure and setup
- [Liquid Tags Reference](../liquid/tags/README.md) -- complete tag reference
- [Liquid Filters Reference](../liquid/filters/README.md) -- complete filter reference
- [Liquid Objects Reference](../liquid/objects/README.md) -- context object details
