# Liquid Flow Control: Advanced Techniques

Advanced patterns and professional techniques for platformOS Liquid flow control.

## Advanced Conditional Patterns

### Ternary-Like Pattern
```liquid
{%- assign status = condition and 'approved' or 'pending' -%}
{%- comment %} Not recommended - use if/elsif instead {%- endcomment %}
```

Better approach:
```liquid
{%- if condition -%}
  {%- assign status = 'approved' -%}
{%- else -%}
  {%- assign status = 'pending' -%}
{%- endif -%}
```

### Multi-Level Permission Hierarchy
```liquid
{%- assign permission_level = 'none' -%}

{%- if context.exports.user -%}
  {%- assign permission_level = 'user' -%}

  {%- if context.exports.user.verified -%}
    {%- assign permission_level = 'verified' -%}
  {%- endif -%}

  {%- if context.exports.user.is_moderator -%}
    {%- assign permission_level = 'moderator' -%}
  {%- endif -%}

  {%- if context.exports.user.is_admin -%}
    {%- assign permission_level = 'admin' -%}
  {%- endif -%}
{%- endif -%}

{%- case permission_level -%}
  {%- when 'admin' -%}
    <a href="/admin">Admin</a>
  {%- when 'moderator' -%}
    <a href="/moderate">Moderation</a>
  {%- when 'verified' -%}
    <a href="/account">Account</a>
  {%- when 'user' -%}
    <a href="/profile">Profile</a>
  {%- else -%}
    <a href="/login">Login</a>
{%- endcase -%}
```

### Validation Cascade Pattern
```liquid
{%- assign validation_errors = '' -%}

{%- unless user.name and user.name != '' -%}
  {%- capture validation_errors -%}
{{ validation_errors }}
Name is required
{%- endcapture -%}
{%- endunless -%}

{%- unless user.email and user.email contains '@' -%}
  {%- capture validation_errors -%}
{{ validation_errors }}
Valid email required
{%- endcapture -%}
{%- endunless -%}

{%- unless user.age and user.age >= 18 -%}
  {%- capture validation_errors -%}
{{ validation_errors }}
Must be 18 or older
{%- endcapture -%}
{%- endunless -%}

{%- if validation_errors != '' -%}
  <div class="errors">{{ validation_errors }}</div>
{%- else -%}
  <p>Form is valid</p>
{%- endif -%}
```

## Advanced case Patterns

### Wildcard Pattern with contains
```liquid
{%- assign event_type = 'user.created' -%}

{%- case event_type -%}
  {%- when 'user.created' -%}
    User created event
  {%- when 'user.updated' -%}
    User updated event
  {%- when 'order.completed' -%}
    Order completed event
  {%- else -%}
    {%- if event_type contains 'user.' -%}
      Other user event
    {%- elsif event_type contains 'order.' -%}
      Other order event
    {%- else -%}
      Unknown event
    {%- endif -%}
{%- endcase -%}
```

### Versioning with case
```liquid
{%- case api_version -%}
  {%- when 'v1' -%}
    {%- assign response_format = 'xml' -%}
    {%- assign auth_method = 'basic' -%}
  {%- when 'v2' -%}
    {%- assign response_format = 'json' -%}
    {%- assign auth_method = 'token' -%}
  {%- when 'v3', 'latest' -%}
    {%- assign response_format = 'json' -%}
    {%- assign auth_method = 'oauth' -%}
  {%- else -%}
    {%- assign response_format = 'json' -%}
    {%- assign auth_method = 'oauth' -%}
{%- endcase -%}
```

## Complex Boolean Logic

### De Morgan's Laws Applied
```liquid
{%- comment %} NOT (A AND B) = (NOT A) OR (NOT B) {%- endcomment %}

{%- unless x > 10 and x < 20 -%}
  X is not between 10 and 20
{%- endunless -%}

{%- if x <= 10 or x >= 20 -%}
  X is not between 10 and 20
{%- endif -%}
```

### State Machine with Conditions
```liquid
{%- assign current_state = order.state -%}
{%- assign allowed_transitions = '' -%}

{%- case current_state -%}
  {%- when 'draft' -%}
    {%- unless order.items.size > 0 -%}
      Cannot proceed without items
    {%- endunless -%}

    {%- unless order.customer_email -%}
      Cannot proceed without email
    {%- endunless -%}

    {%- assign allowed_transitions = 'submit' -%}

  {%- when 'submitted' -%}
    {%- unless order.payment_method -%}
      Payment method required
    {%- endunless -%}

    {%- assign allowed_transitions = 'approve,reject' -%}

  {%- when 'approved' -%}
    {%- assign allowed_transitions = 'ship,cancel' -%}

  {%- when 'shipped' -%}
    {%- assign allowed_transitions = 'deliver' -%}
{%- endcase -%}
```

