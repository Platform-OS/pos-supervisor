# Caching Patterns

## Static Content Caching

Cache content that rarely changes with long TTL:

```liquid
{% cache 'site-footer', expire: 604800 %}
  <!-- Footer: cached for 7 days -->
  <footer>
    <p>&copy; 2024 Company</p>
    {% graphql footer_links = 'get_footer_navigation' %}
    <ul>
      {% for link in footer_links.navigation %}
        <li><a href="{{ link.url }}">{{ link.title }}</a></li>
      {% endfor %}
    </ul>
  </footer>
{% endcache %}
```

## Per-User Dynamic Caching

Cache user-specific content with dynamic keys:

```liquid
{% cache 'user-cart-' | append: context.current_user.id, expire: 300 %}
  <!-- Cart: cached per user, 5 minutes -->
  {% graphql cart = 'get_user_cart', user_id: context.current_user.id %}
  <div class="cart-summary">
    Items: {{ cart.cart.item_count }}
    Total: {{ cart.cart.total | pricify }}
  </div>
{% endcache %}
```

## Per-Page Dynamic Caching

Cache page-specific data by page ID:

```liquid
{% cache 'product-details-' | append: product.id | append: '-' | append: context.language, expire: 1800 %}
  <!-- Product page: cached per product and language, 30 minutes -->
  <div class="product">
    <h1>{{ product.name }}</h1>
    <p>{{ product.description }}</p>
    {% graphql reviews = 'get_product_reviews', product_id: product.id %}
    <div class="reviews">{{ reviews.reviews | size }} reviews</div>
  </div>
{% endcache %}
```

## Multi-Language Caching

Separate caches for each language:

```liquid
{% assign lang = context.language | default: 'en' %}
{% cache 'homepage-' | append: lang, expire: 86400 %}
  <!-- Homepage: separate cache per language -->
  {% graphql content = 'get_home_content', language: lang %}
  <section>
    <h1>{{ content.title }}</h1>
    <p>{{ content.description }}</p>
  </section>
{% endcache %}
```

## Partial Fragment Caching

Cache individual components:

```liquid
<div class="page">
  <!-- Expensive query, cache it -->
  {% cache 'recommended-products', expire: 3600 %}
    {% graphql recommended = 'get_recommendations', limit: 5 %}
    {% for product in recommended.products %}
      {% include 'product-card', product: product %}
    {% endfor %}
  {% endcache %}

  <!-- Fresh content not cached -->
  <div class="recent-activity">
    {% graphql activity = 'get_recent_activity' %}
    {% for item in activity.items %}
      <p>{{ item.description }} - {{ item.timestamp }}</p>
    {% endfor %}
  </div>
</div>
```

## Tiered Caching Strategy

Combine multiple cache layers:

```liquid
<!-- Tier 1: Static content (24 hours) -->
{% cache 'site-header', expire: 86400 %}
  {% include 'components/header' %}
{% endcache %}

<!-- Tier 2: Dynamic but slow (1 hour) -->
{% cache 'product-list-' | append: context.params.category, expire: 3600 %}
  {% graphql products = 'get_products', category: context.params.category %}
{% endcache %}

<!-- Tier 3: Real-time data (5 minutes) -->
{% cache 'inventory-' | append: product.id, expire: 300 %}
  {% graphql stock = 'get_stock', product_id: product.id %}
{% endcache %}

<!-- Tier 4: No cache for sensitive data -->
{{ context.current_user.email }}
```

## Conditional Cache Warmup

Pre-populate cache during high-traffic periods:

```liquid
{% if context.hour >= 9 and context.hour <= 17 %}
  <!-- Working hours: warmup cache -->
  {% cache 'business-hours-data', expire: 1800 %}
    {% graphql data = 'get_business_data' %}
  {% endcache %}
{% endif %}
```

## Cache-Aware Pagination

Cache paginated results efficiently:

```liquid
{% assign page = context.params.page | default: 1 | plus: 0 %}
{% assign per_page = 20 %}
{% cache 'products-page-' | append: page, expire: 3600 %}
  {% graphql results = 'get_products_paginated',
    page: page,
    per_page: per_page
  %}
  <div class="products">
    {% for product in results.products %}
      {% include 'product-card', product: product %}
    {% endfor %}
  </div>
  <div class="pagination">
    {% if page > 1 %}
      <a href="?page={{ page | minus: 1 }}">Previous</a>
    {% endif %}
    <a href="?page={{ page | plus: 1 }}">Next</a>
  </div>
{% endcache %}
```

## Search Results Caching

Cache search results with query in key:

```liquid
{% assign query = context.params.q | default: '' | downcase %}
{% if query != blank %}
  {% cache 'search-' | append: query, expire: 1800 %}
    {% graphql results = 'search', query: query %}
    <ul class="search-results">
      {% for result in results.results %}
        <li>{{ result.title }}</li>
      {% endfor %}
    </ul>
  {% endcache %}
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
