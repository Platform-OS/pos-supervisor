# Liquid Filters: Patterns & Examples

Common patterns and practical examples for using platformOS Liquid filters.

## Array Operations Patterns

### Filtering Products by Price Range
```liquid
{%- assign affordable = products | array_select: 'price', 100 -%}
{%- assign expensive = products | array_reject: 'price', 100 -%}
```

### Sorting and Limiting Results
```liquid
{%- assign top_sellers = products
  | array_sort_by: 'sales_count'
  | array_reverse
  | array_first: 5 -%}
```

### Grouping Users by Country
```liquid
{%- assign users_by_country = users | array_group_by: 'country' -%}
{%- for country in users_by_country -%}
  <h3>{{ country[0] }}</h3>
  {%- for user in country[1] -%}
    <p>{{ user.name }}</p>
  {%- endfor -%}
{%- endfor -%}
```

### Removing Duplicates
```liquid
{%- assign unique_items = items | array_uniq: 'sku' -%}
{%- assign unique_ids = ids | array_uniq -%}
```

### Flattening Nested Categories
```liquid
{%- assign all_products = categories | array_flatten | array_compact -%}
```

## Hash Operations Patterns

### Merging Configuration Objects
```liquid
{%- assign defaults = default_config | hash_merge: user_config -%}
{%- assign settings = base_settings | hash_merge: overrides -%}
```

### Safe Nested Value Access
```liquid
{%- assign email = user | hash_dig: 'profile', 'contact', 'email' -%}
{%- if email -%}
  <p>{{ email }}</p>
{%- endif -%}
```

### Building Dynamic Objects
```liquid
{%- assign settings = { "api_key": context.constants.api_key, "user_id": current_user.id } -%}
{%- assign merged = settings | hash_merge: additional_config -%}
```

## Date & Time Patterns

### Formatting for Different Locales
```liquid
{%- assign local_date = timestamp | localize: 'long' -%}
{%- assign iso_date = timestamp | iso8601 -%}
{%- assign custom_date = timestamp | strftime: '%A, %B %d, %Y' -%}
```

### Calculating Expiration Dates
```liquid
{%- assign expires_at = 'now' | add_to_time: 7, 'days' -%}
{%- assign session_expires = 'now' | add_to_time: 30, 'minutes' -%}
```

### Time Difference Calculations
```liquid
{%- assign hours_passed = created_at | time_diff: 'now' | divided_by: 3600 -%}
{%- assign days_until = due_date | time_diff: 'now' | divided_by: 86400 -%}
```

## String Processing Patterns

### URL Slug Generation
```liquid
{%- assign slug = product.title | slugify -%}
{%- assign url = '/products/' | append: slug -%}
```

### Email Validation
```liquid
{%- if email | matches: '^[^@]+@[^@]+\.[^@]+$' -%}
  <p>Valid email</p>
{%- else -%}
  <p>Invalid email format</p>
{%- endif -%}
```

### Sanitizing User Input
```liquid
{%- assign clean = user_input | replace_regex: '<[^>]+>', '' -%}
{%- assign escaped = clean | replace_regex: '&', '&amp;' -%}
```

### Rendering Markdown Content
```liquid
{%- assign description = product.markdown_description | markdown -%}
<div class="content">{{ description }}</div>
```

## JSON Data Patterns

### Converting Objects to JSON
```liquid
{%- assign cart_json = cart | json -%}
<script>
  var cart = {{ cart_json }};
</script>
```

### Parsing Dynamic JSON
```liquid
{%- assign metadata = product.metadata_json | parse_json -%}
{%- if metadata -%}
  <p>Brand: {{ metadata.brand }}</p>
  <p>Color: {{ metadata.color }}</p>
{%- endif -%}
```

### Validating JSON Before Processing
```liquid
{%- if import_data | is_json_valid -%}
  {%- assign parsed = import_data | parse_json -%}
  {%- for item in parsed -%}
    <p>{{ item.name }}</p>
  {%- endfor -%}
{%- else -%}
  <p>Invalid JSON data</p>
{%- endif -%}
```

## Encryption & Security Patterns

### Protecting Sensitive Data
```liquid
{%- assign encrypted = credit_card | encrypt: encryption_key -%}
```

### Creating Session Tokens
```liquid
{%- assign payload = user_id | append: ':' | append: 'now' | json -%}
{%- assign token = payload | jwt_encode: secret_key -%}
```

### Verifying Data Integrity
```liquid
{%- assign signature = data | hmac_sha256: secret_key -%}
<meta name="data-signature" content="{{ signature }}">
```

## Type Safety Patterns

### Checking Variable Types
```liquid
{%- assign type = value | type_of -%}
{%- if type == 'array' -%}
  {%- for item in value -%}...{%- endfor -%}
{%- elsif type == 'hash' -%}
  {%- assign keys = value | hash_keys -%}
{%- else -%}
  <p>{{ value }}</p>
{%- endif -%}
```

### Safe Defaults
```liquid
{%- assign count = input | default: 0 -%}
{%- assign name = user.name | default: 'Guest' -%}
{%- assign email = contact.email | default: 'N/A' -%}
```

## Utility Patterns

### Generating Unique IDs
```liquid
{%- assign tracking_id = '' | uuid -%}
{%- assign session_id = '' | random_string: 32 -%}
```

### Deep Cloning Objects
```liquid
{%- assign original = product_data -%}
{%- assign copy = original | deep_clone -%}
{%- assign copy.name = 'Modified' -%}
```

## Complex Chaining Examples

### Multi-Step Data Transformation
```liquid
{%- assign report = orders
  | array_select: 'status', 'completed'
  | array_sort_by: 'created_at'
  | array_reverse
  | array_group_by: 'customer_id'
  | json -%}
```

### Data Pipeline
```liquid
{%- capture pipeline_data -%}
  {%- assign result = input
    | parse_json
    | hash_merge: defaults
    | json -%}
  {{ result }}
{%- endcapture -%}
```

## See Also

- [Filter Configuration](configuration.md)
- [Filter API Reference](api.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
