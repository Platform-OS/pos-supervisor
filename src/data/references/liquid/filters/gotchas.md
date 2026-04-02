# Liquid Filters: Common Gotchas

Common pitfalls and how to avoid them when using platformOS Liquid filters.

## Nil Handling Gotchas

### Problem: Silent Nil Returns
Many filters silently return nil on error without warning:
```liquid
{%- assign result = malformed_json | parse_json -%}
{%- if result -%}OK{%- else -%}FAIL{%- endif -%}
```

**Solution:** Validate input before processing:
```liquid
{%- if json_string | is_json_valid -%}
  {%- assign result = json_string | parse_json -%}
{%- else -%}
  {%- assign result = default_object -%}
{%- endif -%}
```

### Problem: Default Filter with False
```liquid
{%- assign active = false | default: true -%}
{%- comment %} Returns true, not false! {%- endcomment %}
```

**Solution:** Check truthiness explicitly:
```liquid
{%- if active == false -%}
  Explicitly inactive
{%- else -%}
  Active or undefined
{%- endif -%}
```

## Type Mismatch Gotchas

### Problem: Array vs Hash Operations
Applying hash filters to arrays or vice versa:
```liquid
{%- assign keys = my_array | hash_keys -%}
{%- comment %} Returns nil, not array of indices {%- endcomment %}
```

**Solution:** Check variable type first:
```liquid
{%- assign type = my_variable | type_of -%}
{%- if type == 'hash' -%}
  {%- assign keys = my_variable | hash_keys -%}
{%- endif -%}
```

### Problem: String vs Number Comparison
```liquid
{%- assign price = "100" | array_select: 'price', 100 -%}
{%- comment %} May not match due to type difference {%- endcomment %}
```

**Solution:** Ensure types match:
```liquid
{%- assign price = product.price | plus: 0 -%}
{%- assign selected = products | array_select: 'price', price -%}
```

## Ordering and Chaining Gotchas

### Problem: Order Matters in Chains
```liquid
{%- assign result = items | array_compact | array_flatten -%}
{%- comment %} Different from: items | array_flatten | array_compact {%- endcomment %}
```

**Solution:** Think through filter order:
- Compact removes nils first
- Flatten after removes nested structure
- Different results possible depending on data

### Problem: Filter Exhaustion
Some filters consume iterators:
```liquid
{%- assign first = items | array_first -%}
{%- assign count = items | array_first | size -%}
{%- comment %} items is still available, but filtered result isn't {%- endcomment %}
```

**Solution:** Store intermediate results:
```liquid
{%- assign first_items = items | array_first: 3 -%}
{%- assign first_count = first_items | size -%}
```

## JSON Serialization Gotchas

### Problem: Missing JSON Filter in Interpolation
```liquid
<script>
  var data = {{ object }};  // ERROR: Not valid JSON
</script>
```

**Solution:** Always use json filter:
```liquid
<script>
  var data = {{ object | json }};  // CORRECT
</script>
```

### Problem: Double Encoding
```liquid
{%- assign json_string = object | json -%}
{%- assign double_encoded = json_string | json -%}
{%- comment %} Now it's a JSON string of a JSON string {%- endcomment %}
```

**Solution:** Don't re-encode:
```liquid
{%- assign json_string = object | json -%}
{%- comment %} Use directly, don't filter again {%- endcomment %}
```

### Problem: parse_json with Empty Strings
```liquid
{%- assign result = "" | parse_json -%}
{%- comment %} Returns nil, not empty object {%- endcomment %}
```

**Solution:** Validate before parsing, use a hash literal as fallback:
```liquid
{%- if json_string != "" -%}
  {%- assign result = json_string | parse_json -%}
{%- else -%}
  {%- assign result = {} -%}
{%- endif -%}
```

## Date/Time Gotchas

### Problem: Timezone Assumptions
```liquid
{%- assign date = timestamp | strftime: '%Y-%m-%d' -%}
{%- comment %} Depends on server timezone {%- endcomment %}
```

**Solution:** Use localize for user timezone:
```liquid
{%- assign date = timestamp | localize: 'short' -%}
{%- comment %} Respects user's location {%- endcomment %}
```

### Problem: String to Time Conversion
```liquid
{%- assign future = "2025-12-31" | add_to_time: 1, 'day' -%}
{%- comment %} May not work as string needs to be valid {%- endcomment %}
```

**Solution:** Use 'now' or valid timestamp:
```liquid
{%- assign future = 'now' | add_to_time: 365, 'days' -%}
```

## String Filter Gotchas

### Problem: Regex Special Characters
```liquid
{%- if email | matches: '.+@.+.+' -%}
{%- comment %} Matches too much (. matches any character) {%- endcomment %}
{%- endif -%}
```

**Solution:** Escape special regex characters:
```liquid
{%- if email | matches: '.+@.+\..+' -%}
{%- comment %} Escaped final dot {%- endcomment %}
{%- endif -%}
```

### Problem: Unicode in Slugify
```liquid
{%- assign slug = "Café Münster" | slugify -%}
{%- comment %} May produce unexpected characters {%- endcomment %}
```

**Solution:** Test with your character set:
```liquid
{%- assign slug = title | slugify | replace: 'ä', 'a' -%}
```

## Crypto & Security Gotchas

### Problem: Key Management
```liquid
{%- assign encrypted = data | encrypt: 'hardcoded_key' -%}
{%- comment %} Key visible in template source {%- endcomment %}
```

**Solution:** Use constants:
```liquid
{%- assign encrypted = data | encrypt: context.constants.encryption_key -%}
```

### Problem: JWT Expiration Not Automatic
```liquid
{%- assign token = data | jwt_encode: secret -%}
{%- comment %} Token doesn't expire unless exp claim included {%- endcomment %}
```

**Solution:** Include expiration in payload:
```liquid
{%- assign exp_time = 'now' | add_to_time: 1, 'hours' -%}
{%- assign payload = data | hash_merge: exp_time -%}
{%- assign token = payload | jwt_encode: secret -%}
```

## Performance Gotchas

### Problem: Large Array Operations
```liquid
{%- assign huge_list = 1000000_items | array_sort_by: 'name' -%}
{%- comment %} May timeout or cause memory issues {%- endcomment %}
```

**Solution:** Use GraphQL for large datasets:
```graphql
query {
  items(sort: {field: "name", direction: ASC}, first: 100) {
    edges { node { id name } }
  }
}
```

### Problem: Nested Filter Chains
```liquid
{%- assign result = data | parse_json | hash_merge: more | array_select: x | json -%}
{%- comment %} Deep chains hard to debug {%- endcomment %}
```

**Solution:** Break into steps:
```liquid
{%- assign parsed = data | parse_json -%}
{%- assign merged = parsed | hash_merge: more -%}
{%- assign filtered = merged | array_select: x -%}
{%- assign result = filtered | json -%}
```

## See Also

- [Filter Configuration](configuration.md)
- [Filter API Reference](api.md)
- [Filter Patterns & Examples](patterns.md)
- [Advanced Techniques](advanced.md)
