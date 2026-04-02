# Liquid Variables: Patterns & Examples

Common patterns and practical examples for using variables in platformOS Liquid.

## Data Transformation Patterns

### Building Complex Objects
```liquid
{%- assign product_data = {
  "id": 1,
  "name": "Widget Pro",
  "price": 99.99,
  "in_stock": true,
  "specs": {
    "color": "blue",
    "size": "large"
  }
} -%}

{%- assign product = product_data -%}
{{ product.name }} - ${{ product.price }}
```

### Merging Data Sources
```liquid
{%- assign defaults = site_defaults -%}
{%- assign user_prefs = user.preferences -%}
{%- assign config = defaults | hash_merge: user_prefs -%}

Theme: {{ config.theme }}
Language: {{ config.language }}
```

### Transforming Arrays
```liquid
{%- assign product_list = products -%}
{%- assign names_only = product_list | map: 'name' -%}
{%- assign sorted = product_list | array_sort_by: 'price' -%}
{%- assign expensive = sorted | array_reverse | array_first: 5 -%}
```

## Conditional Variable Assignment

### If-Else Pattern
```liquid
{%- if user.premium -%}
  {%- assign discount_rate = 0.20 -%}
  {%- assign support_level = 'priority' -%}
{%- else -%}
  {%- assign discount_rate = 0 -%}
  {%- assign support_level = 'standard' -%}
{%- endif -%}

Discount: {{ discount_rate | times: 100 }}%
Support: {{ support_level }}
```

### Case-When Pattern
```liquid
{%- case user.role -%}
  {%- when 'admin' -%}
    {%- assign privileges = 'full' -%}
    {%- assign color = 'red' -%}
  {%- when 'moderator' -%}
    {%- assign privileges = 'moderate' -%}
    {%- assign color = 'orange' -%}
  {%- when 'user' -%}
    {%- assign privileges = 'limited' -%}
    {%- assign color = 'blue' -%}
  {%- else -%}
    {%- assign privileges = 'none' -%}
    {%- assign color = 'gray' -%}
{%- endcase -%}
```

### Using assign in Loops
```liquid
{%- assign max_price = 0 -%}
{%- for product in products -%}
  {%- if product.price > max_price -%}
    {%- assign max_price = product.price -%}
    {%- assign most_expensive = product -%}
  {%- endif -%}
{%- endfor -%}

Most Expensive: {{ most_expensive.name }} at ${{ max_price }}
```

## String Manipulation Patterns

### Building URLs
```liquid
{%- assign base_url = '/products' -%}
{%- assign slug = product.name | slugify -%}
{%- assign product_url = base_url | append: '/' | append: slug -%}

<a href="{{ product_url }}">{{ product.name }}</a>
```

### Capturing Formatted Output
```liquid
{%- capture formatted_date -%}
  {{ product.created_at | strftime: '%B %d, %Y' }}
{%- endcapture -%}

<p>Added on {{ formatted_date }}</p>
```

### Multi-Line String Building
```liquid
{%- capture email_body -%}
Dear {{ user.name }},

Thank you for your purchase of {{ order.total | pricify }}.

Your order includes:
{%- for item in order.items -%}
  - {{ item.name }} (Qty: {{ item.quantity }})
{%- endfor -%}

Best regards,
The Team
{%- endcapture -%}

{{ email_body }}
```

## Loop Counter Patterns

### Counting Items
```liquid
{%- assign item_count = 0 -%}
{%- for item in items -%}
  {%- if item.active -%}
    {%- assign item_count = item_count | plus: 1 -%}
  {%- endif -%}
{%- endfor -%}

Active items: {{ item_count }}
```

### Using increment in Loops
```liquid
{%- for product in products -%}
  <div class="product-{{ increment product_num }}">
    {{ product.name }}
  </div>
{%- endfor -%}
```

### Accumulating Totals
```liquid
{%- assign total_spent = 0 -%}
{%- assign total_items = 0 -%}

{%- for order in orders -%}
  {%- assign total_spent = total_spent | plus: order.amount -%}
  {%- assign total_items = total_items | plus: order.items.size -%}
{%- endfor -%}

Total Spent: ${{ total_spent | divided_by: 100 }}
Items Purchased: {{ total_items }}
```

