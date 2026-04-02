# Forms: Patterns

Common form patterns and implementations for typical platformOS use cases.

## Basic CRUD Form

Complete example of a create/update form with proper structure:

```html
<!-- pages/products/form.liquid -->
<form method="POST" action="{% if product %}{{ product.url }}{% else %}/products{% endif %}">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  {% if product %}
    <input type="hidden" name="_method" value="PUT">
    <h1>Edit Product</h1>
  {% else %}
    <h1>New Product</h1>
  {% endif %}

  <div class="form-group">
    <label for="title">Title</label>
    <input type="text"
      id="title"
      name="product[title]"
      value="{{ product.title | default: context.params.product.title }}"
      required>
  </div>

  <div class="form-group">
    <label for="description">Description</label>
    <textarea id="description" name="product[description]">{{ product.description | default: context.params.product.description }}</textarea>
  </div>

  <div class="form-group">
    <label for="price">Price</label>
    <input type="number"
      id="price"
      name="product[price]"
      value="{{ product.price | default: context.params.product.price }}"
      step="0.01"
      required>
  </div>

  <button type="submit">{{ product | default: 'Create' }} Product</button>
  <a href="/products">Cancel</a>
</form>
```

## Form with Validation Error Display

Display validation errors returned from GraphQL mutations:

```html
<!-- pages/products/form.liquid -->
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product { id title errors }
      errors
    }
  }
{% endgraphql %}

<form method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  {% if graphql.product_create.errors %}
    <div class="alert alert-error">
      <h2>Please fix the following errors:</h2>
      <ul>
        {% for error in graphql.product_create.errors %}
          <li>{{ error.message }}</li>
        {% endfor %}
      </ul>
    </div>
  {% endif %}

  <div class="form-group">
    <label for="title">Title</label>
    <input type="text" id="title" name="product[title]" value="{{ context.params.product.title }}" required>
    {% if graphql.product_create.product.errors %}
      {% assign title_error = graphql.product_create.product.errors | where: "field", "title" | first %}
      {% if title_error %}
        <span class="field-error">{{ title_error.message }}</span>
      {% endif %}
    {% endif %}
  </div>

  <button type="submit">Create</button>
</form>
```

## File Upload Form

Complete form with file upload handling:

```html
<!-- Schema: name: product, fields: [{name: image, type: upload}] -->

<form method="POST" action="/products" enctype="multipart/form-data">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <div class="form-group">
    <label for="title">Product Title</label>
    <input type="text" id="title" name="product[title]" required>
  </div>

  <div class="form-group">
    <label>Product Image</label>
    {% include 'components/upload',
      name: 'product[image]',
      accept: 'image/jpeg,image/png,image/webp',
      max_size: 5242880,
      label: 'Upload image (max 5MB)'
    %}
  </div>

  <button type="submit">Create Product</button>
</form>
```

Access uploaded file in GraphQL mutation:

```liquid
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product {
        id
        title
        image { url }
      }
    }
  }
{% endgraphql %}
```

## AJAX Form with JSON Endpoint

Submit form via JavaScript to JSON endpoint:

```html
<!-- pages/products/form.liquid -->
<form id="product-form">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="text" name="product[title]" placeholder="Product title" required>
  <input type="number" name="product[price]" placeholder="Price" required>
  <button type="submit">Create</button>
</form>

<script>
document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const response = await fetch('/products/create.json', {
    method: 'POST',
    body: formData
  });
  const data = await response.json();
  if (data.success) {
    console.log('Product created:', data.product);
    e.target.reset();
  } else {
    console.error('Errors:', data.errors);
  }
});
</script>
```

JSON endpoint implementation:

```liquid
<!-- pages/products/create.json.liquid -->
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product { id title price }
      errors
    }
  }
{% endgraphql %}

{% if graphql.product_create.errors %}
  {
    "success": false,
    "errors": {{ graphql.product_create.errors | json }}
  }
{% else %}
  {
    "success": true,
    "product": {{ graphql.product_create.product | json }}
  }
{% endif %}
```

## Multi-Step Wizard with Sessions

Build a multi-step form using session storage:

```html
<!-- pages/checkout/step1.liquid - Email -->
<form method="POST" action="/checkout/step2">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="email" name="email" placeholder="Email" required value="{{ context.session.checkout_email }}">
  <button type="submit">Next</button>
</form>
```

```html
<!-- pages/checkout/step2.liquid - Address -->
<form method="POST" action="/checkout/step3">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="text" name="address" placeholder="Address" required value="{{ context.session.checkout_address }}">
  <button type="submit">Next</button>
</form>
```

```html
<!-- pages/checkout/step3.liquid - Payment -->
<form method="POST" action="/checkout/complete">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="text" name="card_token" placeholder="Card token" required>
  <button type="submit">Complete</button>
</form>
```

## Search Form with GET

Simple search form using GET method:

```html
<form method="GET" action="/products">
  <input type="text" name="q" placeholder="Search products" value="{{ context.params.q }}">
  <select name="category">
    <option value="">All categories</option>
    <option value="electronics" {% if context.params.category == 'electronics' %}selected{% endif %}>Electronics</option>
    <option value="clothing" {% if context.params.category == 'clothing' %}selected{% endif %}>Clothing</option>
  </select>
  <button type="submit">Search</button>
</form>

<!-- Display results -->
{% graphql %}
  query SearchProducts($q: String, $category: String) {
    products(query: $q, category: $category) {
      results { id title }
    }
  }
{% endgraphql %}

{% for product in graphql.products.results %}
  <div>{{ product.title }}</div>
{% endfor %}
```

## Contact Form with Spam Protection

Complete contact form with reCAPTCHA:

```html
<form method="POST" action="/contact">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <div class="form-group">
    <label for="name">Name</label>
    <input type="text" id="name" name="contact[name]" required>
  </div>

  <div class="form-group">
    <label for="email">Email</label>
    <input type="email" id="email" name="contact[email]" required>
  </div>

  <div class="form-group">
    <label for="message">Message</label>
    <textarea id="message" name="contact[message]" required></textarea>
  </div>

  {% spam_protection "recaptcha_v2" %}

  <button type="submit">Send Message</button>
</form>
```

## See Also

- [Forms: Configuration](configuration.md)
- [Forms: API Reference](api.md)
- [Forms: Gotchas](gotchas.md)
- [Forms: Advanced Techniques](advanced.md)
