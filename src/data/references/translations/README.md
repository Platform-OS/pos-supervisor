# Translations (i18n)

All user-facing text must use translations. NEVER hardcode text in partials.

## Location

`app/translations/`

## File Structure

```yaml
# app/translations/en.yml
en:
  app:
    products:
      title: "Products"
      created: "Product created successfully"
      deleted: "Product deleted"
      errors:
        not_found: "Product not found"
    navigation:
      home: "Home"
      products: "Products"
      login: "Sign In"
    errors:
      blank: "cannot be blank"
      unauthorized: "You are not authorized"
    flash:
      success: "Operation completed successfully"
```

## Usage in Templates

```liquid
{{ 'app.products.title' | t }}
{{ 'app.navigation.home' | t }}
```

## Interpolation

```yaml
en:
  app:
    greeting: "Hello %{username}!"
    items_count: "You have %{count} items"
```

```liquid
{{ 'app.greeting' | t: username: user.name }}
{{ 'app.items_count' | t: count: cart.size }}
```

## Fallbacks

```liquid
{{ 'app.missing_key' | t: default: 'Default text' }}
{{ 'app.key' | t: fallback: false }}
```

## Multiple Languages

```yaml
# app/translations/en.yml
en:
  app:
    hello: "Hello"

# app/translations/de.yml
de:
  app:
    hello: "Hallo"

# app/translations/es.yml
es:
  app:
    hello: "Hola"
```

Set language:
```liquid
{% context language: 'de' %}
{{ 'app.hello' | t }}   → "Hallo"
```

## Escaped Translations

Use `t_escape` when translation arguments may contain HTML:

```liquid
{{ 'app.greeting' | t_escape: username: user_input }}
```

## Rules

- NEVER hardcode user-facing text in partials
- Always use `{{ 'app.key' | t }}`
- Define all translations in `app/translations/`
- Use interpolation for dynamic values
- Use `t_escape` for user-supplied values in translations
