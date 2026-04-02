# Liquid Filters: API Reference

Complete API documentation for all platformOS Liquid filters.

## Array Filters API

### array_add
```liquid
{%- assign result = array | array_add: element -%}
{%- assign result = array | array_add: other_array -%}
```
Adds element(s) to array, returns new array.

### array_select
```liquid
{%- assign result = array | array_select: property, value -%}
{%- assign result = array | array_select: property -%}
```
Returns array elements matching condition.

### array_reject
```liquid
{%- assign result = array | array_reject: property, value -%}
```
Returns array elements NOT matching condition.

### array_sort_by
```liquid
{%- assign result = array | array_sort_by: property -%}
```
Sorts array by property value (ascending).

### array_group_by
```liquid
{%- assign result = array | array_group_by: property -%}
```
Returns object with elements grouped by property.

### array_uniq
```liquid
{%- assign result = array | array_uniq -%}
{%- assign result = array | array_uniq: property -%}
```
Removes duplicate elements or duplicates by property.

### array_flatten
```liquid
{%- assign result = nested_array | array_flatten -%}
{%- assign result = nested_array | array_flatten: depth -%}
```
Flattens nested arrays to specified depth (default unlimited).

### array_compact
```liquid
{%- assign result = array | array_compact -%}
```
Removes nil/null and empty string values.

## Hash Filters API

### hash_merge
```liquid
{%- assign result = hash1 | hash_merge: hash2 -%}
```
Merges two hashes, second overwrites first.

### hash_dig
```liquid
{%- assign value = hash | hash_dig: 'key' -%}
{%- assign value = hash | hash_dig: 'parent', 'child', 'key' -%}
```
Extracts nested value, returns nil if missing.

### hash_keys
```liquid
{%- assign keys = hash | hash_keys -%}
```
Returns array of all hash keys.

### hash_values
```liquid
{%- assign values = hash | hash_values -%}
```
Returns array of all hash values.

### hash_delete
```liquid
{%- assign result = hash | hash_delete: 'key' -%}
```
Removes key from hash, returns new hash.

## Date Filters API

### add_to_time
```liquid
{%- assign result = date | add_to_time: amount, unit -%}
{%- assign result = 'now' | add_to_time: 7, 'days' -%}
{%- assign result = 'now' | add_to_time: 2, 'hours' -%}
```
Units: seconds, minutes, hours, days, weeks, months, years.

### localize
```liquid
{%- assign result = date | localize: format -%}
{%- assign result = date | localize: 'long' -%}
```
Formats date per user locale. Formats: short, medium, long, full.

### strftime
```liquid
{%- assign result = date | strftime: '%Y-%m-%d %H:%M:%S' -%}
{%- assign result = date | strftime: '%B %d, %Y' -%}
```
Uses standard strftime format codes.

### time_diff
```liquid
{%- assign seconds = date1 | time_diff: date2 -%}
{%- assign seconds = date1 | time_diff: 'now' -%}
```
Returns difference in seconds.

### iso8601
```liquid
{%- assign result = date | iso8601 -%}
```
Formats as ISO 8601 string.

## String Filters API

### slugify
```liquid
{%- assign slug = string | slugify -%}
{%- assign slug = 'Hello World!' | slugify -%}
```
Converts to lowercase, dashes, URL-safe string.

### parameterize
```liquid
{%- assign param = string | parameterize -%}
{%- assign param = string | parameterize: '_' -%}
```
Converts to parameter format (default separator: dash).

### matches
```liquid
{%- if string | matches: 'pattern' -%}
{%- if email | matches: '^[^@]+@[^@]+$' -%}
```
Tests if string matches regex pattern.

### replace_regex
```liquid
{%- assign result = string | replace_regex: 'pattern', 'replacement' -%}
{%- assign result = string | replace_regex: '\d+', 'NUM' -%}
```
Replaces pattern matches with replacement.

### markdown
```liquid
{%- assign html = markdown_string | markdown -%}
{%- assign html = markdown_string | markdown: 'simple' -%}
```
Renders Markdown to HTML. Types: simple, extended.

## JSON Filters API

### json
```liquid
{%- assign json_string = object | json -%}
{%- assign json_string = hash | json -%}
```
Converts to JSON string representation.

### parse_json
```liquid
{%- assign object = json_string | parse_json -%}
```
Parses JSON string to object/array.

### base64_encode
```liquid
{%- assign encoded = string | base64_encode -%}
```
Encodes string to base64.

### base64_decode
```liquid
{%- assign decoded = encoded | base64_decode -%}
```
Decodes base64 string.

## Crypto Filters API

### encrypt
```liquid
{%- assign encrypted = string | encrypt: key -%}
```
Encrypts with AES-256-CBC, returns base64.

### decrypt
```liquid
{%- assign decrypted = encrypted | decrypt: key -%}
```
Decrypts AES-256-CBC encrypted string.

### jwt_encode
```liquid
{%- assign token = data | jwt_encode: secret -%}
```
Creates JWT token with payload.

### jwt_decode
```liquid
{%- assign payload = token | jwt_decode: secret -%}
```
Decodes JWT token, returns payload.

### hmac_sha256
```liquid
{%- assign signature = string | hmac_sha256: secret -%}
```
Creates HMAC-SHA256 signature (base64).

## Utility Filters API

### type_of
```liquid
{%- assign type = variable | type_of -%}
```
Returns: string, number, array, hash, boolean, nil.

### default
```liquid
{%- assign value = variable | default: 'fallback' -%}
```
Returns fallback if variable is nil/false/empty.

### inspect
```liquid
{%- assign debug = variable | inspect -%}
```
Returns debug representation for console.

## See Also

- [Filter Configuration](configuration.md)
- [Filter Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
