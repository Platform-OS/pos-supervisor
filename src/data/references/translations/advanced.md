# Translations Advanced Techniques

## Namespace Translation Organization

Organize translations by feature/module to prevent key collisions:

```yaml
# app/translations/en.yml
users:
  profile:
    title: "User Profile"
    edit_button: "Edit Profile"
  settings:
    title: "User Settings"
    save_button: "Save Settings"

products:
  listing:
    title: "Products"
    filters: "Filters"
  detail:
    title: "Product Details"
    add_to_cart: "Add to Cart"
```

Access with dot notation: `{{ 'products.listing.title' | t }}`

## Custom Translation Fallback Partial

Create a helper partial for debugging missing translations:

```liquid
{% comment %} app/lib/helpers/t_debug.liquid {% endcomment %}
{% capture translation %}{{ key | t: default: default }}{% endcapture %}

{% if translation == key %}
  {% comment %} Key not found — show visible placeholder {% endcomment %}
  [MISSING: {{ key }}]
{% else %}
  {{ translation }}
{% endif %}
```

```liquid
{% comment %} Use in templates during development {% endcomment %}
{% function title = 'lib/helpers/t_debug', key: 'page.title', default: 'Untitled' %}
{{ title }}
```

## Contextual Plural Forms

Handle complex pluralization rules:

```yaml
# English (two forms)
items:
  one: "1 item"
  other: "%{count} items"

# Russian (three forms)
books:
  one: "1 книга"
  few: "%{count} книги"
  many: "%{count} книг"
```

```liquid
{% assign count = items | size %}
{{ 'items' | t: count: count }}
```

platformOS automatically selects the correct plural form based on the language and count.

## Rich Text Translation with Markdown

Include formatted text in translations:

```yaml
# app/translations/en.yml
messages:
  important: "**Warning:** This action cannot be undone."
  instructions: "1. Click button\n2. Confirm\n3. Done"
```

```liquid
{{ 'messages.important' | t | markdownify }}
{{ 'messages.instructions' | t | markdownify }}
```

## Fallback Language Chain

Implement fallback language hierarchy for regional variants:

```liquid
{% assign current_translation = 'key' | t %}
{% assign language_chain = context.language | split: '-' %}

{% comment %} For 'pt-BR', try 'pt-BR' then 'pt' then default {% endcomment %}
{% if current_translation == 'key' and language_chain.size > 1 %}
  {% context language: language_chain.first %}
  {% assign current_translation = 'key' | t %}
{% endif %}

{{ current_translation }}
```

## Language Persistence via Session

Store the user's language preference across requests:

```liquid
{% comment %} Page that handles language switching {% endcomment %}
{% if context.params.lang %}
  {% function _ = 'modules/core/commands/session/set', key: 'lang', value: context.params.lang, from: context.location.pathname %}
  {% redirect_to context.location.pathname %}
{% endif %}
```

```liquid
{% comment %} Shared before-action partial or layout {% endcomment %}
{% function lang_session = 'modules/core/commands/session/get', key: 'lang' %}
{% assign active_lang = lang_session | default: 'en' %}
{% context language: active_lang %}
```

## Caching Translated Partials

Cache expensive partials that render translated content:

```liquid
{% assign cache_key = 'nav-' | append: context.language %}
{% cache cache_key, expire: 3600 %}
  {% render 'shared/navigation' %}
{% endcache %}
```

Do **not** cache pages that contain user-specific translated content (e.g., `{{ 'greeting' | t: name: context.current_user.name }}`).

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Gotchas & Issues](./gotchas.md)
