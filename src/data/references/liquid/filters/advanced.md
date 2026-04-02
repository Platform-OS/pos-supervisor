# Liquid Filters: Advanced Techniques

Advanced patterns, optimization strategies, and professional techniques for platformOS Liquid filters.

## Advanced Array Operations

### Recursive Flattening with Type Checking
```liquid
{%- assign data = nested_structure | array_flatten -%}
{%- assign types = data | map: 'property' | array_uniq -%}
{%- for type in types -%}
  <h3>{{ type }}</h3>
  {%- assign filtered = data | array_select: 'property', type -%}
  {%- for item in filtered -%}...{%- endfor -%}
{%- endfor -%}
```

### Multi-Level Filtering Pipeline
```liquid
{%- assign pipeline = products
  | array_select: 'active', true
  | array_reject: 'price', 0
  | array_group_by: 'category'
  | hash_keys -%}
```

### Dynamic Filter Application
```liquid
{%- capture filter_condition -%}{{ filter_field }}{%- endcapture -%}
{%- assign filtered = items | array_select: filter_condition, filter_value -%}
```

## Advanced Hash Operations

### Deep Merge with Default Preservation
```liquid
{%- assign defaults = config | hash_keys -%}
{%- assign merged = defaults | hash_merge: user_config -%}
{%- for key in defaults -%}
  {%- if key in merged -%}
    {%- assign value = merged | hash_dig: key -%}
  {%- else -%}
    {%- assign value = config | hash_dig: key -%}
  {%- endif -%}
{%- endfor -%}
```

### Nested Hash Extraction with Fallback
```liquid
{%- assign path = 'user.profile.address.city' | split: '.' -%}
{%- assign value = data -%}
{%- for part in path -%}
  {%- assign value = value | hash_dig: part -%}
  {%- if value == nil -%}
    {%- break -%}
  {%- endif -%}
{%- endfor -%}
```

### Building Complex Configuration Objects
```liquid
{%- assign base = base_config -%}
{%- assign user = user_config -%}
{%- assign feature = feature_config -%}
{%- assign final = base | hash_merge: user | hash_merge: feature -%}
```

## Advanced Date/Time Operations

### Timezone-Aware Date Handling
```liquid
{%- assign user_tz = context.location.timezone | default: 'UTC' -%}
{%- assign local_date = timestamp | localize: 'full' -%}
{%- assign offset_date = timestamp | add_to_time: user_tz_offset, 'seconds' -%}
```

### Date Range Calculations
```liquid
{%- assign start_date = 'now' | add_to_time: -30, 'days' -%}
{%- assign end_date = 'now' -%}
{%- assign days_elapsed = start_date | time_diff: end_date | divided_by: 86400 -%}
{%- assign week_number = start_date | strftime: '%V' -%}
```

### Recurring Event Calculations
```liquid
{%- assign event_date = '2025-01-15' -%}
{%- assign interval = 7 -%}
{%- assign next_occurrence = event_date | add_to_time: interval, 'days' -%}
{%- assign days_until = next_occurrence | time_diff: 'now' | divided_by: 86400 -%}
```

## Advanced String Processing

### Conditional Markdown Rendering
```liquid
{%- if content_type == 'markdown' -%}
  {%- assign rendered = content | markdown: 'extended' -%}
{%- elsif content_type == 'html' -%}
  {%- assign rendered = content -%}
{%- else -%}
  {%- assign rendered = content | replace_regex: '\n', '<br>' -%}
{%- endif -%}
```

### Pattern-Based Text Transformation
```liquid
{%- assign phone = input | replace_regex: '[^\d]', '' -%}
{%- assign formatted = phone | replace_regex: '(\d{3})(\d{3})(\d{4})', '($1) $2-$3' -%}
```

### URL-Safe String Generation
```liquid
{%- assign safe_name = user.name | slugify -%}
{%- assign safe_email = user.email | downcase | slugify -%}
{%- assign unique_id = safe_name | append: '-' | append: timestamp | slugify -%}
```

## Advanced JSON Operations

### Conditional JSON Building
```liquid
{%- assign data = { "id": user.id, "name": user.name, "meta": user.metadata } -%}
{%- if user.email -%}
  {%- assign data["email"] = user.email -%}
{%- endif -%}
{%- if user.phone -%}
  {%- assign data["phone"] = user.phone -%}
{%- endif -%}
```

