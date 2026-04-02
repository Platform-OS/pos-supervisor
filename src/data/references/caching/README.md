# Caching

platformOS provides fragment caching via the `{% cache %}` tag to avoid re-executing expensive operations.

## Syntax

```liquid
{% cache 'unique_key', expire: 3600 %}
  {% comment %} Expensive content to cache {% endcomment %}
  {% graphql products = 'products/featured' %}
  {% render 'products/featured_list', products: products %}
{% endcache %}
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | String | Unique cache identifier |
| `expire` | Integer | Seconds until cache expires |

## Dynamic Cache Keys

Include dynamic values in keys to cache per-user or per-page:

```liquid
{% cache 'products_page_' | append: context.params.page, expire: 600 %}
  {% render 'products/list', products: products %}
{% endcache %}

{% cache 'user_dashboard_' | append: profile.id, expire: 300 %}
  {% render 'dashboard/summary', user: profile %}
{% endcache %}
```

## Cache Strategies

### Static Content
Long expiry for rarely changing content:
```liquid
{% cache 'footer_navigation', expire: 86400 %}
  {% render 'shared/footer' %}
{% endcache %}
```

### Dynamic Content
Short expiry for frequently changing data:
```liquid
{% cache 'recent_orders', expire: 60 %}
  {% graphql orders = 'orders/recent' %}
  {% render 'orders/recent_list', orders: orders %}
{% endcache %}
```

### Per-User Content
Include user ID in cache key:
```liquid
{% cache 'user_cart_' | append: profile.id, expire: 300 %}
  {% render 'cart/summary', user: profile %}
{% endcache %}
```

## Rules

- Cache keys must be unique across the application
- Cached content is HTML output (not data)
- Use short expiry for dynamic data
- Include user/page identifiers in keys for personalized content
- Don't cache content with CSRF tokens (they change per session)
