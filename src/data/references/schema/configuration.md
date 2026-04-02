# Schema Configuration Reference

Complete reference for schema YAML files, property types, options, and file structure.

## File Location and Structure

```
app/
└── schema/
    ├── product.yml
    ├── category.yml
    ├── order.yml
    ├── order_item.yml
    └── user_profile.yml
```

Every schema file lives in `app/schema/` and has a `.yml` extension.

## YAML Format

A schema file has two top-level keys: `name` and `properties`.

```yaml
name: product
properties:
  - name: title
    type: string
  - name: description
    type: text
  - name: price
    type: float
```

### Rules

- `name` **must** match the filename without extension (`product.yml` requires `name: product`).
- `properties` is an array of objects, each with `name` and `type`.
- Property names must be unique within a schema.
- Property names should use `snake_case`.

## Property Types

| Type | Storage | Use Case | GraphQL Accessor |
|------|---------|----------|------------------|
| `string` | Short text, indexed | Titles, names, slugs, IDs | `property(name:)` |
| `text` | Long text, not indexed by default | Descriptions, body content | `property(name:)` |
| `integer` | Whole numbers | Quantities, counts, ages | `property_int(name:)` |
| `float` | Decimal numbers | Prices, ratings, coordinates | `property_float(name:)` |
| `boolean` | `true` / `false` | Flags, toggles, status | `property_boolean(name:)` |
| `datetime` | Date + time with timezone | Timestamps, scheduled dates | `property(name:)` |
| `date` | Date only (no time) | Birthdays, due dates | `property(name:)` |
| `array` | Ordered list of values | Tags, categories, multi-select | `property_array(name:)` |
| `upload` | File reference | Images, documents, media | `property_upload(name:)` |

## Upload Type Options

The `upload` type accepts an `options` object:

```yaml
- name: avatar
  type: upload
  options:
    acl: public              # public (CDN-accessible) or private (signed URL)
    max_size: 2097152        # bytes (2 MB)
    content_type:            # allowed MIME types
      - image/jpeg
      - image/png
      - image/webp
```

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `acl` | `public`, `private` | `private` | Public files served via CDN; private require signed URLs |
| `max_size` | Integer (bytes) | Platform default | Maximum upload file size |
| `content_type` | Array of MIME strings | All types | Restrict accepted file types |

## Built-in Fields

Every record automatically has these fields (do **not** declare them in your schema):

| Field | Type | Description |
|-------|------|-------------|
| `id` | ID | Unique auto-generated identifier |
| `created_at` | DateTime | Set on creation, immutable |
| `updated_at` | DateTime | Updated on every mutation |
| `table` | String | The schema name (e.g., `"product"`) |

## Relationship Conventions

platformOS has no foreign key constraints. Relationships are modeled by property naming convention and resolved in GraphQL.

### Belongs-to (store an ID reference)

```yaml
# app/schema/order.yml
name: order
properties:
  - name: user_id
    type: string
  - name: status
    type: string
  - name: total
    type: float
```

### Has-many (referenced from the child side)

```yaml
# app/schema/order_item.yml
name: order_item
properties:
  - name: order_id
    type: string
  - name: product_id
    type: string
  - name: quantity
    type: integer
  - name: unit_price
    type: float
```

The `_id` suffix is a convention, not enforced. Use `string` type for ID references -- this works for both record IDs and user IDs.

### Resolution in GraphQL

Relationships are resolved at query time using `related_record` and `related_records`:

```graphql
results {
  id
  user: related_record(table: "user", join_on_property: "user_id") {
    email
  }
  items: related_records(table: "order_item", join_on_property: "id", foreign_property: "order_id") {
    quantity: property_int(name: "quantity")
  }
}
```

## Minimal Example

```yaml
# app/schema/tag.yml
name: tag
properties:
  - name: label
    type: string
```

## Complete Example

```yaml
# app/schema/blog_post.yml
name: blog_post
properties:
  - name: title
    type: string
  - name: slug
    type: string
  - name: body
    type: text
  - name: author_id
    type: string
  - name: category_id
    type: string
  - name: published
    type: boolean
  - name: published_at
    type: datetime
  - name: view_count
    type: integer
  - name: rating
    type: float
  - name: tags
    type: array
  - name: cover_image
    type: upload
    options:
      acl: public
      max_size: 10485760
      content_type:
        - image/jpeg
        - image/png
        - image/webp
```

## Deploying Schema Changes

```bash
# Deploy all schema files to your instance
pos-cli deploy dev

# Schema changes are applied automatically during deploy
# Adding new properties is non-destructive
# Removing properties does NOT delete existing data
```

## See Also

- [README.md](README.md) -- overview and getting started
- [api.md](api.md) -- GraphQL operations for schema-defined records
- [patterns.md](patterns.md) -- schema design patterns
- [gotchas.md](gotchas.md) -- common errors and limits
- [advanced.md](advanced.md) -- advanced schema techniques
- [../graphql/configuration.md](../graphql/configuration.md) -- GraphQL file configuration
