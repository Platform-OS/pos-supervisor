# Liquid Filters: Configuration

Configuration and setup guidance for platformOS Liquid filters.

## Overview

platformOS provides a comprehensive set of filters organized by category: Array, Hash, Date, String, JSON, Validation, Currency, Crypto, Translation, Asset, and Utility filters. All filters are chainable and can be combined with other filters.

## Filter Categories

### Array Filters
- `array_add` - Add elements to an array
- `array_select` - Filter array elements by condition
- `array_reject` - Remove elements matching condition
- `array_sort_by` - Sort array by property
- `array_group_by` - Group array elements by property
- `array_uniq` - Remove duplicates
- `array_flatten` - Flatten nested arrays
- `array_compact` - Remove nil values
- `array_first` - Get first element(s)
- `array_last` - Get last element(s)
- `array_reverse` - Reverse array order
- `array_size` - Get array length
- `array_join` - Join array to string

### Hash Filters
- `hash_merge` - Merge hashes together
- `hash_dig` - Extract nested values
- `hash_keys` - Extract all keys
- `hash_values` - Extract all values
- `assign obj["key"] = val` - Assign values to hash (replaces deprecated `hash_assign` tag)
- `hash_delete` - Remove hash entries
- `hash_size` - Get hash size

### Date Filters
- `add_to_time` - Add duration to date/time
- `localize` - Localize date/time for user
- `strftime` - Format date/time with pattern
- `time_diff` - Calculate time difference
- `time_since` - Time elapsed since date
- `iso8601` - Format as ISO 8601

### String Filters
- `slugify` - Convert to URL-safe slug
- `parameterize` - Convert to parameter string
- `matches` - Match against regex pattern
- `replace_regex` - Replace using regex
- `markdown` - Render Markdown to HTML
- `capitalize` - Capitalize first letter
- `downcase` - Convert to lowercase
- `upcase` - Convert to uppercase

### JSON Filters
- `json` - Convert to JSON string
- `parse_json` - Parse JSON string to object
- `base64_encode` - Encode to base64
- `base64_decode` - Decode from base64
- `json_encode` - Alias for json
- `json_decode` - Alias for parse_json

### Validation Filters
- `is_email_valid` - Validate email format
- `is_json_valid` - Validate JSON syntax
- `is_valid_uuid` - Validate UUID format

### Currency Filters
- `pricify` - Format currency (dollars)
- `pricify_cents` - Format currency (cents)
- `format_currency` - Format with currency symbol

### Crypto Filters
- `encrypt` - Encrypt string with AES-256
- `decrypt` - Decrypt AES-256 string
- `jwt_encode` - Create JWT token
- `jwt_decode` - Decode JWT token
- `hmac_sha256` - Create HMAC signature
- `md5` - Generate MD5 hash
- `sha256` - Generate SHA256 hash

### Translation Filters
- `t` - Translate key with interpolation
- `t_escape` - Translate and escape HTML

### Asset Filters
- `asset_url` - Get full asset URL
- `asset_path` - Get asset path only
- `asset_size` - Get asset file size
- `asset_exists` - Check if asset exists

### Utility Filters
- `uuid` - Generate UUID
- `random_string` - Generate random string
- `type_of` - Get variable type
- `deep_clone` - Deep copy object
- `download_file` - Trigger file download
- `humanize` - Convert string to human-readable
- `inspect` - Debug object representation
- `default` - Provide default value

## Best Practices

1. **Chain filters logically** - Order filters by operation complexity
2. **Use specific filters** - Prefer `array_select` over generic filtering
3. **Handle nil values** - Use `default` filter for nil safety
4. **Encode output** - Always use `json` when passing to JavaScript
5. **Validate input** - Use validation filters before processing
6. **Test in GraphQL** - Complex filters benefit from GraphQL queries

## Common Patterns

```liquid
{%- assign items = collection | array_sort_by: 'price' | array_select: property -%}
{%- assign users = people | array_group_by: 'country' -%}
{%- assign data = string | parse_json | json -%}
{%- assign timestamp = 'now' | add_to_time: 7, 'days' | strftime: '%Y-%m-%d' -%}
```

## Performance Considerations

- Array operations on large datasets may impact performance
- Prefer GraphQL filtering for complex queries
- Limit filter chains to 3-4 operations when possible
- Use `limit` and `offset` for pagination

## Error Handling

All filters return nil or empty strings on error. Check return values:

```liquid
{%- if value | is_json_valid -%}
  {%- assign parsed = value | parse_json -%}
{%- endif -%}
```

## See Also

- [Filters API Reference](api.md)
- [Filter Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
