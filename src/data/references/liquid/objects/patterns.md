# Liquid Objects: Patterns & Examples

Common patterns and practical examples for using platformOS global objects.

## User Authentication Patterns

### Checking User Login Status
```liquid
{%- if context.exports.user -%}
  <p>Welcome, {{ context.exports.user.name }}!</p>
  <a href="/logout">Logout</a>
{%- else -%}
  <p>Please log in</p>
  <a href="/login">Login</a>
{%- endif -%}
```

### Displaying User Profile
```liquid
{%- assign user = context.exports.user -%}
{%- if user -%}
  <div class="profile">
    <h1>{{ user.first_name }} {{ user.last_name }}</h1>
    <p>Email: {{ user.email }}</p>
    {%- if user.phone -%}
      <p>Phone: {{ user.phone }}</p>
    {%- endif -%}
  </div>
{%- endif -%}
```

### Role-Based Content Display
```liquid
{%- if context.exports.user.is_admin -%}
  <a href="/admin/dashboard">Admin Dashboard</a>
{%- elsif context.exports.user.is_staff -%}
  <a href="/staff/tools">Staff Tools</a>
{%- else -%}
  <a href="/user/profile">My Profile</a>
{%- endif -%}
```

## Parameter Handling Patterns

### Safe Parameter Access
```liquid
{%- assign page = context.params.page | default: 1 -%}
{%- assign sort = context.params.sort | default: 'name' -%}
{%- assign filter = context.params.category | default: 'all' -%}
```

### Query String Building
```liquid
{%- assign page = context.params.page | default: 1 -%}
{%- assign current_sort = context.params.sort | default: 'name' -%}
<a href="/products?sort=price&page={{ page }}">Sort by Price</a>
<a href="/products?sort=name&page=1">Sort by Name</a>
<a href="/products?sort={{ current_sort }}&page={{ page | plus: 1 }}">Next Page</a>
```

### Form Preservation on Validation Error
```liquid
{%- assign name_value = context.params.name | default: '' -%}
{%- assign email_value = context.params.email | default: '' -%}
<form method="post">
  <input type="text" name="name" value="{{ name_value }}">
  <input type="email" name="email" value="{{ email_value }}">
  <input type="hidden" name="authenticity_token"
         value="{{ context.authenticity_token }}">
</form>
```

## Session Management Patterns

### Shopping Cart Operations
```liquid
{%- if context.session.cart_items -%}
  {%- for item in context.session.cart_items -%}
    <p>{{ item.name }} - Qty: {{ item.quantity }}</p>
  {%- endfor -%}
{%- else -%}
  <p>Your cart is empty</p>
{%- endif -%}
```

### User Preferences
```liquid
{%- assign theme = context.session.theme | default: 'light' -%}
{%- assign items_per_page = context.session.items_per_page | default: 20 -%}
<body class="theme-{{ theme }}">
  {%- if context.session.enable_animations -%}
    <style>* { animation: enabled; }</style>
  {%- endif -%}
</body>
```

### Flash Messages Display
```liquid
{%- if context.flash.notice -%}
  <div class="alert alert-success">{{ context.flash.notice }}</div>
{%- endif -%}
{%- if context.flash.alert -%}
  <div class="alert alert-warning">{{ context.flash.alert }}</div>
{%- endif -%}
{%- if context.flash.error -%}
  <div class="alert alert-danger">{{ context.flash.error }}</div>
{%- endif -%}
```

## Device Detection Patterns

### Responsive Content Display
```liquid
{%- if context.device.is_mobile -%}
  {%- include_partial 'mobile_menu' -%}
{%- elsif context.device.is_tablet -%}
  {%- include_partial 'tablet_menu' -%}
{%- else -%}
  {%- include_partial 'desktop_menu' -%}
{%- endif -%}
```

### Device-Specific Styling
```liquid
<style>
  {%- if context.device.is_mobile -%}
    body { font-size: 16px; }
    .large-screen-only { display: none; }
  {%- else -%}
    body { font-size: 14px; }
  {%- endif -%}
</style>
```

