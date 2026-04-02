# Liquid Variables: Advanced Techniques

Advanced patterns, optimization strategies, and professional techniques for platformOS Liquid variables.

## Advanced Data Structure Patterns

### Building Immutable Copies
```liquid
{%- assign original = source_data -%}
{%- assign copy = original | deep_clone -%}
{%- assign copy['modified'] = true -%}
{%- comment %} original unchanged, copy modified {%- endcomment %}
```

### Complex Object Construction
```liquid
{%- assign user_profile = {
  "id": 123,
  "personal": {
    "name": "John Doe",
    "age": 30,
    "contact": {
      "email": "john@example.com",
      "phone": "+1-555-0100"
    }
  },
  "settings": {
    "theme": "dark",
    "notifications": true,
    "privacy": {
      "show_email": false,
      "show_phone": false
    }
  }
} -%}

{%- assign email = user_profile | hash_dig: 'personal', 'contact', 'email' -%}
{%- assign theme = user_profile | hash_dig: 'settings', 'theme' -%}
```

### Dynamic Nested Assignment
```liquid
{%- assign path = 'config.database.host' | split: '.' -%}
{%- assign current = root -%}

{%- for key in path -%}
  {%- if forloop.last -%}
    {%- assign current[key] = 'localhost' -%}
  {%- else -%}
    {%- assign current = current[key] -%}
  {%- endif -%}
{%- endfor -%}
```

## Advanced Capture Patterns

### Capturing Complex HTML
```liquid
{%- capture card_html -%}
  <div class="card">
    <div class="card-header">
      <h3>{{ title }}</h3>
    </div>
    <div class="card-body">
      {%- for item in items -%}
        <p>{{ item }}</p>
      {%- endfor -%}
    </div>
    <div class="card-footer">
      <button>{{ button_text }}</button>
    </div>
  </div>
{%- endcapture -%}

{{ card_html }}
```

### Capturing with Conditional Logic
```liquid
{%- capture email_content -%}
  <h1>{{ greeting }}</h1>

  {%- if user.premium -%}
    <p>Thank you for your premium subscription!</p>
    <p>Your monthly allowance: {{ user.monthly_quota }}</p>
  {%- else -%}
    <p>Upgrade to premium for unlimited access.</p>
  {%- endif -%}

  {%- if pending_actions.size > 0 -%}
    <h2>Pending Actions:</h2>
    <ul>
    {%- for action in pending_actions -%}
      <li>{{ action }}</li>
    {%- endfor -%}
    </ul>
  {%- endif -%}
{%- endcapture -%}
```

## Advanced JSON Patterns

### Building Dynamic JSON
```liquid
{%- capture dynamic_json -%}
{
  "timestamp": {{ 'now' | strftime: '%s' | json }},
  "user": {
    "id": {{ user.id | json }},
    "name": {{ user.name | json }},
    "email": {{ user.email | json }}
  },
  "items": {{ items | json }},
  "metadata": {
    "total_items": {{ items.size | json }},
    "generated_at": {{ 'now' | iso8601 | json }}
  }
}
{%- endcapture -%}

{%- assign data = dynamic_json | parse_json -%}
```

### JSON Transformation Pipeline
```liquid
{%- capture raw_json -%}
{{ raw_data | json }}
{%- endcapture -%}

{%- assign parsed = raw_json | parse_json -%}
{%- assign transformed = parsed | hash_merge: additional_data -%}
{%- assign enriched = transformed -%}
{%- assign enriched['processed'] = true -%}
{%- assign enriched['processed_at'] = 'now' -%}

{{ enriched | json }}
```

### Schema Validation with JSON
```liquid
{%- capture schema -%}
{
  "type": "object",
  "required": ["id", "name", "email"],
  "properties": {
    "id": { "type": "number" },
    "name": { "type": "string" },
    "email": { "type": "string" }
  }
}
{%- endcapture -%}

{%- assign schema_obj = schema | parse_json -%}
{%- assign required_fields = schema_obj | hash_dig: 'required' -%}

{%- assign is_valid = true -%}
{%- for field in required_fields -%}
  {%- unless data[field] -%}
    {%- assign is_valid = false -%}
  {%- endunless -%}
{%- endfor -%}
```

## Advanced Partial Communication

### Two-Way Data Sharing
```liquid
{%- comment %} Parent {%- endcomment %}
{%- assign input_data = { "query": "test", "limit": 10 } -%}
{%- include_partial 'processor', input: input_data -%}
{%- assign result = context.exports.result -%}

{%- comment %} Partial {%- endcomment %}
{%- assign processed = input | hash_merge: { "processed": true } -%}
{%- export result = processed -%}
```

### Recursive Partial with Accumulation
```liquid
{%- comment %} Process nested structure {%- endcomment %}
{%- assign accumulator = '' | split: '' | first -%}

{%- for item in items -%}
  {%- include_partial 'process_item', data: item, acc: accumulator -%}
  {%- assign accumulator = context.exports.accumulated -%}
{%- endfor -%}
```

