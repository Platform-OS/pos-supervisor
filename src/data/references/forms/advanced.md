# Forms: Advanced Techniques

Advanced form patterns and techniques for complex platformOS applications.

## Multi-File Uploads

Handle multiple file uploads in a single form submission:

```html
<form method="POST" action="/products" enctype="multipart/form-data">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <input type="text" name="product[title]" required>

  <fieldset>
    <legend>Product Images</legend>
    {% include 'components/upload',
      name: 'product[images][0]',
      accept: 'image/*',
      label: 'Main image'
    %}

    {% include 'components/upload',
      name: 'product[images][1]',
      accept: 'image/*',
      label: 'Gallery image 1'
    %}

    {% include 'components/upload',
      name: 'product[images][2]',
      accept: 'image/*',
      label: 'Gallery image 2'
    %}
  </fieldset>

  <button type="submit">Create</button>
</form>
```

Access in GraphQL:

```liquid
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product {
        id
        images {
          url
        }
      }
    }
  }
{% endgraphql %}

{% for image in graphql.product_create.product.images %}
  <img src="{{ image.url }}" alt="Product image">
{% endfor %}
```

## Presigned Uploads

Use presigned URLs for direct cloud upload without server intermediary:

```liquid
<!-- Get presigned upload URL -->
{% graphql %}
  mutation GetUploadUrl {
    upload_create {
      upload {
        id
        url
        fields
      }
    }
  }
{% endgraphql %}

<!-- Store upload ID for later linking -->
{% assign upload_id = graphql.upload_create.upload.id %}
```

HTML form using presigned URL:

```html
<form id="upload-form" action="{{ graphql.upload_create.upload.url }}" method="POST" enctype="multipart/form-data">
  <!-- Presigned URL fields -->
  {% for field in graphql.upload_create.upload.fields %}
    <input type="hidden" name="{{ field[0] }}" value="{{ field[1] }}">
  {% endfor %}

  <!-- File input -->
  <input type="file" name="file" required>

  <!-- Store upload ID for linking -->
  <input type="hidden" name="upload_id" value="{{ upload_id }}">

  <button type="submit">Upload</button>
</form>

<script>
document.getElementById('upload-form').addEventListener('submit', function(e) {
  fetch(this.action, {
    method: 'POST',
    body: new FormData(this)
  }).then(response => {
    if (response.ok) {
      linkUpload();
    }
  });
});

async function linkUpload() {
  const response = await fetch('/products/link-upload.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: '{{ upload_id }}' })
  });
  const data = await response.json();
  console.log('Upload linked:', data);
}
</script>
```

## Dynamic Form Fields

Add/remove form fields dynamically using JavaScript:

```html
<form id="product-form" method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <input type="text" name="product[title]" required>

  <fieldset id="variants-container">
    <legend>Variants</legend>
    <div class="variant-group" data-index="0">
      <input type="text" name="product[variants][0][sku]" placeholder="SKU">
      <input type="number" name="product[variants][0][price]" placeholder="Price">
      <button type="button" class="remove-variant">Remove</button>
    </div>
  </fieldset>

  <button type="button" id="add-variant">Add Variant</button>
  <button type="submit">Create</button>
</form>

<script>
let variantIndex = 1;

document.getElementById('add-variant').addEventListener('click', () => {
  const container = document.getElementById('variants-container');
  const html = `
    <div class="variant-group" data-index="${variantIndex}">
      <input type="text" name="product[variants][${variantIndex}][sku]" placeholder="SKU">
      <input type="number" name="product[variants][${variantIndex}][price]" placeholder="Price">
      <button type="button" class="remove-variant">Remove</button>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', html);
  variantIndex++;
  attachRemoveHandlers();
});

function attachRemoveHandlers() {
  document.querySelectorAll('.remove-variant').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.target.closest('.variant-group').remove();
    });
  });
}

attachRemoveHandlers();
</script>
```

## Form-to-JSON API Pattern

Convert form submission to JSON API response for frontend consumption:

```html
<!-- Standard HTML form -->
<form id="product-form" method="POST" action="/products/create.json">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="text" name="product[title]" required>
  <input type="number" name="product[price]" required>
  <button type="submit">Create</button>
</form>

<script>
document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const response = await fetch(e.target.action, {
    method: e.target.method,
    body: new FormData(e.target)
  });

  const data = await response.json();

  if (data.success) {
    showSuccess('Product created successfully');
    e.target.reset();
    redirectTo(`/products/${data.product.id}`);
  } else {
    showErrors(data.errors);
  }
});
</script>
```

Endpoint implementation:

```liquid
<!-- pages/products/create.json.liquid -->
{% graphql %}
  mutation CreateProduct($product: ProductInput!) {
    product_create(product: $product) {
      product {
        id
        title
        price
        url
      }
      errors
    }
  }
{% endgraphql %}

