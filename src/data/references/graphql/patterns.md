# GraphQL Patterns

Common workflows, CRUD operations, search patterns, relationship queries, and best practices.

## Standard CRUD Pattern

Organize GraphQL files by resource in subdirectories:

```
app/graphql/products/
├── search.graphql      # list with filters
├── find.graphql        # single record by ID
├── create.graphql      # insert
├── update.graphql      # modify
└── delete.graphql      # remove
```

### List with filters

```graphql
# app/graphql/products/search.graphql
query search($page: Int = 1, $limit: Int = 20, $title: String, $status: String) {
  records(
    page: $page
    per_page: $limit
    filter: {
      table: { value: "product" }
      properties: [
        { name: "title", value: $title }
        { name: "status", value: $status }
      ]
    }
    sort: [{ created_at: { order: DESC } }]
  ) {
    total_entries
    total_pages
    has_previous_page
    has_next_page
    results {
      id
      created_at
      title: property(name: "title")
      price: property_float(name: "price")
      status: property(name: "status")
    }
  }
}
```

### Find by ID

```graphql
# app/graphql/products/find.graphql
query find($id: ID!) {
  records(
    per_page: 1
    filter: {
      id: { value: $id }
      table: { value: "product" }
    }
  ) {
    results {
      id
      created_at
      updated_at
      title: property(name: "title")
      description: property(name: "description")
      price: property_float(name: "price")
      image: property_upload(name: "image") { url }
    }
  }
}
```

### Create

```graphql
# app/graphql/products/create.graphql
mutation create($title: String!, $description: String, $price: String, $status: String = "draft") {
  record_create(
    record: {
      table: "product"
      properties: [
        { name: "title", value: $title }
        { name: "description", value: $description }
        { name: "price", value: $price }
        { name: "status", value: $status }
      ]
    }
  ) {
    id
    title: property(name: "title")
  }
}
```

### Update

```graphql
# app/graphql/products/update.graphql
mutation update($id: ID!, $title: String, $description: String, $price: String, $status: String) {
  record_update(
    id: $id
    record: {
      properties: [
        { name: "title", value: $title }
        { name: "description", value: $description }
        { name: "price", value: $price }
        { name: "status", value: $status }
      ]
    }
  ) {
    id
  }
}
```

### Delete

```graphql
# app/graphql/products/delete.graphql
mutation delete($id: ID!) {
  record_delete(id: $id) {
    id
  }
}
```

## Invocation from Pages

Pages are controllers — fetch data with `{% graphql %}`, then delegate rendering to partials.
Never put HTML directly in a page file.

```liquid
{# List page — controller only: #}
{% assign page_num = context.params.page | default: 1 | plus: 0 %}
{% graphql products = 'products/search', page: page_num, status: "published" %}
{% render 'products/index', products: products.records.results, pagination: products.records %}
```

```liquid
{# Detail page — controller only: #}
{% graphql result = 'products/find', id: context.params.id %}
{% assign product = result.records.results.first %}
{% if product %}
  {% render 'products/show', product: product %}
{% else %}
  {% render 'errors/not_found' %}
{% endif %}
```

## Pagination Pattern

```liquid
{% graphql result = 'products/search', page: context.params.page %}
{% assign records = result.records %}

{% for product in records.results %}
  {{ product.title }}
{% endfor %}

<nav>
  {% if records.has_previous_page %}
    <a href="?page={{ context.params.page | minus: 1 }}">Previous</a>
  {% endif %}

  Page {{ context.params.page | default: 1 }} of {{ records.total_pages }}

  {% if records.has_next_page %}
    <a href="?page={{ context.params.page | default: 1 | plus: 1 }}">Next</a>
  {% endif %}
</nav>
```

## Relationship Query Patterns

### Order with items and product details (nested relationships)

```graphql
query order($id: ID!) {
  records(per_page: 1, filter: { id: { value: $id }, table: { value: "order" } }) {
    results {
      id
      status: property(name: "status")
      total: property_float(name: "total")
      customer: related_record(table: "user", join_on_property: "user_id") {
        email
      }
      items: related_records(
        table: "order_item"
        join_on_property: "id"
        foreign_property: "order_id"
      ) {
        quantity: property_int(name: "quantity")
        unit_price: property_float(name: "unit_price")
        product: related_record(table: "product", join_on_property: "product_id") {
          title: property(name: "title")
          image: property_upload(name: "image") { url }
        }
      }
    }
  }
}
```

### User with profile and recent orders

```graphql
query user_dashboard($user_id: ID!) {
  users(per_page: 1, filter: { id: { value: $user_id } }) {
    results {
      id
      email
      profile: related_records(table: "user_profile", join_on_property: "id", foreign_property: "user_id") {
        first_name: property(name: "first_name")
        avatar: property_upload(name: "avatar") { url }
      }
      orders: related_records(table: "order", join_on_property: "id", foreign_property: "user_id") {
        id
        status: property(name: "status")
        total: property_float(name: "total")
        created_at
      }
    }
  }
}
```

## Date Range Filtering

```graphql
query recent_orders($after: String!, $before: String) {
  records(
    per_page: 50
    filter: {
      table: { value: "order" }
      created_at: { gte: $after, lte: $before }
    }
    sort: [{ created_at: { order: DESC } }]
  ) {
    total_entries
    results {
      id
      total: property_float(name: "total")
      created_at
    }
  }
}
```

```liquid
{% graphql orders = 'orders/recent', after: "2024-01-01", before: "2024-01-31" %}
```

## Constants Pattern

```graphql
# app/graphql/constants/set.graphql
mutation set($name: String!, $value: String!) {
  constant_set(name: $name, value: $value) {
    name
    value
  }
}
```

```graphql
# app/graphql/constants/unset.graphql
mutation unset($name: String!) {
  constant_unset(name: $name) {
    name
  }
}
```

```liquid
{% comment %} Setting a constant {% endcomment %}
{% graphql _ = 'constants/set', name: "SITE_NAME", value: "My Store" %}

{% comment %} Reading (via context, not GraphQL) {% endcomment %}
{{ context.constants.SITE_NAME }}
```

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- file structure and invocation syntax
- [api.md](api.md) -- complete API reference
- [gotchas.md](gotchas.md) -- common errors and limits
- [advanced.md](advanced.md) -- optimization and advanced techniques
- [../schema/patterns.md](../schema/patterns.md) -- schema design patterns that pair with these queries
