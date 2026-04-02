# Liquid Objects: API Reference

Complete API reference for all platformOS Liquid global objects.

## context Object API

### context.params
```liquid
{{ context.params.page_id }}
{{ context.params.search_query | default: '' }}
{{ context.params.sort_by | default: 'name' }}
```
Contains all URL parameters, form fields, and query strings unified.

### context.session
```liquid
{{ context.session.user_id }}
{{ context.session.cart_items }}
{{ context.session.last_visited_product }}
```
Persistent session hash. Set values via GraphQL mutations.

### context.location
```liquid
{{ context.location.pathname }}
{{ context.location.search }}
{{ context.location.host }}
{{ context.location.href }}
{{ context.location.origin }}
{{ context.location.protocol }}
{{ context.location.port }}
```
Request URL components. Read-only during template rendering.

### context.environment
```liquid
{{ context.environment.name }}
{{ context.environment.is_staging }}
{{ context.environment.is_production }}
{{ context.environment.url }}
{{ context.environment.api_url }}
```
Deployment environment information.

### context.is_xhr
```liquid
{%- if context.is_xhr -%}
  {%- comment %} AJAX request {%- endcomment %}
{%- endif -%}
```
Boolean flag for XMLHttpRequest (AJAX) detection.

### context.authenticity_token
```liquid
<form method="post" action="/api/action">
  <input type="hidden" name="authenticity_token"
         value="{{ context.authenticity_token }}">
</form>
```
CSRF protection token. Always include in POST forms.

### context.constants
```liquid
{%- comment %} Hidden constants, never output directly {%- endcomment %}
{{ context.constants.api_key }}
{{ context.constants.encryption_key }}
```
Secret configuration. Hidden from HTML output.

### context.headers
```liquid
{{ context.headers['User-Agent'] }}
{{ context.headers['X-Custom-Header'] }}
{{ context.headers['Accept-Language'] }}
```
HTTP request headers (case-insensitive keys).

### context.cookies
```liquid
{{ context.cookies.session_id }}
{{ context.cookies.user_preferences }}
```
HTTP cookie values.

### context.device
```liquid
{{ context.device.type }}
{{ context.device.brand }}
{{ context.device.name }}
{{ context.device.os }}
{{ context.device.os_version }}
{{ context.device.browser }}
{{ context.device.browser_version }}
{{ context.device.is_mobile }}
{{ context.device.is_tablet }}
{{ context.device.is_desktop }}
```
Device and browser detection information.

### context.page
```liquid
{{ context.page.id }}
{{ context.page.slug }}
{{ context.page.layout }}
{{ context.page.title }}
{{ context.page.metadata }}
{{ context.page.url }}
```
Current page metadata.

### context.language
```liquid
{{ context.language }}
{{ context.language.code }}
{{ context.language.name }}
{{ context.language.native_name }}
{{ context.language.direction }}
```
User language preference.

### context.flash
```liquid
{{ context.flash.notice }}
{{ context.flash.alert }}
{{ context.flash.error }}
```
One-time flash messages (cleared after display).

### context.modules
```liquid
{{ context.modules.my_module }}
{{ context.modules.api_connector.version }}
```
Loaded module metadata.

### context.visitor
```liquid
{{ context.visitor.ip }}
{{ context.visitor.country }}
{{ context.visitor.city }}
{{ context.visitor.timezone }}
{{ context.visitor.latitude }}
{{ context.visitor.longitude }}
```
GeoIP and visitor information (from IP).

### context.exports
```liquid
{{ context.exports.user.name }}
{{ context.exports.products }}
{{ context.exports.metadata }}
```
Data exported from GraphQL queries and partials.

## forloop Object API

### Basic Properties
```liquid
{%- for item in items -%}
  Index: {{ forloop.index }}          {%- comment %} 1-based {%- endcomment %}
  Index0: {{ forloop.index0 }}        {%- comment %} 0-based {%- endcomment %}
  Reverse Index: {{ forloop.rindex }}  {%- comment %} From end, 1-based {%- endcomment %}
  Reverse Index0: {{ forloop.rindex0 }} {%- comment %} From end, 0-based {%- endcomment %}
{%- endfor -%}
```

### Boolean Flags
```liquid
{%- for item in items -%}
  {%- if forloop.first -%}FIRST{%- endif -%}
  {%- if forloop.last -%}LAST{%- endif -%}
{%- endfor -%}
```

### Length Information
```liquid
{%- for item in items -%}
  {{ forloop.index }} of {{ forloop.length }}
{%- endfor -%}
```

### Parent Loop Access
```liquid
{%- for category in categories -%}
  {%- for product in category.products -%}
    Category {{ forloop.parentloop.index }}, Product {{ forloop.index }}
  {%- endfor -%}
{%- endfor -%}
```

## tablerowloop Object API

### Column Information
```liquid
{%- tablerow product in products cols:3 -%}
  Column: {{ tablerowloop.col }}      {%- comment %} 1-based column {%- endcomment %}
  Column0: {{ tablerowloop.col0 }}    {%- comment %} 0-based column {%- endcomment %}
  First in Row: {{ tablerowloop.col_first }}
  Last in Row: {{ tablerowloop.col_last }}
{%- endtablerow -%}
```

### Combined forloop Properties
```liquid
{%- tablerow product in products cols:3 -%}
  Item {{ tablerowloop.index }} in row {{ tablerowloop.col }}
  {%- if tablerowloop.first %}<tr>{%- endif %}
  <td>{{ product.name }}</td>
  {%- if tablerowloop.last %}</tr>{%- endif %}
{%- endtablerow -%}
```

## Special Notes

### context.current_user
The built-in object for the currently logged-in user. Always guard against nil (user not logged in):
```liquid
{%- if context.current_user -%}
  {{ context.current_user.email }}
  {{ context.current_user.first_name }}
{%- else -%}
  {%- comment %} No user logged in {%- endcomment %}
{%- endif -%}
```

### Nil and Empty Checks
```liquid
{%- if context.params.id -%}
  {%- comment %} Param exists {%- endcomment %}
{%- endif -%}

{%- if context.session.cart_items -%}
  {%- comment %} Session value exists {%- endcomment %}
{%- endif -%}
```

### Type Information
```liquid
{{ context.params | json }}
{{ context.device | json }}
{{ context.location | json }}
```

## See Also

- [Objects Configuration](configuration.md)
- [Objects & Patterns](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