{% if graphql.product_create.errors %}
  {
    "success": false,
    "errors": [
      {% for error in graphql.product_create.errors %}
        {
          "message": "{{ error.message }}",
          "code": "{{ error.code }}"
        }
        {% unless forloop.last %},{% endunless %}
      {% endfor %}
    ]
  }
{% else %}
  {
    "success": true,
    "product": {
      "id": "{{ graphql.product_create.product.id }}",
      "title": "{{ graphql.product_create.product.title }}",
      "price": {{ graphql.product_create.product.price }},
      "url": "{{ graphql.product_create.product.url }}"
    }
  }
{% endif %}
```

## Client-Side Validation Integration

Combine HTML5 validation with custom client-side rules:

```html
<form id="product-form" method="POST" action="/products" novalidate>
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <div class="form-group">
    <label for="title">Title</label>
    <input type="text" id="title" name="product[title]" required minlength="3" maxlength="100">
    <span class="field-error hidden"></span>
  </div>

  <div class="form-group">
    <label for="price">Price</label>
    <input type="number" id="price" name="product[price]" required min="0.01" step="0.01">
    <span class="field-error hidden"></span>
  </div>

  <button type="submit">Create</button>
</form>

<script>
const form = document.getElementById('product-form');

const customRules = {
  'product[title]': {
    validator: (value) => /^[a-z0-9\s\-\.]+$/i.test(value),
    message: 'Title contains invalid characters'
  },
  'product[price]': {
    validator: (value) => value >= 0.01,
    message: 'Price must be greater than 0'
  }
};

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const errors = [];

  for (const [fieldName, rules] of Object.entries(customRules)) {
    const field = form.querySelector(`[name="${fieldName}"]`);
    if (!rules.validator(field.value)) {
      errors.push({ field: fieldName, message: rules.message });
    }
  }

  if (errors.length === 0) {
    form.submit();
  } else {
    displayErrors(errors);
  }
});

function displayErrors(errors) {
  form.querySelectorAll('.field-error').forEach(el => el.classList.add('hidden'));
  errors.forEach(({ field, message }) => {
    const fieldEl = form.querySelector(`[name="${field}"]`);
    fieldEl.nextElementSibling.textContent = message;
    fieldEl.nextElementSibling.classList.remove('hidden');
  });
}
</script>
```

## Nested Resource Forms

Forms for nested resources with proper parameter structure:

```html
<!-- Create comment for post -->
<form method="POST" action="/posts/{{ post.id }}/comments">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <textarea name="comment[body]" placeholder="Your comment" required></textarea>
  <button type="submit">Post Comment</button>
</form>

<!-- Create variant for product -->
<form method="POST" action="/products/{{ product.id }}/variants">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <input type="text" name="variant[sku]" placeholder="SKU" required>
  <input type="text" name="variant[color]" placeholder="Color">
  <input type="number" name="variant[price]" placeholder="Price" required>

  <button type="submit">Add Variant</button>
</form>

<!-- Access nested parameters -->
{% assign comment_body = context.params.comment.body %}
{% assign variant_sku = context.params.variant.sku %}
```

GraphQL mutation for nested resource:

```liquid
{% graphql %}
  mutation CreateComment($postId: ID!, $comment: CommentInput!) {
    comment_create(post_id: $postId, comment: $comment) {
      comment {
        id
        body
        author { name }
      }
      errors
    }
  }
{% endgraphql %}
```

## Form State Persistence

Persist form state across page reloads using localStorage:

```html
<form id="product-form" method="POST" action="/products">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <input type="text" id="title" name="product[title]" placeholder="Title">
  <textarea id="description" name="product[description]" placeholder="Description"></textarea>
  <input type="number" id="price" name="product[price]" placeholder="Price">

  <button type="submit">Create</button>
</form>

<script>
const form = document.getElementById('product-form');
const storageKey = 'product-form-draft';

// Restore form data on load
window.addEventListener('load', () => {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const data = JSON.parse(saved);
    Object.entries(data).forEach(([key, value]) => {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = value;
    });
  }
});

// Save form data on change
form.addEventListener('input', () => {
  const data = new FormData(form);
  const obj = Object.fromEntries(data);
  localStorage.setItem(storageKey, JSON.stringify(obj));
});

// Clear saved data on successful submission
form.addEventListener('submit', (e) => {
  // After successful submit, clear
  setTimeout(() => localStorage.removeItem(storageKey), 1000);
});
</script>
```

## See Also

- [Forms: Configuration](configuration.md)
- [Forms: API Reference](api.md)
- [Forms: Patterns](patterns.md)
- [Forms: Gotchas](gotchas.md)
