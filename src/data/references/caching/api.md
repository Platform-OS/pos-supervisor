# Caching API Reference

## cache Tag

Wrap content to be cached.

**Syntax:**
```liquid
{% cache 'cache-key', expire: 3600 %}
  ...cached content...
{% endcache %}
```

**Parameters:**

- `cache-key` (string, required): Unique identifier for cache entry
- `expire` (integer, seconds): Time-to-live, default 3600

**Example:**

```liquid
{% cache 'homepage-featured', expire: 86400 %}
  <section class="featured">
    {% for item in site.featured_items %}
      <div class="featured-item">{{ item.title }}</div>
    {% endfor %}
  </section>
{% endcache %}
```

## Cache Syntax Variations

### Simple Key

```liquid
{% cache 'products', expire: 7200 %}
  {% graphql products = 'get_all_products' %}
{% endcache %}
```

### Dynamic Key with Append

```liquid
{% cache 'user-profile-' | append: context.current_user.id, expire: 1800 %}
  {% include 'user/profile-card' %}
{% endcache %}
```

### Complex Dynamic Key

```liquid
{% assign cache_key = 'products-' | append: context.params.category | append: '-' | append: context.language %}
{% cache cache_key, expire: 3600 %}
  {% graphql products = 'get_products_by_category', category: context.params.category %}
{% endcache %}
```

## Cache Clearing

### CLI: Clear Specific Cache

```bash
pos-cli cache clear 'homepage-featured' staging
```

### CLI: Clear Pattern

```bash
pos-cli cache clear 'user-profile-*' staging
```

Clear all caches matching pattern.

### CLI: Clear All Caches

```bash
pos-cli cache clear --all staging
```

Dangerous—use only when necessary.

## Cache Debugging

### Show Cache Statistics

```bash
pos-cli cache stats staging
```

Returns hit rate, size, entries count.

### Inspect Cache Entry

```bash
pos-cli cache inspect 'cache-key' staging
```

Displays cached content and metadata.

## Conditional Caching

Cache only under certain conditions:

```liquid
{% if context.environment == 'production' %}
  {% cache 'expensive-query', expire: 3600 %}
    {% graphql result = 'expensive_operation' %}
  {% endcache %}
{% else %}
  <!-- Skip cache in development -->
  {% graphql result = 'expensive_operation' %}
{% endif %}
```

## Nested Caching

Cache within cache is supported:

```liquid
{% cache 'outer', expire: 7200 %}
  Outer content
  {% cache 'inner', expire: 3600 %}
    Inner content
  {% endcache %}
{% endcache %}
```

Inner cache expires independently; outer uses outer TTL for invalidation.

## Cache Busting Headers

Use HTTP headers to bypass cache:

```liquid
{% if context.params.nocache %}
  <!-- Bypass cache, compute fresh -->
  {% graphql products = 'get_products' %}
{% else %}
  {% cache 'products-listing', expire: 3600 %}
    {% graphql products = 'get_products' %}
  {% endcache %}
{% endif %}
```

Users can add `?nocache=1` to refresh without server restart.

## Cache Warmup

Pre-populate cache on startup:

```liquid
<!-- Run once on deploy -->
{% if context.environment == 'production' and context.params.warmup %}
  {% cache 'critical-products', expire: 86400 %}
    {% graphql products = 'get_featured_products' %}
  {% endcache %}

  {% cache 'categories', expire: 86400 %}
    {% graphql categories = 'get_all_categories' %}
  {% endcache %}
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
