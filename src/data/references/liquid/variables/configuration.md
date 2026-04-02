# Liquid Variables: Configuration

Configuration and setup for variables in platformOS Liquid templates.

## Overview

platformOS Liquid variables handle data assignment, capture, parsing, and sharing across templates. Variables have limited scope within partials and must be explicitly shared using exports or return statements.

## Variable Declaration Methods

### assign Tag
The basic variable assignment:
```liquid
{%- assign name = 'John' -%}
{%- assign count = 10 -%}
{%- assign items = array -%}
{%- assign product = hash -%}
```

Reassignment is allowed:
```liquid
{%- assign value = 'initial' -%}
{%- assign value = 'updated' -%}
```

### capture Tag
Capture multi-line content as string:
```liquid
{%- capture greeting -%}
  Hello, {{ name }}!
  Welcome to our site.
{%- endcapture -%}
```

Strips whitespace automatically in platformOS.

### Hash/Array Literals
Assign hash or array directly (replaces the deprecated `parse_json` tag):
```liquid
{%- assign data = { "name": "John", "age": 30, "active": true } -%}
```

### Hash Key Assignment
Assign value to hash key (replaces the deprecated `hash_assign` tag):
```liquid
{%- assign my_hash['key'] = value -%}
{%- assign my_hash['nested']['key'] = value -%}
```

### increment/decrement
Auto-increment or decrement numeric variables:
```liquid
{%- increment page_views -%}
{%- decrement countdown -%}
```

Creates variable if doesn't exist (starts at 0).

## Variable Scope

### Local Variable Scope
Variables are local to current template:
```liquid
{%- assign message = 'Local to this template' -%}
```

### Partial Scope
Variables don't cross partial boundaries:
```liquid
{%- comment %} In parent {%- endcomment %}
{%- assign parent_var = 'value' -%}
{%- include_partial 'child' -%}
{%- comment %} parent_var NOT available in child {%- endcomment %}
```

### Nested Loop Scope
Loop variables accessible within loop:
```liquid
{%- for item in items -%}
  {%- assign current = item -%}
  {%- comment %} current only available here {%- endcomment %}
{%- endfor -%}
{%- comment %} current still exists but last value {%- endcomment %}
```

## Sharing Variables Across Boundaries

### Export Method
Share from partial/layout to parent:
```liquid
{%- comment %} In partial {%- endcomment %}
{%- assign user_data = user -%}
{%- export user = user_data -%}

{%- comment %} In parent {%- endcomment %}
{%- include_partial 'child' -%}
{{ context.exports.user.name }}
```

### Return Method
Return value from partial function:
```liquid
{%- comment %} In partial {%- endcomment %}
{%- return calculation_result -%}

{%- comment %} In parent {%- endcomment %}
{%- include_partial 'calculator', args: x: 5, y: 10 -%}
{%- assign result = context.exports -%}
```

### Parameters Method
Pass data into partial:
```liquid
{%- comment %} In parent {%- endcomment %}
{%- include_partial 'display', product: my_product, show_price: true -%}

{%- comment %} In partial - automatically available {%- endcomment %}
{{ product.name }}
{{ show_price }}
```

## JSON and Data Types

### Hash Literals
Create objects directly with hash literals (replaces the deprecated `parse_json` tag):
```liquid
{%- assign config = {
  "api": {
    "endpoint": "https://api.example.com",
    "version": "v2"
  },
  "cache": true
} -%}

{{ config.api.endpoint }}
{{ config.cache }}
```

### Hash Literals with Variables
Build hashes with direct variable references:
```liquid
{%- assign parsed = { "user_id": user.id, "timestamp": 'now', "data": data_object } -%}
```

Use hash literals with variable references instead of JSON string interpolation.

## Variable Naming Conventions

### Recommended Naming
- Use snake_case for variable names
- Use descriptive names: `customer_email` not `ce`
- Prefix booleans with `is_` or `has_`: `is_active`, `has_error`
- Use plural for collections: `users`, `products`

### Examples
```liquid
{%- assign customer_name = user.name -%}
{%- assign is_premium_member = user.subscription_tier == 'premium' -%}
{%- assign total_items = cart.items.size -%}
{%- assign error_message = nil -%}
{%- assign api_response = data -%}
```

## Type Handling

### String Variables
```liquid
{%- assign greeting = 'Hello' -%}
{%- assign message = "World" -%}
{%- assign computed = 'Hello ' | append: 'World' -%}
```

### Number Variables
```liquid
{%- assign count = 42 -%}
{%- assign price = 19.99 -%}
{%- assign result = 10 | plus: 5 -%}
```

### Array Variables
```liquid
{%- assign colors = 'red,green,blue' | split: ',' -%}
{%- assign items = page.products -%}
```

### Hash Variables
```liquid
{%- assign user = { "name": "John", "email": "john@example.com" } -%}
```

### Boolean Variables
```liquid
{%- assign is_valid = true -%}
{%- assign show_menu = false -%}
{%- assign has_items = cart.items.size > 0 -%}
```

### Nil Variables
```liquid
{%- assign unset = nil -%}
{%- if unset == nil -%}
  Variable is nil
{%- endif -%}
```

## Best Practices

1. **Always use | json in JSON interpolation** - Prevents syntax errors
2. **Check for nil before use** - Use `default` filter for safety
3. **Use descriptive names** - Makes templates more readable
4. **Capture complex output** - Easier to debug than inline expressions
5. **Export early** - Share data as soon as ready
6. **Keep scope minimal** - Reuse variable names in different scopes
7. **Document complex variables** - Add comments explaining purpose
8. **Use hash/array literals for static data** - More readable than filters (the `parse_json` tag is deprecated)

## Common Patterns

### Safe Variable Assignment
```liquid
{%- assign value = input | default: 'fallback' -%}
{%- assign count = quantity | default: 0 | plus: 0 -%}
```

### Conditional Variable Creation
```liquid
{%- if user -%}
  {%- assign user_name = user.name -%}
{%- else -%}
  {%- assign user_name = 'Guest' -%}
{%- endif -%}
```

### Array Transformation
```liquid
{%- assign product_names = products | map: 'name' -%}
{%- assign prices = products | map: 'price' | sort -%}
```

## See Also

- [Variables API Reference](api.md)
- [Variables Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
