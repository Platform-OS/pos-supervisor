# GraphQL Gotchas

Common errors, limits, and troubleshooting for GraphQL in platformOS.

## Common Errors

### "Liquid error: graphql tag is not allowed in partials"

**Cause:** You placed a `{% graphql %}` tag inside a partial file (`app/views/partials/`). platformOS prohibits GraphQL calls from partials.

**Solution:** Move the `{% graphql %}` call to the page that renders the partial. Pass the query result to the partial as a variable: `{% render 'my_partial', products: result.records.results %}`.

### "QueryNotFound: 'products/serch'"

**Cause:** The file path in the `{% graphql %}` tag does not match any `.graphql` file. Usually a typo or wrong subdirectory.

**Solution:** Verify the file exists at `app/graphql/products/serch.graphql`. The path is relative to `app/graphql/` without the `.graphql` extension. Check spelling and directory names.

### "Variable $id of type ID! was provided invalid value"

**Cause:** A required variable (marked with `!`) was not passed or was passed as `nil`/empty.

**Solution:** Ensure the Liquid invocation provides all required variables: `{% graphql result = 'products/find', id: context.params.id %}`. Check that `context.params.id` is not nil. Add a guard: `{% if context.params.id %}...{% endif %}`.

### Query returns empty results when data exists

**Cause:** Missing or incorrect `table` filter. Without `table: { value: "product" }`, the query searches across all tables and may not match expected records.

**Solution:** Always include the `table` filter in `records()` queries. Double-check the table name matches the schema `name` exactly (case-sensitive).

### Property accessor returns null for existing data

**Cause:** Using the wrong accessor type. For example, `property(name: "price")` returns a string, not a number. Or `property_int(name: "price")` on a float field returns null.

**Solution:** Match the accessor to the schema property type. Use `property_float` for `float`, `property_int` for `integer`, `property_boolean` for `boolean`. When in doubt, `property()` always returns the string representation.

### "Cannot query field 'custom_type' on type 'Query'"

**Cause:** Attempting to define or use custom GraphQL types. The platformOS schema is closed.

**Solution:** You cannot create custom types. Use the provided root operations (`records`, `record_create`, etc.) with property accessors to shape your response. All data modeling is done through schema YAML files.

### Mutation updates wrong record or all records

**Cause:** Passing a nil or incorrect `$id` to `record_update`. If `id` is nil, behavior is unpredictable.

**Solution:** Always validate the ID exists before calling update mutations. Guard with `{% if id %}` in Liquid.

### "Filter value must be a String" on property filter

**Cause:** Passing a non-string value (integer, boolean, object) directly to a property filter.

**Solution:** All property filter values must be strings. Convert in Liquid if needed: `{{ count | json }}` or simply pass as quoted string in the GraphQL variable.

### StringFilter syntax — object, not a plain string (GraphQLCheck)

**Cause:** Using a plain string where a `StringFilter` object is required. This is the most common `GraphQLCheck` linter error.

```graphql
# WRONG — plain string is not a StringFilter:
filter: { table: "blog_post" }

# RIGHT — StringFilter is an object with an operator key:
filter: { table: { value: "blog_post" } }
```

Other `StringFilter` operators:

```graphql
filter: { table: { contains: "blog" } }
filter: { table: { starts_with: "blog" } }
filter: { table: { ends_with: "post" } }
filter: { table: { not_eq: "draft" } }
```

The same pattern applies to any field typed `StringFilter` in the schema — not just `table`.

### SortOrderEnum must be unquoted (GraphQLCheck)

**Cause:** Wrapping the sort direction in quotes. `ASC` and `DESC` are enum values, not strings.

```graphql
# WRONG — quoted string:
sort: [{ properties: [{ name: "created_at", order: "DESC" }] }]

# RIGHT — unquoted enum:
sort: [{ properties: [{ name: "created_at", order: DESC }] }]
```

Also applies to `RecordsSortInput` and `PropertySort` — any field typed as a sort enum.

### Custom schema properties — use properties_object, not direct fields (UnknownProperty)

**Cause:** Trying to query custom schema properties (defined in `.yml` schema files) as direct
fields on the `Record` type. The `Record` type only has built-in fields: `id`, `table`,
`created_at`, `updated_at`, `user_id`, `external_id`.

