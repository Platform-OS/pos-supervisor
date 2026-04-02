# Forms: API Reference

Complete reference for form-related Liquid APIs, context variables, and filters available in platformOS.

## Context Variables

### context.params

Access form submission parameters using dot notation or bracket access:

```liquid
{{ context.params.email }}
{{ context.params.product.title }}
{{ context.params.product.variant[0].size }}
{{ context.params['product']['color'] }}
```

Parameter structure matches form field names. Bracket notation in HTML (`name="product[title]"`) creates nested structure in `context.params`.

```html
<!-- Form with nested parameters -->
<input type="text" name="product[title]">
<input type="text" name="product[price]">
<input type="text" name="tags[0]">
<input type="text" name="tags[1]">

<!-- Liquid access -->
Product: {{ context.params.product.title }} - ${{ context.params.product.price }}
Tag 1: {{ context.params.tags[0] }}
Tag 2: {{ context.params.tags[1] }}
```

### context.authenticity_token

The CSRF protection token. Include in all state-changing forms:

```html
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

**Note:** Without this token, `context.current_user` is `null` and form submissions will fail authentication.

### context.current_user

Contains authenticated user information. Only populated if:
1. A valid authenticity token is present in the form submission
2. User session exists
3. Form method is not GET

```liquid
{% if context.current_user %}
  Welcome, {{ context.current_user.email }}
{% else %}
  Please log in
{% endif %}
```

## Tags

### spam_protection

Protect forms from spam using reCAPTCHA or hCaptcha:

```liquid
{% spam_protection "recaptcha_v2" %}
{% spam_protection "recaptcha_v3" %}
{% spam_protection "hcaptcha" %}
```

The tag automatically:
- Injects spam provider JavaScript
- Validates tokens on form submission
- Adds validation error messages

Place anywhere in your form. Validation occurs server-side during form processing.

```html
<form method="POST" action="/contact">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="email" name="email" required>
  <textarea name="message" required></textarea>

  {% spam_protection "recaptcha_v2" %}

  <button type="submit">Send</button>
</form>
```

Configuration in module manifest:

```yaml
module_config:
  spam_protection:
    provider: recaptcha_v2
    site_key: YOUR_SITE_KEY
    secret_key: YOUR_SECRET_KEY
```

## Filters

### spam_protection Filter

Check if spam validation passes:

```liquid
{% if context.params | spam_protection: "recaptcha_v2" %}
  Form is not spam
{% else %}
  Form failed spam check
{% endif %}
```

### hcaptcha Filter

Verify hCaptcha tokens:

```liquid
{% assign token = context.params.h_captcha_response %}
{% if token | hcaptcha: site_key: "KEY", secret_key: "SECRET" %}
  Valid hCaptcha response
{% endif %}
```

### recaptcha_v3 Filter

Verify reCAPTCHA v3 tokens with score threshold:

```liquid
{% assign token = context.params.g_recaptcha_response %}
{% assign is_valid = token | recaptcha_v3: site_key: "KEY", secret_key: "SECRET", threshold: 0.5 %}
{% if is_valid %}
  reCAPTCHA verified with sufficient score
{% endif %}
```

## Related Liquid Tags

### include

Reuse form components:

```liquid
{% include 'components/upload',
  name: 'product[image]',
  accept: 'image/*'
%}

{% include 'components/form-errors',
  object: product,
  field: 'title'
%}
```

### if/unless

Conditional form rendering based on user or params:

```liquid
{% if context.current_user %}
  <!-- Show form only to authenticated users -->
  <form>...</form>
{% endif %}

{% unless context.params.id %}
  <!-- Create form (no ID parameter) -->
{% else %}
  <!-- Update form (has ID parameter) -->
{% endunless %}
```

### assign/capture

Store form-related values:

```liquid
{% assign product_title = context.params.product.title %}
{% capture full_name %}
  {{ context.params.first_name }} {{ context.params.last_name }}
{% endcapture %}
```

### for

Iterate form arrays:

```liquid
{% for tag in context.params.tags %}
  Tag: {{ tag }}
{% endfor %}
```

## Command Tags (Validation)

Execute validation during form processing:

```liquid
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product { id title }
      errors
    }
  }
{% endgraphql %}
```

Use in check stage for form validation:

```yaml
check_queries:
  - name: validate_product
    query: check/validate_product.graphql
    result: validation_result
```

## Form-Related Endpoints

### JSON Endpoints

Create AJAX-compatible endpoints with `.json.liquid` extension:

```
/products/create.json.liquid
/products/123/update.json.liquid
/products/123/delete.json.liquid
```

Example implementation:

```liquid
{% comment %}products/create.json.liquid{% endcomment %}
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product { id title }
      errors
    }
  }
{% endgraphql %}

{% if graphql.errors %}
  {
    "success": false,
    "errors": {{ graphql.errors | json }}
  }
{% else %}
  {
    "success": true,
    "product": {{ graphql.product_create.product | json }}
  }
{% endif %}
```

### Form Action Endpoints

Standard form endpoints handle POST, PUT, DELETE:

```
POST /products -> Create
PUT /products/:id -> Update (via _method field)
DELETE /products/:id -> Delete (via _method field)
GET /products -> List/search
```

## See Also

- [Forms: Configuration](configuration.md)
- [Forms: Patterns](patterns.md)
- [Forms: Gotchas](gotchas.md)
- [Forms: Advanced Techniques](advanced.md)
