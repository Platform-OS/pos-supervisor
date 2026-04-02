# Caching Advanced Techniques

## Distributed Cache Coordination

Coordinate cache across multiple servers:

```liquid
{% assign cache_version = context.deployment.version %}
{% cache 'api-response-' | append: cache_version, expire: 3600 %}
  {% graphql data = 'get_data' %}
  {{ data | json }}
{% endcache %}
```

Version keys by deployment to force invalidation on new deployments.

## Cache Stampede Prevention

Prevent multiple concurrent cache misses:

```liquid
{% assign cache_key = 'expensive-operation' %}
{% cache cache_key, expire: 3600 %}
  <!-- Check if another request already cached -->
  {% if context.cache_computing == true %}
    <!-- Wait for other request to finish -->
    Wait for cache computation...
  {% else %}
    {% graphql result = 'expensive_operation' %}
  {% endif %}
{% endcache %}
```

Use distributed locks or accept temporary duplication.

## Two-Tier Cache Pattern

Combine fast (memory) and persistent (Redis) caches:

```liquid
<!-- Tier 1: Memory (very fast, per-server) -->
{% cache 'l1-data', expire: 300 %}
  <!-- Fetches from memory -->
  {% assign data = context.memory_cache.data %}
{% endcache %}

<!-- Tier 2: Redis (slower, shared) -->
{% cache 'l2-data', expire: 3600 %}
  <!-- Fetches from Redis -->
  {% assign data = context.redis_cache.data %}
{% endcache %}
```

## Cache Precomputation

Precompute expensive values during off-peak hours:

```liquid
<!-- Midnight cache warmup -->
{% if 'now' | date: '%H:%M' == '00:00' %}
  {% cache 'daily-report', expire: 86400 %}
    {% graphql report = 'generate_daily_report' %}
  {% endcache %}

  {% cache 'trending-products', expire: 86400 %}
    {% graphql trending = 'get_trending_products' %}
  {% endcache %}
{% endif %}
```

Schedule expensive computations during low-traffic periods.

## Adaptive Cache TTL

Adjust TTL based on access patterns:

```liquid
{% assign access_count = context.cache_hits | default: 0 %}
{% if access_count > 1000 %}
  <!-- Popular cache: increase TTL -->
  {% assign ttl = 7200 %}
{% elsif access_count > 100 %}
  <!-- Moderate cache: standard TTL -->
  {% assign ttl = 3600 %}
{% else %}
  <!-- Low-traffic cache: shorter TTL -->
  {% assign ttl = 600 %}
{% endif %}

{% cache 'adaptive-data', expire: ttl %}
  {% graphql data = 'get_data' %}
{% endcache %}
```

## Cache Dependency Tracking

Track which caches depend on each other:

```liquid
<!-- When product updates, clear dependent caches -->
{% if context.params.update_product %}
  {% graphql update = 'update_product', id: context.params.id %}

  <!-- Clear dependent caches -->
  {% comment %} Cache dependencies:
    product-#{id} -> product-list
    product-#{id} -> category-#{category_id}
    product-#{id} -> search-results
  {% endcomment %}

  <!-- Manual invalidation of dependencies -->
  pos-cli cache clear 'product-list' staging
  pos-cli cache clear 'category-*' staging
{% endif %}
```

## Eventual Consistency Pattern

Accept temporary stale data for performance:

```liquid
<!-- Serve stale cache while revalidating -->
{% cache 'user-profile-' | append: user_id, expire: 300 %}
  {% graphql profile = 'get_user_profile', id: user_id %}
  {{ profile | json }}
{% endcache %}

<!-- Background job revalidates -->
<!-- User sees cached profile immediately -->
<!-- Profile updates within 5 minutes naturally -->
```

## Cache Metrics and Monitoring

Monitor cache performance:

```liquid
<!-- Track cache effectiveness -->
<script>
  window.cacheMetrics = {
    hits: {{ context.cache.hits }},
    misses: {{ context.cache.misses }},
    hitRate: {{ context.cache.hit_ratio | multiply: 100 | round: 2 }}%,
    size: '{{ context.cache.size_mb }}MB'
  };
  console.log('Cache Metrics:', window.cacheMetrics);
</script>
```

## Cache Busting with Version Hashes

Use content hashes for automatic invalidation:

```liquid
{% assign content_hash = page.content | md5 %}
{% cache 'page-' | append: page.id | append: '-' | append: content_hash, expire: 86400 %}
  {{ page.content }}
{% endcache %}
```

Cache key changes when content changes—automatic invalidation.

## Partial Response Caching

Cache portions of API responses:

```liquid
{% graphql api_response = 'complex_api_call' %}

<!-- Cache expensive transformation -->
{% cache 'transformed-data', expire: 1800 %}
  {% assign transformed = api_response | custom_filter | json %}
  {{ transformed }}
{% endcache %}

<!-- Use transformed data in multiple places -->
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Gotchas & Issues](./gotchas.md)
