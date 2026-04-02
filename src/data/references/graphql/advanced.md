# GraphQL Advanced Topics

Optimization techniques, advanced query patterns, edge cases, and performance considerations.

## Avoiding N+1 Queries

The most important optimization in platformOS GraphQL. Instead of querying related data in a Liquid loop:

**Bad (N+1 problem):**

```liquid
{% graphql orders = 'orders/list' %}
{% for order in orders.records.results %}
  {% graphql customer = 'users/find', id: order.user_id %}
  {{ customer.users.results.first.email }}
{% endfor %}
```

**Good (single query with related_record):**

```graphql
query orders($page: Int = 1) {
  records(page: $page, per_page: 20, filter: { table: { value: "order" } }) {
    results {
      id
      total: property_float(name: "total")
      customer: related_record(table: "user", join_on_property: "user_id") {
        email
      }
    }
  }
}
```

This resolves all relationships in a single database operation.

## Deep Nesting Strategy

You can nest `related_record` and `related_records` up to approximately 5 levels. Plan your query shape carefully:

```graphql
results {
  id                                                          # Level 0
  items: related_records(                                     # Level 1
    table: "order_item", join_on_property: "id", foreign_property: "order_id"
  ) {
    product: related_record(table: "product", join_on_property: "product_id") {  # Level 2
      title: property(name: "title")
      category: related_record(table: "category", join_on_property: "category_id") {  # Level 3
        name: property(name: "name")
      }
    }
  }
}
```

**Recommendation:** If you need data beyond 3 levels deep, consider denormalization or restructuring your schema.

## Bulk Operations with Pagination Loops

For operations spanning all records (exports, mass updates), paginate through the entire dataset:

```liquid
{% liquid
  assign current_page = 1
  assign has_more = true
%}
{% liquid
  while has_more
    graphql batch = 'products/search', page: current_page, limit: 100
    for product in batch.records.results
      comment Process each record endcomment
      graphql _ = 'products/update', id: product.id, status: "archived"
    endfor
    assign current_page = current_page | plus: 1
    assign has_more = batch.records.has_next_page
  endwhile
%}
```

**Caution:** This pattern works for moderate datasets (hundreds to low thousands). For truly large datasets (tens of thousands+), use the Data Import/Export API instead.

## Dynamic Filtering with args

Build filters dynamically in Liquid and pass them as a single hash:

```liquid
{% assign search_args = { "page": context.params.page | default: 1, "limit": 20 } %}

{% if context.params.status %}
  {% assign search_args = search_args | add_hash_key: "status", context.params.status %}
{% endif %}

{% graphql result = 'products/search', args: search_args %}
```

In the GraphQL file, declare all possible variables with defaults:

```graphql
query search($page: Int = 1, $limit: Int = 20, $status: String) {
  records(
    page: $page
    per_page: $limit
    filter: {
      table: { value: "product" }
      properties: [
        { name: "status", value: $status }
      ]
    }
  ) {
    results { id }
  }
}
```

When `$status` is `null`, the property filter is effectively skipped.

## Null Variable Behavior in Filters

Understanding how null variables affect filters is critical:

| Scenario | Behavior |
|----------|----------|
| `{ name: "status", value: $status }` where `$status` is null | Filter is **ignored** (matches all) |
| `{ name: "status", value: "" }` (empty string) | Matches records where status is empty string |
| `{ name: "status", value: "null" }` (string "null") | Matches records where status is literally "null" |

This means optional filters work naturally -- just do not pass the variable and the filter drops out.

## Optimizing per_page for Different Use Cases

| Use Case | Recommended per_page | Rationale |
|----------|---------------------|-----------|
| User-facing list pages | 10-25 | Good UX, fast response |
| Admin dashboards | 25-50 | More data density needed |
| API-style data fetch | 50-100 | Batch efficiency |
| Background processing | 100-200 | Throughput over latency |
| Existence check | 1 | Only need to know if any match |

```graphql
# Existence check pattern
query exists($email: String!) {
  records(
    per_page: 1
    filter: {
      table: { value: "user_profile" }
      properties: [{ name: "email", value: $email }]
    }
  ) {
    total_entries
  }
}
```

## Multiple Mutations in One File

You can execute multiple mutations in a single GraphQL operation:

```graphql
mutation transfer($from_id: ID!, $to_id: ID!, $from_balance: String!, $to_balance: String!) {
  debit: record_update(
    id: $from_id
    record: { properties: [{ name: "balance", value: $from_balance }] }
  ) {
    id
  }
  credit: record_update(
    id: $to_id
    record: { properties: [{ name: "balance", value: $to_balance }] }
  ) {
    id
  }
}
```

**Important:** These are **not** atomic transactions. If the second mutation fails, the first is not rolled back. For critical operations, implement compensation logic.

## Sorting by Multiple Fields

```graphql
sort: [
  { properties: [{ name: "featured", order: DESC }] }
  { properties: [{ name: "title", order: ASC }] }
  { properties: [{ name: "created_at", order: DESC }] }
]
```

Records are sorted by the first field; ties are broken by subsequent fields.

## Querying Across Tables

While each query typically targets one table, you can omit the `table` filter to search across all tables:

```graphql
query global_search($term: String) {
  records(
    per_page: 20
    filter: {
      properties: [{ name: "title", value: $term }]
    }
  ) {
    results {
      id
      table
      title: property(name: "title")
    }
  }
}
```

**Use with caution:** Cross-table queries can be slow and return mixed results. The `table` field on results tells you which schema each record belongs to.

## Caching Strategies

platformOS does not have built-in GraphQL response caching, but you can use Liquid-level caching:

```liquid
{% cache 'products_homepage', expire: 300 %}
  {% graphql products = 'products/search', limit: 6, status: "featured" %}
  {% for product in products.records.results %}
    {{ product.title }}
  {% endfor %}
{% endcache %}
```

The `expire` value is in seconds. Use caching for:
- Homepage content blocks
- Navigation menus built from data
- Infrequently changing reference data

Do **not** cache user-specific or frequently changing content.

## Error Handling in Liquid

GraphQL errors do not raise Liquid exceptions. Always check for results:

```liquid
{% graphql result = 'products/find', id: context.params.id %}
{% assign product = result.records.results.first %}

{% if product == blank %}
  {% comment %} Handle not found {% endcomment %}
  {% render 'errors/404' %}
{% else %}
  <h1>{{ product.title }}</h1>
{% endif %}
```

For mutations, check the returned `id`:

```liquid
{% graphql created = 'products/create', title: "New Product" %}
{% if created.record_create.id %}
  {% comment %} Success {% endcomment %}
{% else %}
  {% comment %} Creation failed {% endcomment %}
{% endif %}
```

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- file structure and invocation syntax
- [api.md](api.md) -- complete API reference
- [patterns.md](patterns.md) -- common workflows
- [gotchas.md](gotchas.md) -- common errors and limits
- [../schema/advanced.md](../schema/advanced.md) -- advanced schema design for query optimization
- [../migrations/advanced.md](../migrations/advanced.md) -- advanced migration techniques