## Nested Loop with Conditional

### Conditional Grouping
```liquid
{%- assign current_category = '' -%}

{%- for product in products -%}
  {%- if product.category != current_category -%}
    {%- if current_category != '' -%}
      </div>
    {%- endif -%}
    <div class="category-{{ product.category }}">
    <h2>{{ product.category }}</h2>
    {%- assign current_category = product.category -%}
  {%- endif -%}

  <p>{{ product.name }}</p>
{%- endfor -%}

{%- if current_category != '' -%}
  </div>
{%- endif -%}
```

### Conditional Index Tracking
```liquid
{%- assign count = 0 -%}
{%- assign filtered_items = '' -%}

{%- for item in items -%}
  {%- if item.active and item.price > 0 -%}
    {%- assign count = count | plus: 1 -%}
    {%- if count <= 10 -%}
      <p>{{ count }}: {{ item.name }}</p>
    {%- endif -%}
  {%- endif -%}
{%- endfor -%}

{%- if count > 10 -%}
  <p>And {{ count | minus: 10 }} more...</p>
{%- endif -%}
```

## Conditional Filter Application

### Dynamic Filtering System
```liquid
{%- assign results = all_items -%}

{%- if filter_status -%}
  {%- assign results = results | array_select: 'status', filter_status -%}
{%- endif -%}

{%- if filter_category -%}
  {%- assign results = results | array_select: 'category', filter_category -%}
{%- endif -%}

{%- if sort_by -%}
  {%- assign results = results | array_sort_by: sort_by -%}
  {%- if sort_order == 'desc' -%}
    {%- assign results = results | array_reverse -%}
  {%- endif -%}
{%- endif -%}

{%- if results.size > 0 -%}
  Results: {{ results.size }}
{%- else -%}
  No matches
{%- endif -%}
```

## Error Handling Patterns

### Graceful Degradation
```liquid
{%- if context.environment.is_production -%}
  {%- if data and data.valid -%}
    {{ data | json }}
  {%- else -%}
    <p>Data unavailable</p>
  {%- endif -%}
{%- else -%}
  {%- comment %} Dev environment - show more details {%- endcomment %}
  {%- if data -%}
    {{ data | inspect }}
  {%- else -%}
    <p>No data provided</p>
  {%- endif -%}
{%- endif -%}
```

### Validation with Recovery
```liquid
{%- assign email = user_input | default: nil -%}
{%- assign email_valid = false -%}

{%- if email -%}
  {%- if email | matches: '^[^@]+@[^@]+\.[^@]+$' -%}
    {%- assign email_valid = true -%}
  {%- endif -%}
{%- endif -%}

{%- if email_valid -%}
  Proceed with {{ email }}
{%- elsif email -%}
  Invalid email: {{ email }}
  <a href="/profile">Edit email</a>
{%- else -%}
  Email required
  <a href="/profile/email">Add email</a>
{%- endif -%}
```

## Performance-Aware Conditionals

### Lazy Evaluation
```liquid
{%- if needs_expensive_computation -%}
  {%- comment %} Only compute if needed {%- endcomment %}
  {%- assign expensive_result = complex_query -%}
{%- else -%}
  {%- assign expensive_result = nil -%}
{%- endif -%}
```

### Early Return Pattern
```liquid
{%- if not context.exports.user -%}
  <p>Login required</p>
{%- else -%}

  {%- if not context.exports.user.verified -%}
    <p>Email verification required</p>
  {%- else -%}

    {%- comment %} Main content only for verified users {%- endcomment %}
    <div class="main-content">
      Content here
    </div>

  {%- endif -%}
{%- endif -%}
```

## Environment-Specific Behavior

### Feature Flags with Conditions
```liquid
{%- assign feature_flags = { "new_checkout": true, "ai_recommendations": false, "social_sharing": true } -%}

{%- if context.environment.is_staging -%}
  {%- assign feature_flags['experimental'] = true -%}
{%- endif -%}

{%- if feature_flags.new_checkout -%}
  {%- include_partial 'checkout_v2' -%}
{%- else -%}
  {%- include_partial 'checkout_v1' -%}
{%- endif -%}

{%- if feature_flags.ai_recommendations -%}
  {%- include_partial 'ai_recommendations' -%}
{%- endif -%}
```

## See Also

- [Flow Control Configuration](configuration.md)
- [Flow Control API Reference](api.md)
- [Flow Control Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
