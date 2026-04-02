# Translations Gotchas

## Never Hardcode User-Facing Text

### Strings Not Translatable After Hardcoding

```liquid
<!-- WRONG: Hardcoded text -->
<h1>Welcome to Our Store</h1>
<button>Add to Cart</button>

<!-- RIGHT: Use translation filter -->
<h1>{{ 'page.title' | t }}</h1>
<button>{{ 'buttons.add_to_cart' | t }}</button>
```

Hardcoded text can't be translated. Always use translation keys.

## Missing Translation Keys

### Silent Failures When Keys Don't Exist

```liquid
<!-- If key doesn't exist in YAML -->
{{ 'missing.key' | t }}
<!-- Returns: missing.key (the key itself) -->

<!-- RIGHT: Provide default -->
{{ 'missing.key' | t: default: 'Fallback Text' }}
<!-- Returns: Fallback Text if key missing -->
```

Use `pos-cli check <env>` to validate translation files and find missing keys.

## Interpolation Variable Mismatch

### Variables Don't Match Between Template and YAML

```yaml
# app/translations/en.yml
greeting: "Hello, %{user_name}!"  # Expects 'user_name'
```

```liquid
<!-- WRONG: Variable name mismatch -->
{{ 'greeting' | t: name: context.current_user.name }}
<!-- %{user_name} not interpolated, shows literal string -->

<!-- RIGHT: Match variable names -->
{{ 'greeting' | t: user_name: context.current_user.name }}
<!-- Properly interpolates -->
```

Variable names in YAML must match template parameters exactly.

## Context Language Not Persisting

### Language Resets Between Page Loads

```liquid
<!-- Set language -->
{% context language: 'de' %}

<!-- Navigate to another page -->
<a href="/products">{{ 'nav.products' | t }}</a>

<!-- New page defaults to default_language again -->
<!-- Language not preserved across navigation -->
```

**Solution:** Store language in session via the session module, or embed it in the URL:

```liquid
<!-- Save language preference in session -->
{% if context.params.lang %}
  {% function _ = 'modules/core/commands/session/set', key: 'lang', value: context.params.lang %}
{% endif %}

<!-- Read saved language on each page -->
{% function saved_lang = 'modules/core/commands/session/get', key: 'lang' %}
{% assign current_lang = saved_lang | default: 'en' %}
{% context language: current_lang %}
```

Or use language-prefixed URLs (`/de/products`) and extract the code from `context.location.pathname`.

## Missing YAML Syntax

### Malformed Translation Files Break Rendering

```yaml
# WRONG: Missing quotes on special characters
greeting: Welcome, %{name}!  # % needs quotes
prices: Price: $99           # $ might need quotes

# RIGHT: Properly quoted
greeting: "Welcome, %{name}!"
prices: "Price: $99"
```

Use quotes for strings with special characters.

## Translation File Encoding Issues

### Non-ASCII Characters Corrupted

```yaml
# WRONG: File saved in wrong encoding
Café: "Kaffee Shop"  # café character corrupted

# RIGHT: Save as UTF-8
Café: "Kaffee Shop"
```

Always save translation files as UTF-8 encoding.

## Pluralization Not Working

### Plural Rules Not Matching

```yaml
# WRONG: Wrong key structure
items:
  "1": "One item"
  "other": "%{count} items"

# RIGHT: Use 'one' and 'other'
items:
  one: "One item"
  other: "%{count} items"
```

platformOS uses specific plural key names: `one`, `other`.

## Language Code Case Sensitivity

### Language Code Mismatch Causes Fallback

```liquid
<!-- WRONG: Language code case mismatch -->
{% context language: 'EN' %}  <!-- File is en.yml -->
{{ 'key' | t }}  <!-- Falls back to default, not English -->

<!-- RIGHT: Use lowercase language codes -->
{% context language: 'en' %}
```

Language codes must match exactly (lowercase convention).

## Escaping Not Applied in All Cases

### XSS Vulnerability from Translation Interpolation

```liquid
<!-- WRONG: User input not escaped -->
{{ 'message' | t: user_text: context.params.user_input }}
<!-- User can inject HTML/JS -->

<!-- RIGHT: Use t_escape filter -->
{{ 'message' | t_escape: user_text: context.params.user_input }}
<!-- HTML properly escaped -->
```

Always use `t_escape` when interpolating user-provided data.

## Translation File Deployment Timing

### Changes Not Deployed with Code

Translation files must be deployed same time as code:

```bash
# Include translation files in deployment
pos-cli deploy staging
# Includes app/translations/ files
```

If translation files missing after deploy, keys show as fallback text.

## Missing Fallback Configuration

### No Default Translation Available

```liquid
<!-- If default_language not configured -->
{{ 'key' | t }}
<!-- System doesn't know which language to fall back to -->
```

Always set `default_language` in `.pos` configuration.

## Database Translations Not Syncing

### Storing Translations in Database

```yaml
# WRONG: Dynamic translations from database
greeting: "{{ user.custom_greeting }}"  # YAML can't reference variables

# RIGHT: Fetch dynamic content separately
# greeting: "Welcome!"
# Then in template:
{{ 'greeting' | t: suffix: context.current_user.custom_title }}
```

YAML files are static. Don't try to make them dynamic.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
