# Liquid Flow Control: Patterns & Examples

Common patterns and practical examples for control flow in platformOS Liquid.

## Authentication Patterns

### Login Status Check
```liquid
{%- if context.exports.user -%}
  <p>Welcome, {{ context.exports.user.name }}!</p>
  <a href="/logout">Logout</a>
{%- else -%}
  <p>Please log in to continue</p>
  <a href="/login">Login</a>
{%- endif -%}
```

### Permission-Based Content
```liquid
{%- assign user = context.exports.user -%}
{%- if user and user.is_admin -%}
  <a href="/admin">Admin Panel</a>
{%- elsif user and user.is_moderator -%}
  <a href="/moderation">Moderation Tools</a>
{%- else -%}
  <a href="/account">My Account</a>
{%- endif -%}
```

### Subscription Status Check
```liquid
{%- if user.subscription_active and user.subscription_type == 'premium' -%}
  <p>Premium Features Enabled</p>
{%- elsif user.subscription_active -%}
  <p>Standard Features</p>
{%- else -%}
  <p>Upgrade to access all features</p>
{%- endif -%}
```

## Data Validation Patterns

### Null Safety
```liquid
{%- if product and product.price and product.price > 0 -%}
  <p>Price: ${{ product.price }}</p>
{%- else -%}
  <p>Price not available</p>
{%- endif -%}
```

### String Validation
```liquid
{%- if email != nil and email != '' and email contains '@' -%}
  <p>Email: {{ email }}</p>
{%- else -%}
  <p>Invalid email</p>
{%- endif -%}
```

### Collection Validation
```liquid
{%- if items and items.size > 0 -%}
  {%- for item in items -%}
    <p>{{ item.name }}</p>
  {%- endfor -%}
{%- else -%}
  <p>No items available</p>
{%- endif -%}
```

## Status and State Patterns

### Status Enum Handling
```liquid
{%- case order.status -%}
  {%- when 'pending' -%}
    <span class="badge pending">Pending</span>
  {%- when 'processing' -%}
    <span class="badge processing">Processing</span>
  {%- when 'shipped' -%}
    <span class="badge shipped">Shipped</span>
  {%- when 'delivered' -%}
    <span class="badge delivered">Delivered</span>
  {%- when 'cancelled' -%}
    <span class="badge cancelled">Cancelled</span>
  {%- else -%}
    <span class="badge unknown">Unknown</span>
{%- endcase -%}
```

### State Machine Pattern
```liquid
{%- case workflow_state -%}
  {%- when 'draft' -%}
    <a href="/edit">Edit</a>
    <a href="/publish">Publish</a>
  {%- when 'published' -%}
    <a href="/archive">Archive</a>
    <a href="/edit">Edit</a>
  {%- when 'archived' -%}
    <a href="/restore">Restore</a>
  {%- else -%}
    <p>Unknown state</p>
{%- endcase -%}
```

## Business Logic Patterns

### Discount Calculation
```liquid
{%- assign subtotal = order.subtotal -%}
{%- assign discount = 0 -%}

{%- if user.is_loyal and order.subtotal > 100 -%}
  {%- assign discount = subtotal | times: 0.15 -%}
{%- elsif order.subtotal > 100 -%}
  {%- assign discount = subtotal | times: 0.10 -%}
{%- elsif order.subtotal > 50 -%}
  {%- assign discount = subtotal | times: 0.05 -%}
{%- endif -%}

Original: ${{ subtotal }}
Discount: -${{ discount }}
Total: ${{ subtotal | minus: discount }}
```

### Age-Based Access
```liquid
{%- if user_age and user_age >= 18 -%}
  <p>Access granted</p>
{%- elsif user_age -%}
  <p>You must be 18+ to access this content</p>
{%- else -%}
  <p>Please verify your age</p>
{%- endif -%}
```

### Tier-Based Features
```liquid
{%- case user.plan_tier -%}
  {%- when 'enterprise' -%}
    {%- assign max_users = 1000 -%}
    {%- assign storage_gb = 10000 -%}
    {%- assign api_calls = 10000000 -%}
  {%- when 'professional' -%}
    {%- assign max_users = 100 -%}
    {%- assign storage_gb = 500 -%}
    {%- assign api_calls = 100000 -%}
  {%- when 'basic' -%}
    {%- assign max_users = 10 -%}
    {%- assign storage_gb = 50 -%}
    {%- assign api_calls = 10000 -%}
  {%- else -%}
    {%- assign max_users = 1 -%}
    {%- assign storage_gb = 5 -%}
    {%- assign api_calls = 1000 -%}
{%- endcase -%}
```