```graphql
# WRONG — custom fields do not exist directly on Record:
query GetProducts {
  records(filter: { table: { value: "product" } }) {
    results {
      id
      title    # does not exist on Record
      price    # does not exist on Record
    }
  }
}

# RIGHT — use properties_object to access custom fields:
query GetProducts {
  records(filter: { table: { value: "product" } }) {
    results {
      id
      properties_object    # returns all custom properties as a hash
    }
  }
}
```

Access in Liquid:

```liquid
{% graphql g = 'products/list' %}
{% for product in g.records.results %}
  {{ product.properties_object.title }}
  {{ product.properties_object.price | property_float }}
{% endfor %}
```

Use `property_float` / `property_int` / `property_boolean` accessors when you need typed values.
`properties_object.field` always returns a string.

### GraphQL result path — mirrors query field name (UnknownProperty)

**Cause:** Accessing the result at the wrong path in Liquid. The result variable structure mirrors
the GraphQL query exactly — the top-level key is the query field name, not `results` or `data`.

```liquid
{% graphql g = 'records/list' %}

{# WRONG — data is not at the root: #}
{% for item in g.results %}

{# WRONG — no intermediate .data key: #}
{% for item in g.data.records.results %}

{# RIGHT — path mirrors the GraphQL query field name: #}
{% for item in g.records.results %}    {# when query field is "records" #}
{% for item in g.users.results %}      {# when query field is "users" #}
{% assign user = g.user %}             {# when query field is "user" (single record) #}
```

To confirm the correct path: open the `.graphql` file and look at the root field name
(`records`, `user`, `users`, etc.) — that is the first key under the result variable.

### related_record returns null

**Cause:** The `join_on_property` value does not contain a valid ID, or the referenced record does not exist in the specified table.

**Solution:** Verify the stored ID value is correct. Check that `join_on_property` names the property on the **current** record. For `related_records`, check that `foreign_property` names the property on the **related** table.

## Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| `per_page` maximum | ~1000 | Use pagination for larger sets |
| Default `per_page` | 20 | If not specified |
| Query depth | ~5 levels | Nested `related_record` / `related_records` |
| Properties per filter | No hard limit | Performance degrades with many conditions |
| Inline query size | Practical only | Long queries should use named files |
| GraphQL file size | No hard limit | Keep operations focused and single-purpose |
| Concurrent queries per request | No hard limit | Each `{% graphql %}` tag is a separate call |
| Sort fields | Multiple allowed | Applied in array order |

## Troubleshooting Flowchart

```
GraphQL issue?
├── Query returns error?
│   ├── "QueryNotFound"
│   │   └── Fix: Check file path and spelling (relative to app/graphql/)
│   ├── "not allowed in partials"
│   │   └── Fix: Move {% graphql %} to page, pass data to partial
│   ├── "Variable ... invalid value"
│   │   └── Fix: Ensure all required (!) variables are provided and non-nil
│   └── "Cannot query field"
│       └── Fix: Use only built-in root types (records, record_create, etc.)
│
├── Query returns empty results?
│   ├── Is table filter present and correct?
│   │   └── Fix: Add filter: { table: { value: "exact_name" } }
│   ├── Are property filters using string values?
│   │   └── Fix: All filter values must be strings
│   └── Is the data deployed?
│       └── Fix: Run pos-cli deploy dev
│
├── Property value is null or wrong type?
│   ├── Is the accessor matching the schema type?
│   │   └── Fix: property_float for float, property_int for integer, etc.
│   └── Is the property name spelled correctly?
│       └── Fix: Case-sensitive match against schema property name
│
└── Related record is null?
    ├── Does the ID property contain a valid value?
    │   └── Fix: Verify stored ID points to existing record
    └── Are join_on_property / foreign_property correct?
        └── Fix: join_on_property = field on THIS record,
            foreign_property = field on RELATED record
```

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- file structure and invocation syntax
- [api.md](api.md) -- complete API reference
- [patterns.md](patterns.md) -- correct usage patterns
- [advanced.md](advanced.md) -- advanced techniques
- [../schema/gotchas.md](../schema/gotchas.md) -- schema-related errors
