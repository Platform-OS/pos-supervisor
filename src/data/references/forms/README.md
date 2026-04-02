# Forms & CSRF

platformOS uses plain HTML `<form>` tags. Do NOT use the `{% form %}` Liquid tag.

## Basic Form

```html
<form method="post" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <label for="title">Title</label>
  <input type="text" id="title" name="product[title]" value="{{ product.title }}">

  <label for="price">Price</label>
  <input type="number" id="price" name="product[price]" step="0.01" value="{{ product.price }}">

  <button type="submit">Create Product</button>
</form>
```

## CSRF Protection

**All non-GET forms MUST include the CSRF token**, otherwise `context.current_user` will be `null`.

```html
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

## Field Naming Convention

Use bracket notation for structured data:

```html
<input name="product[title]" value="...">
<input name="product[price]" value="...">
<input name="product[tags][]" value="tag1">
<input name="product[tags][]" value="tag2">
```

Access in page: `context.params.product.title`, `context.params.product.price`

## PUT/DELETE Methods

HTML forms only support GET and POST. Use a hidden field for PUT/DELETE:

```html
<form method="post" action="/products/{{ product.id }}">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="hidden" name="_method" value="put">
  <!-- fields -->
</form>

<form method="post" action="/products/{{ product.id }}">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="hidden" name="_method" value="delete">
  <button type="submit">Delete</button>
</form>
```

## File Upload

Use the common-styling upload component:

```liquid
{% render 'modules/common-styling/forms/upload',
  id: 'image',
  presigned_upload: presigned,
  name: 'image',
  allowed_file_types: ['image/*'],
  max_number_of_files: 5
%}
```

For the schema, define an `upload` type property:

```yaml
# app/schema/product.yml
properties:
  - name: image
    type: upload
    options:
      acl: public
```

## Displaying Validation Errors

After a command returns with `valid: false`:

```liquid
{% if product.errors %}
  <div class="pos-alert pos-alert--error">
    {% for error in product.errors %}
      <p>{{ error[0] }}: {{ error[1] | join: ', ' }}</p>
    {% endfor %}
  </div>
{% endif %}
```

## AJAX Form Submission

Create a `.json.liquid` page endpoint:

```liquid
{% comment %} app/views/pages/api/products/create.json.liquid {% endcomment %}
---
slug: api/products
method: post
---
{% liquid
  function result = 'lib/commands/products/create',
    title: context.params.product.title,
    price: context.params.product.price

  assign response = result | json
  print response
%}
```

## Spam Protection

```liquid
{% spam_protection "recaptcha_v2" %}
{% spam_protection "recaptcha_v3", action: "signup" %}
{% spam_protection "hcaptcha" %}
```

Validate in page:
```liquid
{% assign valid = context.params | hcaptcha %}
{% assign valid = context.params | recaptchav3: 'signup' %}
```

## Rules

- Use HTML `<form>` tags, NOT `{% form %}`
- Always include CSRF token for non-GET requests
- Use bracket notation: `name="resource[field]"`
- Access form data via `context.params`
- Validate in commands (build → check → execute)