## JSON Handling Patterns

### Static Configuration
```liquid
{%- assign app_config = {
  "api_endpoint": "https://api.example.com",
  "timeout": 30000,
  "retry": {
    "max_attempts": 3,
    "backoff": "exponential"
  },
  "features": ["auth", "logging", "caching"]
} -%}

API: {{ app_config.api_endpoint }}
Timeout: {{ app_config.timeout }}ms
```

### Parsing User Input
```liquid
{%- if metadata_json | is_json_valid -%}
  {%- assign metadata = metadata_json | parse_json -%}
  <p>Metadata: {{ metadata | json }}</p>
{%- else -%}
  <p>Invalid metadata format</p>
{%- endif -%}
```

### Converting Objects to JSON
```liquid
{%- assign user_data = user -%}
{%- capture json_export -%}
{
  "id": {{ user_data.id | json }},
  "name": {{ user_data.name | json }},
  "email": {{ user_data.email | json }},
  "tags": {{ user_data.tags | json }}
}
{%- endcapture -%}

<script>
  var user = {{ json_export | parse_json | json }};
</script>
```

## Partial Communication Patterns

### Passing Parameters to Partial
```liquid
{%- comment %} Parent template {%- endcomment %}
{%- assign button_text = 'Click Me' -%}
{%- assign button_url = '/action' -%}
{%- assign button_style = 'primary' -%}

{%- include_partial 'button',
  text: button_text,
  url: button_url,
  style: button_style -%}

{%- comment %} Child partial - parameters auto-available {%- endcomment %}
<a href="{{ url }}" class="btn btn-{{ style }}">{{ text }}</a>
```

### Exporting Results from Partial
```liquid
{%- comment %} Parent {%- endcomment %}
{%- include_partial 'user_profile' -%}
{%- assign user = context.exports.user -%}

<div>{{ user.name }} - {{ user.email }}</div>

{%- comment %} Partial {%- endcomment %}
{%- assign user = context.exports.user -%}
{%- export user = user -%}
```

### Returning Calculations
```liquid
{%- comment %} Parent {%- endcomment %}
{%- include_partial 'calculate_discount', amount: 100, tier: 'gold' -%}
{%- assign discount = context.exports -%}

<p>You save: ${{ discount }}</p>

{%- comment %} Partial {%- endcomment %}
{%- assign multiplier = 0.10 -%}
{%- case tier -%}
  {%- when 'gold' -%}
    {%- assign multiplier = 0.15 -%}
  {%- when 'platinum' -%}
    {%- assign multiplier = 0.20 -%}
{%- endcase -%}
{%- assign result = amount | times: multiplier -%}
{%- return result -%}
```

## Safe Variable Access Patterns

### Null-Safe Navigation
```liquid
{%- assign user_email = user.profile.contact.email | default: 'unknown' -%}
{%- assign user_age = user.profile.personal.age | default: 0 | plus: 0 -%}
```

### Type-Safe Defaults
```liquid
{%- assign items = collection | default: [] -%}
{%- assign config = settings | default: {} -%}
{%- assign count = value | default: 0 | plus: 0 -%}
```

### Validating Before Use
```liquid
{%- if item and item.valid -%}
  {%- assign validated_item = item -%}
{%- else -%}
  {%- assign validated_item = nil -%}
{%- endif -%}
```

## Performance Optimization Patterns

### Caching Expensive Operations
```liquid
{%- unless cached_results -%}
  {%- assign expensive = products | array_sort_by: 'popularity' -%}
  {%- assign cached_results = expensive -%}
{%- endunless -%}

{%- assign results = cached_results -%}
```

### Lazy Evaluation
```liquid
{%- if needs_details -%}
  {%- assign detailed_data = expensive_query -%}
{%- else -%}
  {%- assign detailed_data = nil -%}
{%- endif -%}
```

## See Also

- [Variables Configuration](configuration.md)
- [Variables API Reference](api.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
