# Forms Configuration

platformOS forms use standard HTML `<form>` tags with several key configuration requirements to ensure security, proper parameter handling, and feature support.

## Basic Form Structure

All forms must use HTML `<form>` elements rather than platformOS-specific tags. This provides full control and compatibility with standard web patterns.

```html
<form method="POST" action="/products">
  <!-- form fields here -->
</form>
```

## CSRF Token

CSRF protection is mandatory for all state-changing forms (POST, PUT, DELETE). Include the authenticity token as a hidden input field:

```html
<form method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="text" name="product[title]" placeholder="Product title">
  <button type="submit">Create</button>
</form>
```

**Important:** Without the authenticity token, `context.current_user` will be `null` during form processing, causing authentication to fail.

## Field Naming Conventions

Use bracket notation for field names to create nested parameter structures. This maps directly to `context.params` access:

```html
<!-- Bracket notation in HTML -->
<input type="text" name="product[title]">
<input type="text" name="product[description]">
<input type="number" name="product[price]">

<!-- Access in Liquid -->
{{ context.params.product.title }}
{{ context.params.product.description }}
{{ context.params.product.price }}
```

Complex nesting is supported:

```html
<input type="text" name="product[variant][0][sku]">
<input type="text" name="product[variant][0][size]">

<!-- Access -->
{{ context.params.product.variant[0].sku }}
{{ context.params.product.variant[0].size }}
```

## HTTP Method Override

HTML forms only support GET and POST natively. To send PUT or DELETE requests, use a hidden `_method` field:

```html
<!-- PUT request -->
<form method="POST" action="/products/{{ product.id }}">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="hidden" name="_method" value="PUT">
  <input type="text" name="product[title]" value="{{ product.title }}">
  <button type="submit">Update</button>
</form>

<!-- DELETE request -->
<form method="POST" action="/products/{{ product.id }}">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="hidden" name="_method" value="DELETE">
  <button type="submit">Delete</button>
</form>
```

## File Upload Setup

File uploads require two components: a schema definition with `upload` type and the upload component in your form.

### Schema Configuration

Define an upload field in your module's schema:

```yaml
name: product
fields:
  - name: title
    type: string
  - name: image
    type: upload
```

### Form Component

Use the common-styling upload component:

```html
<form method="POST" action="/products" enctype="multipart/form-data">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <input type="text" name="product[title]" placeholder="Product title">

  {% include 'components/upload',
    name: 'product[image]',
    accept: 'image/*',
    max_size: 5242880
  %}

  <button type="submit">Upload</button>
</form>
```

**Important:** Set `enctype="multipart/form-data"` on the form element for file uploads.

## Spam Protection

Enable spam protection using the `spam_protection` tag. Supported providers: `recaptcha_v2`, `recaptcha_v3`, and `hcaptcha`.

```html
<form method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <input type="text" name="product[title]" placeholder="Product title">

  {% spam_protection "recaptcha_v2" %}

  <button type="submit">Create</button>
</form>
```

Configuration is set in your module's manifest or environment variables. The tag automatically handles token validation during form submission.

## Form Attributes

Common form attributes and their usage:

| Attribute | Value | Purpose |
|-----------|-------|---------|
| `method` | POST (default), GET | HTTP method for submission |
| `action` | URL path | Form submission endpoint |
| `enctype` | `multipart/form-data` | Required for file uploads |
| `novalidate` | Boolean flag | Disable browser validation |
| `autocomplete` | on/off | Enable/disable autocomplete |
| `target` | `_blank` | Open in new window |

## Form Methods

Override HTTP method for state-changing operations:

```html
<!-- Implicit POST (default) -->
<form action="/products">
  <!-- becomes POST /products -->
</form>

<!-- Explicit GET (for searches/filters) -->
<form method="GET" action="/products">
  <!-- becomes GET /products?q=value -->
</form>

<!-- PUT override -->
<form method="POST" action="/products/123">
  <input type="hidden" name="_method" value="PUT">
</form>

<!-- DELETE override -->
<form method="POST" action="/products/123">
  <input type="hidden" name="_method" value="DELETE">
</form>
```

## See Also

- [Forms: API Reference](api.md)
- [Forms: Patterns](patterns.md)
- [Forms: Gotchas](gotchas.md)
- [Forms: Advanced Techniques](advanced.md)
