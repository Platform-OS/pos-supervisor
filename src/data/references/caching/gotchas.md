# Caching Gotchas

## CSRF Token Caching

### Never Cache Security Tokens

```liquid
<!-- WRONG: Caching CSRF token across requests -->
{% cache 'form-with-token', expire: 3600 %}
  <form>
    <input type="hidden" name="csrf" value="{{ context.csrf_token }}">
  </form>
{% endcache %}

<!-- RIGHT: Keep token outside cache -->
{% cache 'form-content', expire: 3600 %}
  <form>
    <input type="hidden" name="csrf" value="{{ context.csrf_token }}">
    <!-- form fields cached -->
  </form>
{% endcache %}
```

Cached CSRF tokens fail validation on POST requests.

## Cache Key Collisions

### Different Content with Same Key

```liquid
<!-- WRONG: Duplicate key -->
<!-- layout-en.html -->
{% cache 'main-content', expire: 3600 %}
  English version
{% endcache %}

<!-- layout-de.html -->
{% cache 'main-content', expire: 3600 %}
  German version
{% endcache %}

<!-- RIGHT: Include language in key -->
{% cache 'main-content-' | append: context.language, expire: 3600 %}
  {{ context.language }} version
{% endcache %}
```

Same cache key overwrites previous content, causing wrong language or data to display.

## Stale Content from Long TTL

### Users See Outdated Information

```liquid
{% cache 'product-price', expire: 86400 %}
  <!-- Price cached for 24 hours -->
  {% graphql product = 'get_product', id: context.params.id %}
  <p>Price: {{ product.price | pricify }}</p>
{% endcache %}

<!-- If price changes, users see old cached price for up to 24 hours -->
```

**Solution:** Use shorter TTL for frequently-changing data:

```liquid
{% cache 'product-price', expire: 1800 %}
  <!-- Price cached for 30 minutes only -->
  {% graphql product = 'get_product', id: context.params.id %}
  <p>Price: {{ product.price | pricify }}</p>
{% endcache %}
```

## User Data Leakage

### Private Data Visible to Multiple Users

```liquid
<!-- WRONG: Cache without user ID -->
{% cache 'user-dashboard', expire: 3600 %}
  <div>Wallet: {{ context.current_user.wallet }}</div>
  <div>Orders: {{ context.current_user.order_count }}</div>
{% endcache %}

<!-- First user A caches their dashboard -->
<!-- User B visits, sees user A's cached dashboard -->
```

**Solution:** Always include user ID in cache key:

```liquid
{% cache 'user-dashboard-' | append: context.current_user.id, expire: 3600 %}
  <div>Wallet: {{ context.current_user.wallet }}</div>
  <div>Orders: {{ context.current_user.order_count }}</div>
{% endcache %}
```

## Cache Size Growing Unbounded

### Memory Exhaustion from Too Many Cache Keys

```liquid
<!-- WRONG: Unique key for every session/user -->
{% cache 'session-data-' | append: context.session_id, expire: 300 %}
  <!-- Millions of unique keys accumulate -->
{% endcache %}

<!-- RIGHT: Limit cache keys or use TTL -->
{% cache 'session-data-' | append: context.session_id, expire: 300 %}
  <!-- TTL ensures old sessions expire -->
{% endcache %}
```

Monitor cache size in metrics. Use TTL to auto-expire old entries.

## Cache Invalidation Timing

### Changes Not Reflected Immediately

```liquid
{% if context.params.update %}
  <!-- Update database -->
  {% graphql update = 'update_product', id: product.id, name: context.params.name %}

  <!-- OLD VALUE STILL CACHED -->
  {% cache 'product-' | append: product.id, expire: 3600 %}
    {% graphql product = 'get_product', id: product.id %}
  {% endcache %}
{% endif %}
```

**Solution:** Clear cache immediately after update:

```liquid
{% if context.params.update %}
  {% graphql update = 'update_product', id: product.id, name: context.params.name %}
  <!-- CLI: Clear immediately -->
  <!-- or manually invalidate in next render -->
{% endif %}
```

## Partial Cache Invalidation Failures

### Wildcard Clear Not Matching All Keys

```bash
# WRONG: Pattern doesn't match all variants
pos-cli cache clear 'user-*' staging
# Fails to clear 'user-profile-123', 'user-cart-456'

# RIGHT: More specific pattern
pos-cli cache clear 'user-profile-*' staging
pos-cli cache clear 'user-cart-*' staging
```

Test wildcard patterns before using in production.

## Race Conditions with Cache

### Multiple Requests Computing Same Cache Simultaneously

```liquid
{% cache 'expensive-query', expire: 3600 %}
  <!-- Multiple concurrent requests compute this simultaneously -->
  {% graphql result = 'very_expensive_operation' %}
{% endcache %}
```

First request caches result. Concurrent requests still compute independently before cache exists.

**Solution:** Use locking mechanism or accept initial thundering herd:

```liquid
{% if context.cache_warmed == false %}
  <!-- Pre-warm cache to avoid concurrent computations -->
  {% cache 'expensive-query', expire: 3600 %}
    {% graphql result = 'very_expensive_operation' %}
  {% endcache %}
{% endif %}
```

## Testing with Cache Enabled

### Tests Fail Due to Stale Cache

```bash
# Cache persists between test runs
{% cache 'test-data', expire: 3600 %}
  <!-- Stale test data from previous run -->
{% endcache %}

# Solution: Clear cache before tests
pos-cli cache clear --all staging
pytest
```

Clear caches between test runs to ensure clean state.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