### JSON Schema Validation Pattern
```liquid
{%- assign data = input | parse_json -%}
{%- assign has_id = data | hash_dig: 'id' -%}
{%- assign has_name = data | hash_dig: 'name' -%}
{%- if has_id and has_name -%}
  Valid object
{%- else -%}
  Missing required fields
{%- endif -%}
```

### Large Dataset Serialization
```liquid
{%- assign page_size = 100 -%}
{%- assign total_pages = items | size | divided_by: page_size | ceil -%}
{%- for page in (1..total_pages) -%}
  {%- assign offset = page | minus: 1 | times: page_size -%}
  {%- assign page_data = items | array_first: page_size | json -%}
{%- endfor -%}
```

## Advanced Security Patterns

### Encrypted Session Management
```liquid
{%- assign session_data = user_id | append: ':' | append: 'now' -%}
{%- assign session_hash = session_data | hmac_sha256: context.constants.session_key -%}
{%- assign encrypted_session = session_data | encrypt: context.constants.session_key -%}
```

### JWT with Custom Claims
```liquid
{%- assign iat_time = 'now' | strftime: '%s' -%}
{%- assign exp_time = 'now' | add_to_time: 24, 'hours' | strftime: '%s' -%}
{%- assign payload = { "sub": user.id, "email": user.email, "iat": iat_time, "exp": exp_time, "admin": user.is_admin } -%}
{%- assign token = payload | jwt_encode: context.constants.jwt_secret -%}
```

### Data Integrity Verification
```liquid
{%- assign original_data = data | json -%}
{%- assign signature = original_data | hmac_sha256: secret -%}
{%- assign stored_signature = stored_sig -%}
{%- if signature == stored_signature -%}
  Data verified
{%- else -%}
  Data tampered with
{%- endif -%}
```

## Advanced Type Handling

### Polymorphic Type Routing
```liquid
{%- assign type = value | type_of -%}
{%- case type -%}
  {%- when 'array' -%}
    {%- assign result = value | array_sort_by: 'name' -%}
  {%- when 'hash' -%}
    {%- assign result = value | hash_keys -%}
  {%- when 'string' -%}
    {%- assign result = value | upcase -%}
  {%- else -%}
    {%- assign result = value -%}
{%- endcase -%}
```

### Safe Type Conversion
```liquid
{%- assign value = input -%}
{%- assign type = value | type_of -%}
{%- if type == 'string' -%}
  {%- if value | is_json_valid -%}
    {%- assign value = value | parse_json -%}
  {%- endif -%}
{%- endif -%}
```

## Performance Optimization

### Caching Filter Results
```liquid
{%- unless cached_result -%}
  {%- assign expensive_operation = large_array
    | array_sort_by: 'score'
    | array_group_by: 'category' -%}
  {%- assign cached_result = expensive_operation -%}
{%- endunless -%}
{%- assign result = cached_result -%}
```

### Lazy Evaluation Pattern
```liquid
{%- capture process_data -%}
  {%- if should_process -%}
    {%- assign processed = data
      | parse_json
      | hash_merge: defaults
      | json -%}
  {%- endif -%}
{%- endcapture -%}
```

### Batch Processing
```liquid
{%- assign batch_size = 50 -%}
{%- assign total = items | size -%}
{%- assign batches = total | divided_by: batch_size | ceil -%}
{%- for i in (0..batches) -%}
  {%- assign start = i | times: batch_size -%}
  {%- capture batch -%}{{ items | array_first: batch_size }}{%- endcapture -%}
{%- endfor -%}
```

## Debugging Advanced Filters

### Type Inspection Helper
```liquid
{%- assign var_type = variable | type_of -%}
<debug>{{ variable | inspect }} (type: {{ var_type }})</debug>
```

### Filter Chain Debugging
```liquid
{%- assign step1 = data | parse_json -%}
<debug>step1: {{ step1 | inspect }}</debug>
{%- assign step2 = step1 | hash_merge: defaults -%}
<debug>step2: {{ step2 | inspect }}</debug>
{%- assign step3 = step2 | json -%}
<debug>step3: {{ step3 | inspect }}</debug>
```

## See Also

- [Filter Configuration](configuration.md)
- [Filter API Reference](api.md)
- [Filter Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
