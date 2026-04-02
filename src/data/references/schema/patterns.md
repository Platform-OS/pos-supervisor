# Schema Patterns

Common schema design patterns, relationship modeling, and real-world examples for platformOS.

## Basic Entity Schema

The simplest pattern: a standalone entity with typed properties.

```yaml
# app/schema/category.yml
name: category
properties:
  - name: name
    type: string
  - name: slug
    type: string
  - name: position
    type: integer
```

**Best practice:** Always include a `slug` or human-readable identifier for URL-friendly lookups.

## One-to-Many Relationship

Store the parent ID on the child record. Resolve with `related_records` in GraphQL.

```yaml
# app/schema/author.yml
name: author
properties:
  - name: name
    type: string
  - name: bio
    type: text

# app/schema/article.yml
name: article
properties:
  - name: author_id
    type: string       # references author.id
  - name: title
    type: string
  - name: body
    type: text
  - name: published
    type: boolean
```

**Query with relationship:**

```graphql
query articles($page: Int = 1) {
  records(
    page: $page
    per_page: 10
    filter: { table: { value: "article" }, properties: [{ name: "published", value: "true" }] }
    sort: [{ created_at: { order: DESC } }]
  ) {
    results {
      id
      title: property(name: "title")
      author: related_record(table: "author", join_on_property: "author_id") {
        name: property(name: "name")
      }
    }
  }
}
```

## Many-to-Many Relationship

Use a join table to model many-to-many relationships.

```yaml
# app/schema/product.yml
name: product
properties:
  - name: title
    type: string
  - name: price
    type: float

# app/schema/tag.yml
name: tag
properties:
  - name: label
    type: string

# app/schema/product_tag.yml  (join table)
name: product_tag
properties:
  - name: product_id
    type: string
  - name: tag_id
    type: string
```

**Query products with their tags:**

```graphql
results {
  id
  title: property(name: "title")
  product_tags: related_records(
    table: "product_tag"
    join_on_property: "id"
    foreign_property: "product_id"
  ) {
    tag: related_record(table: "tag", join_on_property: "tag_id") {
      label: property(name: "label")
    }
  }
}
```

## Using the Array Type for Simple Tags

When you do not need tag metadata (no separate tag entity), use the `array` type directly:

```yaml
# app/schema/post.yml
name: post
properties:
  - name: title
    type: string
  - name: tags
    type: array
```

```graphql
# Creating with tags
mutation {
  record_create(record: {
    table: "post"
    properties: [
      { name: "title", value: "My Post" }
      { name: "tags", value: "[\"platformos\", \"tutorial\"]" }
    ]
  }) { id }
}
```

**Trade-off:** Simpler schema, but you cannot query "all posts with tag X" as efficiently as with a join table.

## File Upload Pattern

```yaml
# app/schema/document.yml
name: document
properties:
  - name: title
    type: string
  - name: file
    type: upload
    options:
      acl: private
      max_size: 52428800        # 50 MB
      content_type:
        - application/pdf
        - application/msword
  - name: thumbnail
    type: upload
    options:
      acl: public
      max_size: 2097152         # 2 MB
      content_type:
        - image/jpeg
        - image/png
```

**Accessing uploads in GraphQL:**

```graphql
results {
  title: property(name: "title")
  file: property_upload(name: "file") { url }
  thumbnail: property_upload(name: "thumbnail") { url }
}
```

Public uploads return a direct CDN URL. Private uploads return a time-limited signed URL.

## User Profile Extension

The built-in `user` table has `email` and authentication fields. Extend it with a profile schema:

```yaml
# app/schema/user_profile.yml
name: user_profile
properties:
  - name: user_id
    type: string
  - name: first_name
    type: string
  - name: last_name
    type: string
  - name: avatar
    type: upload
    options:
      acl: public
  - name: bio
    type: text
```

**Query user with profile:**

```graphql
query user($id: ID!) {
  users(per_page: 1, filter: { id: { value: $id } }) {
    results {
      id
      email
      profile: related_record(table: "user_profile", join_on_property: "id", foreign_property: "user_id") {
        first_name: property(name: "first_name")
        avatar: property_upload(name: "avatar") { url }
      }
    }
  }
}
```

## Status and Enum Pattern

Use `string` for enum-like fields. Validate in your application logic.

```yaml
# app/schema/order.yml
name: order
properties:
  - name: user_id
    type: string
  - name: status
    type: string           # "pending", "paid", "shipped", "delivered", "cancelled"
  - name: total
    type: float
  - name: notes
    type: text
```

**Filter by status:**

```graphql
filter: {
  table: { value: "order" }
  properties: [{ name: "status", value: "pending" }]
}
```

## Timestamped Events Pattern

For audit trails or event logs:

```yaml
# app/schema/activity_log.yml
name: activity_log
properties:
  - name: user_id
    type: string
  - name: action
    type: string           # "login", "purchase", "update_profile"
  - name: resource_type
    type: string           # "order", "product", etc.
  - name: resource_id
    type: string
  - name: metadata
    type: text             # JSON string for flexible data
```

Use `created_at` (automatic) for the event timestamp. Store extra context as a JSON string in `text`.

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- full YAML format and property types
- [api.md](api.md) -- GraphQL operations for records
- [gotchas.md](gotchas.md) -- common errors and limits
- [advanced.md](advanced.md) -- advanced schema techniques
- [../graphql/patterns.md](../graphql/patterns.md) -- GraphQL query patterns
