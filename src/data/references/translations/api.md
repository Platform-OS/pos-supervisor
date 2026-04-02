# Translations API Reference

## t Filter

Retrieve translated string for current language.

**Syntax:**
```liquid
{{ 'key' | t }}
{{ 'key' | t: var1: value1 }}
{{ 'key' | t: var1: value1, var2: value2 }}
{{ 'key' | t: default: 'Fallback' }}
```

**Examples:**

```liquid
<!-- Simple translation -->
<h1>{{ 'app.title' | t }}</h1>

<!-- With interpolation -->
<p>{{ 'app.welcome' | t: name: context.current_user.name }}</p>

<!-- Multiple interpolations -->
<p>{{ 'order_info' | t: order_id: order.id, customer: order.customer_name }}</p>

<!-- With default -->
<button>{{ 'buttons.submit' | t: default: 'Submit' }}</button>
```

## t_escape Filter

Translate and HTML-escape for safe rendering.

**Syntax:**
```liquid
{{ 'key' | t_escape: var: value }}
```

**Example:**

```liquid
<!-- Escape user-provided interpolations -->
<p>{{ 'user.message' | t_escape: comment: context.params.user_comment }}</p>
```

Prevents XSS from user input interpolated into translations.

## context language

Switch language context.

**Syntax:**
```liquid
{% context language: 'de' %}
  <!-- Content rendered in German -->
{% endcontext %}
```

**Example:**

```liquid
<section>
  <h1>{{ 'greeting' | t }}</h1>

  {% context language: 'de' %}
    <h1>{{ 'greeting' | t }}</h1>
  {% endcontext %}

  {% context language: 'fr' %}
    <h1>{{ 'greeting' | t }}</h1>
  {% endcontext %}
</section>
```

## Current Language

`context.language` holds the active language code for the current request:

```liquid
Current Language: {{ context.language }}
```

Set it within a page or partial using `{% context language: 'de' %}`.

## Pluralization Helpers

Handle plural forms programmatically:

```liquid
{% assign count = items | size %}
{{ 'item_count' | t: count: count }}
```

YAML file contains singular/plural variants:

```yaml
item_count:
  one: "1 item"
  other: "%{count} items"
```

## Fallback Keys

Provide fallback translations:

```liquid
{{ 'very.nested.key.that.might.not.exist' | t: default: 'Backup Text' }}
```

Returns "Backup Text" if key doesn't exist in any language.

## See Also

- [Configuration Guide](./configuration.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
