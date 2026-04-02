# Routing Patterns

Common patterns and best practices for implementing routing in platformOS applications.

## RESTful Resource Routes

Follow REST conventions with standard CRUD operations on resources:

### Collection Routes

```
app/views/pages/articles.liquid (GET /articles)
app/views/pages/articles/new.liquid (GET /articles/new - show form)
app/views/pages/articles/create.liquid (POST /articles - handle form)
```

Front matter for POST:

```yaml
---
method: post
---
```

### Individual Resource Routes

```
app/views/pages/articles/:id.liquid (GET /articles/123)
app/views/pages/articles/:id/edit.liquid (GET /articles/123/edit)
app/views/pages/articles/:id/update.liquid (PUT /articles/123)
app/views/pages/articles/:id/delete.liquid (DELETE /articles/123)
```

### Complete RESTful Structure

```
app/views/pages/
├── articles.liquid
├── articles/
│   ├── new.liquid
│   ├── create.liquid
│   ├── :id.liquid
│   ├── :id/
│   │   ├── edit.liquid
│   │   ├── update.liquid
│   │   └── delete.liquid
```

## Nested Resource Routes

Resources that belong to other resources:

```
app/views/pages/
├── users/:user_id/
│   ├── posts.liquid (GET /users/123/posts)
│   ├── posts/:post_id.liquid (GET /users/123/posts/456)
│   └── posts/:post_id/comments/:comment_id.liquid (GET /users/123/posts/456/comments/789)
```

Access nested parameters:

```liquid
<!-- File: users/:user_id/posts/:post_id.liquid -->
User: {{ context.params.user_id }}
Post: {{ context.params.post_id }}
```

## API Endpoints (.json.liquid)

Build JSON APIs with content negotiation by file extension:

### Simple JSON Endpoint

```
app/views/pages/api/users/:id.json.liquid
```

Content (example):

```liquid
---
method: get
---
{
  "id": {{ context.params.id | json }},
  "name": "{{ user.name }}",
  "email": "{{ user.email }}",
  "created_at": "{{ user.created_at | to_iso8601 }}"
}
```

### List Endpoint with Pagination

```
app/views/pages/api/posts.json.liquid
```

Content:

```liquid
---
method: get
---
{
  "posts": [
    {% for post in posts %}
      {
        "id": {{ post.id | json }},
        "title": "{{ post.title }}",
        "slug": "{{ post.slug }}"
      }{% unless forloop.last %},{% endunless %}
    {% endfor %}
  ],
  "page": {{ context.params.page | default: 1 | json }},
  "total": {{ total_posts | json }}
}
```

### POST with JSON Request

```
app/views/pages/api/posts.json.liquid
```

Content:

```liquid
---
method: post
---
{% assign post_data = context.body | parse_json %}
{% assign new_post = post_data | create_post %}
{
  "success": true,
  "post": {
    "id": {{ new_post.id | json }},
    "title": "{{ new_post.title }}"
  }
}
```

## Catch-All Routes

Handle multiple paths with wildcard routes:

### Documentation/Static Files

```
app/views/pages/docs/*slug.liquid
```

Handles: `/docs/getting-started`, `/docs/api/authentication`, `/docs/faq/common-issues`

Access captured path:

```liquid
{{ context.params.slug }} → "getting-started" or "api/authentication"
```

Split and process:

```liquid
{% assign segments = context.params.slug | split: "/" %}
Category: {{ segments[0] }}
Topic: {{ segments[1] }}
```

### Deep Nested Resources

```
app/views/pages/files/*filepath.json.liquid
```

Handles: `/files/documents/2025/report.pdf`, `/files/media/images/logo.png`

## Conditional Redirects

Redirect based on conditions:

### Authentication Check

```liquid
---
method: get
---
{% if user.logged_in %}
  Dashboard content
{% else %}
  {% redirect_to "/login?next={{ context.location.pathname | url_encode }}" %}
{% endif %}
```

### Resource Not Found

```liquid
{% if article %}
  {{ article.content }}
{% else %}
  {% response_status 404 %}
  Article not found
{% endif %}
```

### Permanent Redirect

```liquid
---
method: get
---
{% redirect_to "/new-path" %}
```

With status code:

```liquid
{% response_status 301 %}
{% redirect_to "/new-path" %}
```

### Temporary Redirect with Message

```liquid
{% if valid_form %}
  {% assign form_processed = true %}
  {% redirect_to "/thank-you" %}
{% endif %}
```

## AJAX Detection and Response

Serve different content for AJAX requests:

### Detect AJAX Request

```liquid
{% if context.is_xhr %}
  <!-- Return JSON fragment -->
  {
    "html": "{{ rendered_partial | json }}",
    "status": "success"
  }
{% else %}
  <!-- Return full HTML page -->
  {% include "layouts/app" %}
{% endif %}
```

### AJAX Form Submission

```liquid
---
method: post
---
{% if form_valid %}
  {% if context.is_xhr %}
    {
      "success": true,
      "message": "Item saved successfully"
    }
  {% else %}
    {% redirect_to "/items/{{ item.id }}" %}
  {% endif %}
{% else %}
  {% if context.is_xhr %}
    {
      "success": false,
      "errors": {{ form_errors | json }}
    }
  {% else %}
    {% include "forms/item-form" with errors: form_errors %}
  {% endif %}
{% endif %}
```

## Multi-Format Endpoints

Serve multiple formats from similar routes:

### Method 1: Separate Files

```
app/views/pages/api/products/:id.json.liquid
app/views/pages/api/products/:id.csv.liquid
app/views/pages/api/products/:id.xml.liquid
```

### Method 2: Query Parameter Detection

```
app/views/pages/products/:id.liquid
```

Content:

```liquid
{% assign format = context.params.format | default: "html" %}

{% if format == "json" %}
  Content-Type: application/json
  { "product": "{{ product.name }}" }
{% elsif format == "csv" %}
  Content-Type: text/csv
  name,price,sku
  "{{ product.name }}",{{ product.price }},{{ product.sku }}
{% else %}
  <!-- HTML display -->
  <h1>{{ product.name }}</h1>
{% endif %}
```

Access: `/products/42?format=json` or `/products/42?format=csv`

## See Also

- [Configuration](./configuration.md) - Slug syntax, front matter, content types
- [API Reference](./api.md) - context.params, context.location, response tags
- [Advanced](./advanced.md) - Route priority, content negotiation, programmatic redirects
- [Troubleshooting](./gotchas.md) - Common errors and solutions