### Chained Partial Transformations
```liquid
{%- comment %} Data flows through multiple partials {%- endcomment %}
{%- include_partial 'validate', input: raw_data -%}
{%- assign validated = context.exports.data -%}

{%- include_partial 'transform', input: validated -%}
{%- assign transformed = context.exports.data -%}

{%- include_partial 'enrich', input: transformed -%}
{%- assign final = context.exports.data -%}
```

## Advanced Counter Patterns

### Multi-Counter Tracking
```liquid
{%- assign total = 0 -%}
{%- assign active_count = 0 -%}
{%- assign error_count = 0 -%}

{%- for item in items -%}
  {%- assign total = total | plus: 1 -%}

  {%- if item.active -%}
    {%- assign active_count = active_count | plus: 1 -%}
  {%- endif -%}

  {%- if item.error -%}
    {%- assign error_count = error_count | plus: 1 -%}
  {%- endif -%}
{%- endfor -%}

Total: {{ total }}, Active: {{ active_count }}, Errors: {{ error_count }}
```

### Using increment for Loop Index
```liquid
{%- assign index_base = 0 -%}
{%- for page in pages -%}
  <div class="page-{{ increment page_counter }}">
    {%- assign actual_index = page_counter | plus: index_base -%}
    Page {{ actual_index }}: {{ page.title }}
  </div>
{%- endfor -%}
```

## Advanced Type Handling

### Polymorphic Type Processing
```liquid
{%- assign value_type = source_value | type_of -%}

{%- case value_type -%}
  {%- when 'string' -%}
    {%- assign processed = source_value | upcase -%}
  {%- when 'array' -%}
    {%- assign processed = source_value | array_sort_by: 'name' -%}
  {%- when 'hash' -%}
    {%- assign processed = source_value | hash_keys -%}
  {%- when 'number' -%}
    {%- assign processed = source_value | times: 2 -%}
  {%- else -%}
    {%- assign processed = source_value -%}
{%- endcase -%}
```

### Safe Type Coercion
```liquid
{%- assign raw = user_input -%}
{%- assign type = raw | type_of -%}

{%- if type == 'string' -%}
  {%- if raw | is_json_valid -%}
    {%- assign coerced = raw | parse_json -%}
  {%- else -%}
    {%- assign coerced = raw | split: ',' -%}
  {%- endif -%}
{%- else -%}
  {%- assign coerced = raw -%}
{%- endif -%}
```

## Performance Optimization Patterns

### Lazy Evaluation of Variables
```liquid
{%- assign needs_calculation = true -%}

{%- if needs_calculation -%}
  {%- assign expensive_result = nil -%}
  {%- comment %} Only calculate if needed {%- endcomment %}
  {%- if should_process -%}
    {%- assign expensive_result = compute_expensive_value -%}
  {%- endif -%}
{%- endif -%}
```

### Variable Memoization
```liquid
{%- unless cached_computations -%}
  {%- assign cached_computations = {} -%}

  {%- for key in computation_keys -%}
    {%- assign value = expensive_computation[key] -%}
    {%- assign cached_computations[key] = value -%}
  {%- endfor -%}
{%- endunless -%}

{%- assign result = cached_computations[lookup_key] -%}
```

### Streaming Variable Assignment
```liquid
{%- assign page = context.params.page | default: 1 | plus: 0 -%}
{%- assign per_page = 20 -%}
{%- assign offset = page | minus: 1 | times: per_page -%}

{%- comment %} Only fetch needed items {%- endcomment %}
{%- if items.size > offset -%}
  {%- assign page_items = items | array_first: per_page -%}
{%- else -%}
  {%- assign page_items = '' | split: '' -%}
{%- endif -%}
```

## Error Handling in Variables

### Defensive Variable Assignment
```liquid
{%- assign value = input | default: nil -%}
{%- unless value -%}
  {%- assign value = fallback_calculation -%}
{%- endunless -%}
{%- unless value -%}
  {%- assign value = ultimate_fallback -%}
{%- endunless -%}
```

### Exception-Like Error Handling
```liquid
{%- assign error = nil -%}
{%- assign result = nil -%}

{%- if data | is_json_valid -%}
  {%- assign parsed = data | parse_json -%}
  {%- if parsed -%}
    {%- assign result = parsed -%}
  {%- else -%}
    {%- assign error = 'Failed to parse JSON' -%}
  {%- endif -%}
{%- else -%}
  {%- assign error = 'Invalid JSON format' -%}
{%- endif -%}

{%- if error -%}
  <error>{{ error }}</error>
{%- else -%}
  <success>{{ result | json }}</success>
{%- endif -%}
```

## See Also

- [Variables Configuration](configuration.md)
- [Variables API Reference](api.md)
- [Variables Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