## UI Display Patterns

### Conditional Styling
```liquid
<div class="product {% if product.on_sale %}sale{% endif %} {% if product.featured %}featured{% endif %}">
  <h3>{{ product.name }}</h3>
  {%- if product.on_sale -%}
    <span class="badge">Sale</span>
  {%- endif -%}
</div>
```

### Empty State Handling
```liquid
{%- if results.size > 0 -%}
  <div class="search-results">
    {%- for result in results -%}
      <p>{{ result.title }}</p>
    {%- endfor -%}
  </div>
{%- else -%}
  <div class="empty-state">
    <p>No results found for "{{ search_query }}"</p>
    <a href="/browse">Browse all items</a>
  </div>
{%- endif -%}
```

### Loading and Error States
```liquid
{%- if loading -%}
  <div class="spinner">Loading...</div>
{%- elsif error -%}
  <div class="error-message">
    Error: {{ error }}
  </div>
{%- elsif data -%}
  <div class="content">{{ data }}</div>
{%- else -%}
  <div class="empty">No data</div>
{%- endif -%}
```

## Search and Filter Patterns

### Multi-Filter Logic
```liquid
{%- assign filtered_products = all_products -%}

{%- if category -%}
  {%- assign filtered_products = filtered_products | array_select: 'category', category -%}
{%- endif -%}

{%- if price_max -%}
  {%- if filtered_products.size > 0 -%}
    {%- assign price_limit = price_max | plus: 0 -%}
  {%- endif -%}
{%- endif -%}

{%- if filtered_products.size > 0 -%}
  <p>Found {{ filtered_products.size }} products</p>
{%- else -%}
  <p>No products match your filters</p>
{%- endif -%}
```

### Range Checking
```liquid
{%- assign availability = 'unknown' -%}

{%- if stock_level > 10 -%}
  {%- assign availability = 'in-stock' -%}
{%- elsif stock_level > 0 -%}
  {%- assign availability = 'low-stock' -%}
{%- elsif stock_level == 0 -%}
  {%- assign availability = 'out-of-stock' -%}
{%- else -%}
  {%- assign availability = 'invalid' -%}
{%- endif -%}

<p>Status: {{ availability }}</p>
```

## Comparison Patterns

### String Pattern Matching
```liquid
{%- if product.name contains 'Pro' -%}
  <p>Professional edition</p>
{%- elsif product.name contains 'Lite' -%}
  <p>Lite edition</p>
{%- else -%}
  <p>Standard edition</p>
{%- endif -%}
```

### Multiple Condition OR Pattern
```liquid
{%- if status == 'active' or status == 'pending' or status == 'processing' -%}
  <p>Action in progress</p>
{%- elsif status == 'completed' or status == 'delivered' -%}
  <p>Complete</p>
{%- endif -%}
```

### AND Condition Pattern
```liquid
{%- if user.verified and user.email_confirmed and user.phone_confirmed -%}
  <p>Fully verified account</p>
{%- elsif user.verified and user.email_confirmed -%}
  <p>Partially verified</p>
{%- else -%}
  <p>Unverified account</p>
{%- endif -%}
```

## Nested Conditional Patterns

### Hierarchical Access Control
```liquid
{%- if context.exports.user -%}
  {%- if context.exports.user.is_admin -%}
    <p>Full access</p>
  {%- elsif context.exports.user.is_moderator -%}
    <p>Moderation access</p>
  {%- else -%}
    <p>Limited access</p>
  {%- endif -%}
{%- else -%}
  <p>Please log in</p>
{%- endif -%}
```

### Nested Loop with Conditional
```liquid
{%- if categories -%}
  {%- for category in categories -%}
    <h3>{{ category.name }}</h3>
    {%- if category.products and category.products.size > 0 -%}
      {%- for product in category.products -%}
        <p>{{ product.name }}</p>
      {%- endfor -%}
    {%- else -%}
      <p>No products in this category</p>
    {%- endif -%}
  {%- endfor -%}
{%- else -%}
  <p>No categories available</p>
{%- endif -%}
```

## See Also

- [Flow Control Configuration](configuration.md)
- [Flow Control API Reference](api.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
