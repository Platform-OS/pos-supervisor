# Forms: Gotchas

Common mistakes, errors, and edge cases when working with platformOS forms.

## Missing CSRF Token

**Problem:** Form submission succeeds but `context.current_user` is always `null`.

**Cause:** State-changing forms (POST, PUT, DELETE) require an authenticity token. Without it, the user context is not populated.

**Solution:** Always include the authenticity token in forms:

```html
<form method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <!-- rest of form -->
</form>
```

Test:
```liquid
{% if context.current_user %}
  User authenticated: {{ context.current_user.email }}
{% else %}
  Token missing or invalid
{% endif %}
```

## Using {% form %} Instead of HTML

**Problem:** Form tag is not recognized, form doesn't submit or behaves unexpectedly.

**Cause:** platformOS does not provide a `{% form %}` tag. Forms must use standard HTML `<form>` tags.

**Incorrect:**
```liquid
{% form method="POST" action="/products" %}
  <input type="text" name="product[title]">
{% endform %}
```

**Correct:**
```html
<form method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="text" name="product[title]">
</form>
```

## Wrong Field Naming Convention

**Problem:** Form values accessible as `context.params.product_title` instead of expected nested structure.

**Cause:** Not using bracket notation for nested parameters. Using underscore or dot notation instead.

**Solution:** Use bracket notation for nested field names:

```html
<!-- Wrong: underscore-separated -->
<input type="text" name="product_title">
<!-- Access: context.params.product_title -->

<!-- Correct: bracket notation -->
<input type="text" name="product[title]">
<!-- Access: context.params.product.title -->
```

Complex nesting:

```html
<input name="user[profile][first_name]">
<input name="tags[0]">
<input name="tags[1]">

<!-- Access -->
{{ context.params.user.profile.first_name }}
{{ context.params.tags[0] }}
{{ context.params.tags[1] }}
```

## File Upload Not Working

**Problem:** File upload field doesn't accept files or uploaded file is not accessible.

**Cause:** Missing `enctype="multipart/form-data"` or schema doesn't define upload field type.

**Solution:**

1. Add form encoding:
```html
<form method="POST" action="/products" enctype="multipart/form-data">
  <!-- required for file uploads -->
</form>
```

2. Define schema with upload type:
```yaml
name: product
properties:
  - name: image
    type: upload
```

3. Use upload component:
```liquid
{% render 'components/upload',
  name: 'product[image]',
  accept: 'image/*'
%}
```

## Missing _method Field for PUT/DELETE

**Problem:** Form submission with `method="PUT"` or `method="DELETE"` doesn't work; form acts like POST.

**Cause:** HTML forms only support GET and POST. PUT/DELETE require hidden `_method` field.

**Incorrect:**
```html
<form method="PUT" action="/products/123">
  <!-- HTML doesn't support PUT -->
</form>
```

**Correct:**
```html
<form method="POST" action="/products/123">
  <input type="hidden" name="_method" value="PUT">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <!-- rest of form -->
</form>
```

## Form Parameters Ignored in GraphQL

**Problem:** Form parameters not passed to GraphQL mutation; mutation receives null values.

**Cause:** Not mapping `context.params` to GraphQL variables correctly.

**Solution:**

```liquid
{% graphql result = 'products/create', product: context.params.product %}
```

The GraphQL mutation is defined in a separate file at `app/graphql/products/create.graphql`:

```graphql
mutation CreateProduct($product: ProductInput!) {
  product_create(product: $product) {
    product { id title }
    errors
  }
}
```

Or explicitly map parameters:

```liquid
{% assign product = context.params.product | default: {} %}
{% assign title = product.title %}
{% assign price = product.price %}
```

## Validation Errors Not Displayed

**Problem:** Form submits but validation errors from GraphQL mutation don't appear in form.

**Cause:** Not capturing mutation response or conditional logic for error display is missing.

**Solution:** Capture mutation result and display errors:

```liquid
{% graphql result = 'products/create', product: context.params.product %}

{% if result.product_create.errors %}
  <div class="alert-error">
    {% for error in result.product_create.errors %}
      <p>{{ error.message }}</p>
    {% endfor %}
  </div>
{% endif %}
```

## AJAX Form Not Sending CSRF Token

**Problem:** AJAX form submission fails with authentication error.

**Cause:** CSRF token not included in AJAX request headers or body.

**Solution:**

Include token in request:

```javascript
const formData = new FormData(form);
const response = await fetch('/products/create.json', {
  method: 'POST',
  body: formData,
  headers: {
    'X-Requested-With': 'XMLHttpRequest'
  }
});
```

Or include in form data:

```html
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

## Spam Protection Not Validating

**Problem:** Spam protection tag renders but doesn't validate submissions.

**Cause:** Missing provider configuration in module manifest or secret key not set correctly.

**Solution:**

1. Configure in module manifest:
```yaml
module_config:
  spam_protection:
    provider: recaptcha_v2
    site_key: YOUR_SITE_KEY
    secret_key: YOUR_SECRET_KEY
```

2. Verify environment variables:
```bash
RECAPTCHA_SITE_KEY=xxxxx
RECAPTCHA_SECRET_KEY=xxxxx
```

## Form Limits and Constraints

| Aspect | Limit | Notes |
|--------|-------|-------|
| Max form size | 10 MB | Total multipart request size |
| Max file size | 5 MB | Individual file upload (configurable) |
| Max param depth | 10 levels | Nested bracket notation |
| Max array size | 1000 items | Array parameters |
| Field name length | 256 chars | HTML input name attribute |
| Parameter name length | 256 chars | Single parameter name |

## Troubleshooting Flowchart

```
Form submission fails
├─ No response or timeout
│  ├─ Check form action URL
│  └─ Check server logs
├─ User is null
│  ├─ Add authenticity_token
│  └─ Verify token value is not empty
├─ 404 Not Found
│  ├─ Verify page/endpoint exists
│  └─ Check routing configuration
├─ Validation errors
│  ├─ Check GraphQL mutation response
│  └─ Display errors in template
└─ File upload fails
   ├─ Add enctype="multipart/form-data"
   ├─ Verify schema has upload type
   └─ Check file size limits
```

## See Also

- [Forms: Configuration](configuration.md)
- [Forms: API Reference](api.md)
- [Forms: Patterns](patterns.md)
- [Forms: Advanced Techniques](advanced.md)
