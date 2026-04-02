# Liquid Variables: API Reference

Complete API reference for variable operations in platformOS Liquid.

## assign Tag API

### Basic Assignment
```liquid
{%- assign name = value -%}
```

Assigns value to variable. Overwrites previous value if exists.

### String Assignment
```liquid
{%- assign greeting = 'Hello World' -%}
{%- assign message = "Welcome" -%}
```

Both single and double quotes supported.

### Number Assignment
```liquid
{%- assign count = 42 -%}
{%- assign ratio = 3.14159 -%}
```

### Expression Assignment
```liquid
{%- assign result = value1 | filter1 | filter2 -%}
{%- assign total = product.price | times: quantity -%}
{%- assign text = greeting | append: name | upcase -%}
```

Expressions evaluated before assignment.

### Array Assignment
```liquid
{%- assign colors = 'red,green,blue' | split: ',' -%}
{%- assign items = collection -%}
```

### Hash Assignment
```liquid
{%- assign user = page.users | first -%}
{%- assign config = default_config | hash_merge: overrides -%}
```

## capture Tag API

### Basic Capture
```liquid
{%- capture output -%}
  Content here
  Multiple lines
{%- endcapture -%}
```

Captures content as string, strips surrounding whitespace.

### Capture with Variables
```liquid
{%- capture message -%}
  Hello {{ user.name }}!
  You have {{ items.size }} items.
{%- endcapture -%}
```

Interpolations processed during capture.

### Capture with Logic
```liquid
{%- capture status -%}
  {%- if user.active -%}
    Active
  {%- else -%}
    Inactive
  {%- endif -%}
{%- endcapture -%}
```

Full Liquid syntax available inside capture.

### Nested Captures
```liquid
{%- capture inner -%}
  Inner content
{%- endcapture -%}
{%- capture outer -%}
  Outer {{ inner }} nested
{%- endcapture -%}
```

Captured variables accessible within next capture.

## Hash/Array Literal Assignment API

> **Note:** The `parse_json` tag is deprecated. Use `assign` with hash/array literals instead.

### Static Hash
```liquid
{%- assign data = { "name": "John", "age": 30, "active": true, "tags": ["admin", "user"] } -%}
```

Creates object from hash literal.

### Nested Hash Objects
```liquid
{%- assign config = {
  "database": {
    "host": "localhost",
    "port": 5432,
    "credentials": {
      "user": "admin",
      "password": "secret"
    }
  },
  "cache": {
    "ttl": 3600,
    "enabled": true
  }
} -%}

{{ config.database.host }}
{{ config.database.credentials.user }}
{{ config.cache.ttl }}
```

### Array Literal
```liquid
{%- assign colors = ["red", "green", "blue", "yellow"] -%}

{%- for color in colors -%}
  <p>{{ color }}</p>
{%- endfor -%}
```

### Array of Objects
```liquid
{%- assign users = [
  { "id": 1, "name": "Alice", "role": "admin" },
  { "id": 2, "name": "Bob", "role": "user" },
  { "id": 3, "name": "Carol", "role": "moderator" }
] -%}
```

## parse_json Filter API

### Basic Parse Filter
```liquid
{%- assign data = json_string | parse_json -%}
```

Parses JSON string to object/array.

### With Validation
```liquid
{%- if json_string | is_json_valid -%}
  {%- assign data = json_string | parse_json -%}
{%- endif -%}
```

### Building Hashes with Variables
```liquid
{%- assign parsed = { "user_id": user.id, "name": user.name, "email": user.email, "created": user.created_at } -%}
```

Use hash literals with direct variable references instead of JSON string interpolation.

### Chained Parsing
```liquid
{%- assign data = raw_json | parse_json -%}
{%- assign specific = data | hash_dig: 'settings', 'theme' -%}
```

## Hash Key Assignment API

> **Note:** The `hash_assign` tag is deprecated. Use `assign` with bracket notation instead.

### Basic Hash Assignment
```liquid
{%- assign my_hash['key'] = value -%}
```

Assigns value to hash key. Creates hash if doesn't exist.

### Nested Hash Assignment
```liquid
{%- assign user['profile']['address']['city'] = 'New York' -%}
```

Creates nested structure if needed.

### Hash Assignment from Variables
```liquid
{%- assign new_value = 'updated' -%}
{%- assign config['setting'] = new_value -%}
```

### Multiple Assignments
```liquid
{%- assign user['name'] = 'John' -%}
{%- assign user['email'] = 'john@example.com' -%}
{%- assign user['active'] = true -%}
```

## increment/decrement API

### increment Tag
```liquid
{%- increment counter -%}
{%- increment page_views -%}
{%- increment total_sales -%}
```

Auto-increments variable by 1. Creates if doesn't exist (starts at 0).

Returns the new value. Persists across template.

### decrement Tag
```liquid
{%- decrement countdown -%}
{%- decrement remaining_slots -%}
```

Auto-decrements variable by 1. Creates if doesn't exist (starts at 0).

### Loop Counter
```liquid
{%- for item in items -%}
  Item {{ increment loop_counter }}: {{ item }}
{%- endfor -%}
```

Creates item counter.

### Resetting Counters
```liquid
{%- assign counter = 0 -%}
{%- for item in items -%}
  {%- assign counter = counter | plus: 1 -%}
  Item {{ counter }}: {{ item }}
{%- endfor -%}
```

Reset using assign.

## json Filter API

### Converting to JSON
```liquid
{{ object | json }}
{{ array | json }}
{{ hash | json }}
```

Converts variable to JSON string representation.

### In HTML Attributes
```liquid
<script>
  var data = {{ object | json }};
</script>
```

Always use in script blocks to ensure valid JSON.

### In Data Attributes
```liquid
<div data-config='{{ config | json }}'>
  Content
</div>
```

Escapes quotes properly for HTML.

## export API

### Exporting Variables
```liquid
{%- export user = current_user -%}
{%- export products = filtered_products -%}
{%- export metadata = page_metadata -%}
```

Makes variable available in context.exports to parent template.

### Multiple Exports
```liquid
{%- export user = current_user -%}
{%- export admin = is_admin -%}
{%- export message = success_message -%}
```

### Accessing Exported Data
```liquid
{%- comment %} In parent template {%- endcomment %}
{{ context.exports.user.name }}
{{ context.exports.admin }}
{{ context.exports.message }}
```

## return API

### Returning from Partial
```liquid
{%- return result_value -%}
```

Returns value from partial to parent context.exports.

### Return with Data
```liquid
{%- assign calculated = input | plus: 100 -%}
{%- return calculated -%}
```

## Variable Access Patterns

### Accessing Array Elements
```liquid
{{ items[0] }}
{{ items[1] }}
{{ items[array_index] }}
```

### Accessing Hash Properties
```liquid
{{ user.name }}
{{ user['email'] }}
{{ user[dynamic_key] }}
```

### Safe Access with default
```liquid
{{ user.email | default: 'no-email' }}
{{ items[0] | default: {} }}
```

## See Also

- [Variables Configuration](configuration.md)
- [Variables Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
