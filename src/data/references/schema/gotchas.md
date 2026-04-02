# Schema Gotchas

Common errors, limits, and troubleshooting for schema files.

## Common Errors

### "Table not found" or "Unknown table" in GraphQL

**Cause:** The schema file has not been deployed, or the `table` value in your GraphQL filter does not match the schema `name`.

**Solution:** Verify the `name` field in your YAML matches exactly what you use in `filter: { table: { value: "..." } }`. Run `pos-cli deploy dev` to push schema changes. Names are case-sensitive.

### "Name must match filename"

**Cause:** The `name` field inside the YAML file does not match the filename. For example, `app/schema/product.yml` contains `name: products` (plural mismatch).

**Solution:** Ensure the `name` field exactly matches the filename without extension. `product.yml` must have `name: product`.

### "Property not found" or null values in query results

**Cause:** The property name in your GraphQL accessor does not match the property name in the schema, or you are using the wrong accessor type.

**Solution:** Check spelling and case. Use the correct accessor -- `property_int()` for integers, `property_float()` for floats, `property_boolean()` for booleans. Using `property()` for a boolean field returns the string `"true"` or `"false"`, not an actual boolean.

### Upload returns null URL

**Cause:** The file was not uploaded correctly, or the property was set with a string value instead of an actual file upload through a form.

**Solution:** Uploads must come through multipart form submissions using the `file` input type. You cannot set upload properties via GraphQL string values. Ensure your form has `enctype="multipart/form-data"`.

### "Array values must be JSON"

**Cause:** Setting an `array` property with a plain string instead of a JSON array string.

**Solution:** Pass array values as JSON strings: `{ name: "tags", value: "[\"tag1\", \"tag2\"]" }`. In Liquid, use `| json` filter to serialize arrays.

### Removing a property from schema does not delete data

**Cause:** Schema deploys are additive. Removing a property from the YAML file does not drop the column or delete existing data.

**Solution:** This is by design. Old data remains accessible. If you need to clean up data, use a migration to null out or delete records. You can re-add the property later and existing data will still be there.

### Boolean filter not working

**Cause:** Filtering with `properties: [{ name: "active", value: true }]` -- passing a boolean literal instead of a string.

**Solution:** All property filter values must be strings: `{ name: "active", value: "true" }`.

## Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Properties per schema | ~200 | Practical limit; no hard cap documented |
| Property name length | 255 chars | Must be valid identifier |
| String property value | ~255 chars | Use `text` for longer content |
| Text property value | ~16 MB | Platform-dependent |
| Upload max file size | Configurable | Set via `max_size` in options |
| Schema files per app | No hard limit | Limited by deploy time |
| Array property values | JSON array | Must be valid JSON string |
| Nested objects | Not supported | Use `text` with JSON or separate tables |

## Troubleshooting Flowchart

```
Schema issue?
├── Deploy error?
│   ├── "Name must match filename"
│   │   └── Fix: Align name field with filename
│   └── YAML syntax error
│       └── Fix: Validate YAML (check indentation, colons, dashes)
│
├── Data not appearing?
│   ├── Is the table name correct in your GraphQL filter?
│   │   └── Fix: Must match schema name exactly (case-sensitive)
│   ├── Was the schema deployed?
│   │   └── Fix: Run pos-cli deploy dev
│   └── Are you using the right property accessor?
│       └── Fix: Match accessor to type (property_int for integer, etc.)
│
├── Upload not working?
│   ├── Is the form multipart?
│   │   └── Fix: Add enctype="multipart/form-data"
│   ├── Is the file within size/type limits?
│   │   └── Fix: Check max_size and content_type in schema options
│   └── Is acl set correctly?
│       └── public = CDN URL, private = signed URL
│
└── Relationship not resolving?
    ├── Is the _id property storing the correct ID?
    │   └── Fix: Verify the stored value matches the target record ID
    └── Are related_record arguments correct?
        └── Fix: Check table, join_on_property, foreign_property
```

## See Also

- [README.md](README.md) -- overview and getting started
- [configuration.md](configuration.md) -- full YAML format reference
- [api.md](api.md) -- GraphQL operations
- [patterns.md](patterns.md) -- recommended schema patterns
- [advanced.md](advanced.md) -- advanced techniques
