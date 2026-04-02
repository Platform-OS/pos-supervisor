# Assets Advanced Techniques

## Custom Asset Versioning

Implement manual versioning alongside automatic cache-busting:

```liquid
{% assign version = '1.2.3' %}
<script src="{{ 'scripts/app.js' | asset_url | append: '?v=' | append: version }}"></script>
```

This adds explicit version info to URLs while preserving auto-versioning.

## Asset Serving from Multiple CDNs

Configure multiple CDN endpoints for geographic distribution:

```yaml
# .pos file
environments:
  production:
    cdn_urls:
      default: 'https://cdn1.example.com'
      us: 'https://cdn-us.example.com'
      eu: 'https://cdn-eu.example.com'
```

Use Liquid to select appropriate CDN:

```liquid
{% if context.country == 'US' %}
  {% assign cdn = context.cdn_urls.us %}
{% elsif context.country == 'EU' %}
  {% assign cdn = context.cdn_urls.eu %}
{% else %}
  {% assign cdn = context.cdn_urls.default %}
{% endif %}
```

## Dynamic Asset Generation

Generate assets dynamically based on user preferences:

```liquid
<!-- Generate user-specific stylesheet -->
<style>
  :root {
    --primary-color: {{ context.user.brand_color }};
    --font-size: {{ context.user.font_preference }}px;
  }
</style>

<link rel="stylesheet" href="{{ 'styles/theme.css' | asset_url }}">
```

## Asset Integrity Verification

Verify asset integrity with subresource integrity (SRI):

```liquid
{% assign sri_hashes = 'styles/main-abc123.css: sha384-abc123...' %}

<link rel="stylesheet" href="{{ 'styles/main.css' | asset_url }}" integrity="sha384-abc123...">
```

Calculate hashes during build and store in config.

## Lazy Loading Strategy

Implement lazy loading with intersection observer:

```liquid
<img
  src="{{ 'images/placeholder.jpg' | asset_url }}"
  data-src="{{ 'images/actual.jpg' | asset_url }}"
  class="lazy-load"
  alt="Image"
>

<script>
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        observer.unobserve(img);
      }
    });
  });

  document.querySelectorAll('.lazy-load').forEach(img => observer.observe(img));
</script>
```

## Pre-rendering Asset Lists

Cache asset metadata for faster page loads:

```liquid
{% cache 'asset_manifest', expire: 86400 %}
  {% assign assets = '' | split: ',' %}
  {% for image in 'images/gallery/*.jpg' | glob_assets %}
    {% assign assets = assets | push: image | asset_url %}
  {% endfor %}
  {{ assets | json }}
{% endcache %}
```

## Service Worker Integration

Serve assets through service worker caching:

```javascript
// assets/scripts/service-worker.js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('v1').then((cache) => {
      return cache.addAll([
        '{{ "styles/main.css" | asset_url }}',
        '{{ "scripts/core.js" | asset_url }}',
        '{{ "images/logo.png" | asset_url }}'
      ]);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
```

## Performance Monitoring

Track asset loading performance:

```liquid
<script>
  window.addEventListener('load', () => {
    const perfData = window.performance.getEntriesByType('resource');
    const assetMetrics = perfData.filter(entry =>
      entry.name.includes('{{ context.cdn_url }}')
    );
    console.log('Asset Load Times:', assetMetrics);
  });
</script>
```

## Asset Preprocessing

Use custom build steps for asset compilation:

```bash
# Custom build script before deploy
npm run build:assets
pos-cli deploy staging
```

Store preprocessed assets in `app/assets/` before deployment.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Gotchas & Issues](./gotchas.md)
