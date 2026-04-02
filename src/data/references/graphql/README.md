# GraphQL (Queries & Mutations)

All data access in platformOS goes through GraphQL. The schema is strict and closed -- you cannot create custom types. GraphQL files live in `app/graphql/` and are invoked from pages using the `{% graphql %}` Liquid tag.

## Key Purpose

GraphQL is the **exclusive** data access layer in platformOS. There is no direct SQL, no ORM, no REST API for data. Every read, write, update, and delete flows through GraphQL operations. The platform provides a fixed set of root types (`records`, `record_create`, `record_update`, `record_delete`, `users`, etc.) and property accessors to read typed values from records.

## When to Use

- **Querying data** -- list, filter, sort, and paginate records from any schema-defined table.
- **Creating records** -- insert new data via `record_create` mutation.
- **Updating records** -- modify existing records via `record_update` mutation.
- **Deleting records** -- remove records via `record_delete` mutation.
- **Resolving relationships** -- traverse one-to-many and many-to-many relationships using `related_record` and `related_records`.
- **Managing users** -- create, update, query, and delete users via `user_create`, `user_update`, `users`, `user_delete`.
- **Setting constants** -- store key-value configuration with `constant_set` / `constant_unset`.

## How It Works

1. Create a `.graphql` file in `app/graphql/` (supports subdirectories for organization).
2. Write a single GraphQL operation (query or mutation) with typed variables.
3. Invoke from a **page** using `{% graphql result = 'path/name', arg1: val1 %}`.
4. Access results in Liquid: `{{ result.records.results }}`, `{{ result.record_create.id }}`, etc.

```graphql
# app/graphql/products/search.graphql
query search($page: Int = 1, $limit: Int = 20, $title: String) {
  records(
    page: $page
    per_page: $limit
    filter: {
      table: { value: "product" }
      properties: [{ name: "title", value: $title }]
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
    }
  }
}
```

```liquid
{% comment %} In a page file {% endcomment %}
{% graphql products = 'products/search', page: context.params.page, title: context.params.q %}

{% for product in products.records.results %}
  {{ product.title }} - ${{ product.price }}
{% endfor %}
```

## Getting Started

1. **Create the directory:**
   ```bash
   mkdir -p app/graphql
   ```

2. **Write your first query** in `app/graphql/items/list.graphql`:
   ```graphql
   query list {
     records(per_page: 10, filter: { table: { value: "item" } }) {
       results {
         id
         name: property(name: "name")
       }
     }
   }
   ```

3. **Invoke from a page:**
   ```liquid
   {% graphql result = 'items/list' %}
   Found {{ result.records.total_entries }} items.
   ```

4. **Deploy:** `pos-cli deploy dev`

## See Also

- [configuration.md](configuration.md) -- file structure, naming, variable types, and invocation syntax
- [api.md](api.md) -- complete reference for root types, property accessors, filters, sorts, and pagination
- [patterns.md](patterns.md) -- common workflows including CRUD, search, pagination, and relationships
- [gotchas.md](gotchas.md) -- common errors, limits, and troubleshooting
- [advanced.md](advanced.md) -- optimization, edge cases, and advanced techniques
- [../schema/README.md](../schema/README.md) -- defining the data models GraphQL operates on
- [../migrations/README.md](../migrations/README.md) -- seeding data using GraphQL in migrations
