# Schema Advanced Topics

Advanced schema techniques, optimization strategies, edge cases, and design considerations.

## Schema Evolution Strategy

platformOS schema deploys are **additive only**. Understanding this is critical for production systems.

### Adding properties

Safe and non-destructive. New properties default to `null` on existing records.

```yaml
# Adding a new property to an existing schema
name: product
properties:
  - name: title
    type: string
  - name: price
    type: float
  - name: sku         # new property -- existing records will have null
    type: string
```

### Renaming properties

There is no rename operation. You must:

1. Add the new property to the schema.
2. Deploy.
3. Write a migration to copy data from the old property to the new one.
4. Update all GraphQL queries and mutations to use the new property name.
5. Optionally remove the old property from the schema (data remains).

```liquid
{% comment %} app/migrations/20240301120000_rename_title_to_name.liquid {% endcomment %}
{% liquid
  assign page = 1
  assign has_more = true
%}
{% liquid
  while has_more
    graphql result = 'products/list_page', page: page
    for product in result.records.results
      graphql _ = 'products/update', id: product.id, name: product.title
    endfor
    assign page = page | plus: 1
    assign has_more = result.records.has_next_page
  endwhile
%}
```

### Removing properties

Removing a property from the YAML only removes it from the schema definition. Data persists in the database. You can still read it via GraphQL property accessors. To truly clean data, null out values via a migration.

## Optimizing for Search and Filtering

### String vs Text

`string` properties are indexed and searchable via filters. `text` properties are stored but not indexed by default. Choose accordingly:

| Use `string` for | Use `text` for |
|-------------------|----------------|
| Titles, names, slugs | Long descriptions, body content |
| Status fields, enums | HTML content, markdown |
| IDs, references | JSON data stored as text |
| Anything you filter on | Content you only display |

### Denormalization for Performance

In platformOS, JOINs happen through `related_record` / `related_records` at query time. For frequently accessed data, consider denormalizing:

```yaml
# Instead of always joining to get author name:
name: article
properties:
  - name: author_id
    type: string
  - name: author_name        # denormalized from author table
    type: string
  - name: title
    type: string
  - name: body
    type: text
```

**Trade-off:** Faster reads, but you must update denormalized fields when the source changes. Use a command or background job to keep them in sync.

## Storing JSON in Text Fields

For flexible, schemaless data within a record, store serialized JSON in a `text` property:

```yaml
name: product
properties:
  - name: title
    type: string
  - name: metadata
    type: text           # stores: {"color":"red","weight":"2kg","dimensions":"10x5x3"}
```

**Writing JSON:**

```liquid
{% assign meta = { "color": "red", "weight": "2kg" } %}
{% graphql _ = 'products/update', id: product.id, metadata: meta | json %}
```

**Reading JSON:**

```liquid
{% assign meta = product.metadata | parse_json %}
Color: {{ meta.color }}
```

**Limitation:** You cannot filter or sort by values inside JSON text fields. If you need to query by a value, promote it to its own property.

## Multi-Tenant Schema Design

For SaaS applications serving multiple organizations:

```yaml
# app/schema/organization.yml
name: organization
properties:
  - name: name
    type: string
  - name: slug
    type: string

# app/schema/project.yml
name: project
properties:
  - name: organization_id
    type: string       # tenant scoping
  - name: name
    type: string
  - name: user_id
    type: string       # creator
```

**Always filter by tenant:**

```graphql
filter: {
  table: { value: "project" }
  properties: [
    { name: "organization_id", value: $org_id }
  ]
}
```

Forgetting the tenant filter exposes data across organizations. Enforce this in a shared GraphQL file or command.

## Polymorphic Records

Model polymorphism using `type` and `resource_id` properties:

```yaml
# app/schema/comment.yml
name: comment
properties:
  - name: body
    type: text
  - name: user_id
    type: string
  - name: commentable_type   # "article", "product", "photo"
    type: string
  - name: commentable_id
    type: string
```

**Query comments for a specific resource:**

```graphql
filter: {
  table: { value: "comment" }
  properties: [
    { name: "commentable_type", value: $type }
    { name: "commentable_id", value: $id }
  ]
}
```

**Limitation:** You cannot use `related_record` with a dynamic table name. Resolve the parent record in a separate query or denormalize the parent's key fields onto the comment.

## Soft Delete Pattern

Since platformOS has no built-in soft delete:

```yaml
name: invoice
properties:
  - name: number
    type: string
  - name: total
    type: float
  - name: deleted_at
    type: datetime         # null means active, set means deleted
```

**Filter active records:**

```graphql
filter: {
  table: { value: "invoice" }
  properties: [{ name: "deleted_at", value: "" }]
}
```

**Note:** Filtering for empty/null property values can be inconsistent. An alternative is a boolean `deleted` property set to `"false"` by default, which is more reliable to filter on.

## Upload Security Considerations

- **Private ACL uploads** generate time-limited signed URLs. Do not cache these URLs long-term.
- **Public ACL uploads** are served via CDN and are accessible to anyone with the URL. Do not use `public` for sensitive documents.
- There is no server-side virus scanning. Validate file types strictly using `content_type` restrictions.
- Uploaded files are associated with the record. Deleting the record does **not** automatically delete the file from storage. Files may persist in CDN caches.

## Indexing and Performance

- `string` type properties are indexed in ElasticSearch, enabling efficient filtering and search.
- `text` type properties are stored but querying against them is slower.
- Filtering on multiple properties simultaneously works but performance degrades with many conditions.
- For high-volume queries (thousands of records), prefer pagination over large `per_page` values.
- The maximum practical `per_page` value is around 1000. For bulk operations, use the Data Import/Export API instead.

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- YAML format reference
- [api.md](api.md) -- GraphQL operations
- [patterns.md](patterns.md) -- common patterns
- [gotchas.md](gotchas.md) -- common errors and limits
- [../migrations/README.md](../migrations/README.md) -- data migrations for schema changes
- [../graphql/advanced.md](../graphql/advanced.md) -- advanced GraphQL techniques
