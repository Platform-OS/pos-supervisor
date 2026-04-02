# Translations Configuration

## Overview

Translation files in platformOS are YAML files stored in `app/translations/` that define text strings for multiple languages. The `{{ 'key' | t }}` filter retrieves translated strings, with automatic fallback to default language. Translations support interpolation with `%{variable}` syntax in YAML and `| t: var: value` in Liquid. Multi-language support enables switching via `{% context language: 'de' %}`.

## Directory Structure

```
app/translations/
├── en.yml
├── de.yml
├── fr.yml
├── es.yml
└── ja.yml
```

Each YAML file contains translations for one language. File name is the language code.

## YAML Translation Files

### English Translation File (en.yml)

```yaml
# app/translations/en.yml
app:
  title: "My App"
  welcome: "Welcome, %{name}!"

navigation:
  home: "Home"
  about: "About"
  contact: "Contact Us"

messages:
  success: "Operation completed successfully"
  error: "An error occurred"

ecommerce:
  price: "Price"
  add_to_cart: "Add to Cart"
  cart_empty: "Your cart is empty"
```

### German Translation File (de.yml)

```yaml
# app/translations/de.yml
app:
  title: "Meine App"
  welcome: "Willkommen, %{name}!"

navigation:
  home: "Startseite"
  about: "Über Uns"
  contact: "Kontaktieren Sie Uns"

messages:
  success: "Operation erfolgreich abgeschlossen"
  error: "Ein Fehler ist aufgetreten"

ecommerce:
  price: "Preis"
  add_to_cart: "In den Warenkorb"
  cart_empty: "Ihr Warenkorb ist leer"
```

## Nested Keys

Organize translations hierarchically:

```yaml
store:
  products:
    title: "Our Products"
    filters:
      by_category: "Filter by Category"
      by_price: "Filter by Price"
    empty: "No products found"
```

Access with dot notation: `{{ 'store.products.title' | t }}`

## Interpolation in YAML

Use `%{variable}` placeholders in translation strings:

```yaml
# app/translations/en.yml
greeting: "Hello, %{user_name}!"
order_confirmation: "Order #%{order_id} for %{user_name} totaling %{amount}"
```

## Configuration in .pos

### Translation Settings

```yaml
translations:
  enabled: true
  default_language: 'en'
  fallback_language: 'en'
  supported_languages:
    - en
    - de
    - fr
    - es
```

### Language Paths

Store translations by environment:

```yaml
translations:
  paths:
    - 'app/translations/'
    - 'vendor/module/translations/'
```

## Language Detection

### Default Language

Uses default_language from configuration:

```liquid
{{ 'app.title' | t }}
<!-- Uses 'en' if default_language: 'en' -->
```

### Context Language Override

Set language in template:

```liquid
{% context language: 'de' %}
{{ 'app.title' | t }}
<!-- Renders German translation -->

{% context language: 'en' %}
{{ 'app.title' | t }}
<!-- Back to English -->
```

## Fallback Behavior

If translation key not found:

1. Check specified language
2. Fall back to default language
3. Return key name as string

```liquid
{{ 'missing.key' | t: default: 'Fallback Text' }}
<!-- Shows "Fallback Text" if key doesn't exist -->
```

## Pluralization

Handle singular/plural forms:

```yaml
# app/translations/en.yml
items:
  one: "1 item in cart"
  other: "%{count} items in cart"
```

## Security: Text Escaping

### t_escape Filter

Escape HTML in user-provided translations:

```liquid
<!-- User input in translation -->
{{ 'user.message' | t_escape: user_input: context.params.message }}
<!-- Prevents XSS from user-provided text -->
```

### Safe by Default

Translation values are HTML-escaped automatically:

```yaml
# Safe: special characters escaped
message: "Price: $99 & Free Shipping"
```

## Supported Languages

Default support for ISO 639-1 language codes:

- `en`: English
- `de`: German
- `fr`: French
- `es`: Spanish
- `it`: Italian
- `ja`: Japanese
- `zh`: Chinese
- `pt`: Portuguese
- `ru`: Russian

Add custom language codes in configuration.

## See Also

- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