### Browser Compatibility Warnings
```liquid
{%- if context.device.browser == 'IE' -%}
  <div class="alert">
    Your browser is outdated. Please upgrade for better experience.
  </div>
{%- endif -%}
```

## Page and Layout Patterns

### Active Navigation Link Highlighting
```liquid
{%- assign current_path = context.location.pathname -%}
<nav>
  <a href="/products" class="{% if current_path == '/products' %}active{% endif %}">
    Products
  </a>
  <a href="/about" class="{% if current_path == '/about' %}active{% endif %}">
    About
  </a>
</nav>
```

### Canonical URL for SEO
```liquid
<link rel="canonical" href="{{ context.location.origin }}{{ context.location.pathname }}">
```

### Page Metadata Display
```liquid
<h1>{{ context.page.title }}</h1>
{%- if context.page.metadata.description -%}
  <p>{{ context.page.metadata.description }}</p>
{%- endif -%}
```

## Loop Patterns

### First and Last Item Styling
```liquid
<ul>
{%- for item in items -%}
  <li class="
    {%- if forloop.first %} first{% endif %}
    {%- if forloop.last %} last{% endif %}
    {%- if forloop.index is odd %} odd{% endif %}
  ">
    {{ item }}
  </li>
{%- endfor -%}
</ul>
```

### Alternating Row Colors
```liquid
<table>
{%- for row in data -%}
  <tr class="{% cycle 'odd', 'even' %}">
    {%- for cell in row -%}
      <td>{{ cell }}</td>
    {%- endfor -%}
  </tr>
{%- endfor -%}
</table>
```

### Nested Loop with Hierarchy
```liquid
{%- for category in context.exports.categories -%}
  <div class="category">
    <h2>{{ category.name }} ({{ category.products.size }} items)</h2>
    {%- for product in category.products -%}
      <p>
        {{ forloop.parentloop.index }}.{{ forloop.index }}: {{ product.name }}
      </p>
    {%- endfor -%}
  </div>
{%- endfor -%}
```

### Table with Column Layout
```liquid
<table>
{%- tablerow product in products cols:4 -%}
  <div class="product-card">
    <h3>{{ product.name }}</h3>
    <p>${{ product.price }}</p>
  </div>
{%- endtablerow -%}
</table>
```

## Location and Header Patterns

### Protocol Detection
```liquid
{%- if context.location.protocol == 'https:' -%}
  <p>This is a secure connection</p>
{%- endif -%}
```

### Dynamic Asset URLs
```liquid
<script src="{{ context.location.origin }}/api/config.js"></script>
<img src="{{ context.location.origin }}/images/logo.png" alt="Logo">
```

### User-Agent Based Feature Toggling
```liquid
{%- assign user_agent = context.headers['User-Agent'] -%}
{%- if user_agent | matches: 'Chrome' -%}
  {%- comment %} Chrome-specific optimizations {%- endcomment %}
{%- elsif user_agent | matches: 'Firefox' -%}
  {%- comment %} Firefox-specific optimizations {%- endcomment %}
{%- endif -%}
```

## Environment-Specific Patterns

### Conditional Analytics
```liquid
{%- if context.environment.is_production -%}
  <script>
    // Production analytics
    gtag('config', '{{ context.constants.ga_tracking_id }}');
  </script>
{%- endif -%}
```

### Development Mode Helpers
```liquid
{%- if context.environment.is_staging -%}
  <div style="background: yellow; padding: 10px; text-align: center;">
    STAGING ENVIRONMENT
  </div>
{%- endif -%}
```

## Export and Data Sharing

### Using GraphQL Exported Data
```liquid
{%- comment %} Data exported from GraphQL query {%- endcomment %}
{%- assign user = context.exports.current_user -%}
{%- assign posts = context.exports.user_posts -%}

<h1>{{ user.name }}'s Posts</h1>
{%- for post in posts -%}
  <article>
    <h2>{{ post.title }}</h2>
    <p>{{ post.excerpt }}</p>
  </article>
{%- endfor -%}
```

## See Also

- [Objects Configuration](configuration.md)
- [Objects API Reference](api.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
