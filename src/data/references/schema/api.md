# Schema API Reference

GraphQL operations and Liquid tags for working with schema-defined records.

## Creating Records

### record_create

```graphql
mutation create($title: String!, $price: String, $available: String) {
  record_create(
    record: {
      table: "product"
      properties: [
        { name: "title", value: $title }
        { name: "price", value: $price }
        { name: "available", value: $available }
      ]
    }
  ) {
    id
    created_at
    title: property(name: "title")
  }
}
```

**Signature:** `record_create(record: RecordInput!) : Record`

`RecordInput` fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `table` | String | Yes | Must match a schema `name` |
| `properties` | [PropertyInput] | No | Array of `{ name, value }` pairs |

All property values are passed as `String` in GraphQL variables -- the platform coerces them based on the schema type definition.

## Updating Records

### record_update

```graphql
mutation update($id: ID!, $title: String, $price: String) {
  record_update(
    id: $id
    record: {
      properties: [
        { name: "title", value: $title }
        { name: "price", value: $price }
      ]
    }
  ) {
    id
    updated_at
  }
}
```

**Signature:** `record_update(id: ID!, record: RecordInput!) : Record`

Only properties included in the `properties` array are modified. Omitted properties remain unchanged.

## Deleting Records

### record_delete

```graphql
mutation delete($id: ID!) {
  record_delete(id: $id) {
    id
  }
}
```

**Signature:** `record_delete(id: ID!) : Record`

Deletion is permanent. There is no soft-delete built in. Deleting a parent does **not** cascade to related records.

## Querying Records

### records

```graphql
query list($page: Int = 1, $limit: Int = 20) {
  records(
    page: $page
    per_page: $limit
    filter: {
      table: { value: "product" }
      properties: [
        { name: "available", value: "true" }
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
      updated_at
      table
      title: property(name: "title")
      price: property_float(name: "price")
      available: property_boolean(name: "available")
      tags: property_array(name: "tags")
      image: property_upload(name: "image") { url }
    }
  }
}
```

**Signature:** `records(filter: RecordFilter, page: Int, per_page: Int, sort: [RecordSort]) : RecordCollection`

### Filter Options

| Filter | Type | Description |
|--------|------|-------------|
| `table` | `{ value: String }` | Filter by schema table name |
| `id` | `{ value: ID }` | Filter by record ID |
| `ids` | `{ value: [ID] }` | Filter by multiple IDs |
| `properties` | `[{ name, value }]` | Filter by property values |
| `created_at` | `{ lte, gte, lt, gt }` | Date range filter on creation |
| `updated_at` | `{ lte, gte, lt, gt }` | Date range filter on update |

### Sort Options

```graphql
sort: [
  { created_at: { order: DESC } }
  { properties: { name: "title", order: ASC } }
]
```

Order values: `ASC`, `DESC`.

### Pagination Fields

| Field | Type | Description |
|-------|------|-------------|
| `total_entries` | Int | Total matching records |
| `total_pages` | Int | Total pages at current `per_page` |
| `has_previous_page` | Boolean | True if current page > 1 |
| `has_next_page` | Boolean | True if more pages exist |
| `results` | [Record] | Array of records for current page |

## Property Accessors

Use these on `results` items to read typed values:

| Accessor | Return Type | Example |
|----------|-------------|---------|
| `property(name: "field")` | String | `title: property(name: "title")` |
| `property_int(name: "field")` | Int | `count: property_int(name: "count")` |
| `property_float(name: "field")` | Float | `price: property_float(name: "price")` |
| `property_boolean(name: "field")` | Boolean | `active: property_boolean(name: "active")` |
| `property_array(name: "field")` | [String] | `tags: property_array(name: "tags")` |
| `property_upload(name: "field")` | Upload | `image: property_upload(name: "image") { url }` |
| `property_object(name: "field")` | JSON | `meta: property_object(name: "metadata")` |

## Related Record Accessors

### related_record (belongs-to)

```graphql
author: related_record(table: "user", join_on_property: "author_id") {
  id
  email
  name: property(name: "name")
}
```

### related_records (has-many)

```graphql
items: related_records(
  table: "order_item"
  join_on_property: "id"
  foreign_property: "order_id"
) {
  id
  quantity: property_int(name: "quantity")
}
```

## Invoking from Liquid

### Named query file

```liquid
{% graphql result = 'products/search', page: 1, limit: 10 %}
{{ result.records.total_entries }} products found.
```

### Inline query

```liquid
{% graphql result %}
  query {
    records(per_page: 5, filter: { table: { value: "product" } }) {
      results { id, title: property(name: "title") }
    }
  }
{% endgraphql %}
```

### Passing arguments as hash

```liquid
{% assign args = { "table": "product", "limit": 10 } %}
{% graphql result = 'products/search', args: args %}
```

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- YAML schema format and property types
- [patterns.md](patterns.md) -- common query and mutation patterns
- [gotchas.md](gotchas.md) -- common errors
- [../graphql/api.md](../graphql/api.md) -- full GraphQL API reference
