# Schema (Database Table Definitions)

Schema files define your data models in platformOS. Each YAML file in `app/schema/` becomes a database table backed by PostgreSQL and ElasticSearch, accessible exclusively through GraphQL.

## Key Purpose

Schema files are the **only** way to define persistent data structures in platformOS. They replace traditional database migrations for table creation. Each schema file declares a table name and its properties (columns), and the platform handles all underlying database provisioning.

You never write SQL. You never interact with PostgreSQL or ElasticSearch directly. Schema files are the single source of truth for your data model.

## When to Use

- **Defining a new data entity** -- any time your application needs to store structured data (products, orders, blog posts, user profiles, comments).
- **Adding properties to an existing table** -- add a new entry to the `properties` array and redeploy.
- **Accepting file uploads** -- use the `upload` property type with options for access control and file restrictions.
- **Establishing relationships** -- create `_id` properties by convention (e.g., `user_id`, `order_id`) and resolve them through GraphQL `related_record` / `related_records`.

## How It Works

1. Create a YAML file in `app/schema/` (e.g., `app/schema/product.yml`).
2. Declare a `name` that **must** match the filename (without `.yml`).
3. List `properties` with `name` and `type` for each field.
4. Deploy with `pos-cli deploy` -- the platform provisions the table automatically.
5. Access data via GraphQL mutations (`record_create`, `record_update`, `record_delete`) and queries (`records`).

```yaml
# app/schema/product.yml
name: product
properties:
  - name: title
    type: string
  - name: description
    type: text
  - name: price
    type: float
  - name: quantity
    type: integer
  - name: available
    type: boolean
  - name: published_at
    type: datetime
  - name: tags
    type: array
  - name: image
    type: upload
    options:
      acl: public
      max_size: 5242880
      content_type:
        - image/jpeg
        - image/png
```

Every record automatically receives four built-in fields: `id`, `created_at`, `updated_at`, and `table`.

## Getting Started

1. **Create your first schema file:**
   ```bash
   mkdir -p app/schema
   ```
   Then create `app/schema/article.yml` with a `name` and `properties` array.

2. **Deploy to your instance:**
   ```bash
   pos-cli deploy dev
   ```

3. **Verify by querying:**
   ```liquid
   {% graphql articles %}
     query {
       records(per_page: 5, filter: { table: { value: "article" } }) {
         total_entries
         results { id }
       }
     }
   {% endgraphql %}
   ```

4. See [configuration.md](configuration.md) for the full YAML specification and all property type details.

## See Also

- [configuration.md](configuration.md) -- full YAML format, property types, upload options, and file structure
- [api.md](api.md) -- GraphQL operations for reading and writing schema-defined records
- [patterns.md](patterns.md) -- common schema design patterns and relationship modeling
- [gotchas.md](gotchas.md) -- common errors, limits, and troubleshooting
- [advanced.md](advanced.md) -- advanced schema techniques, optimization, and edge cases
- [../graphql/README.md](../graphql/README.md) -- GraphQL query and mutation reference
- [../migrations/README.md](../migrations/README.md) -- running data migrations after schema changes
