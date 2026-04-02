# Assets Patterns

## Image Optimization Pattern

Optimize images using multiple formats and sizes:

```liquid
<!-- Modern format with JPEG fallback -->
<picture>
  <source srcset="{{ 'images/hero.webp' | asset_url }}" type="image/webp">
  <img src="{{ 'images/hero.jpg' | asset_url }}" alt="Hero">
</picture>

<!-- Responsive with srcset -->
<img
  src="{{ 'images/thumbnail.jpg' | asset_url }}"
  srcset="{{ 'images/thumbnail@2x.jpg' | asset_url }} 2x"
  alt="Thumbnail"
  loading="lazy"
>
```

## Font Loading Pattern

Optimize font loading with preload and proper weights:

```liquid
<!-- Preload critical fonts -->
<link rel="preload" href="{{ 'fonts/primary-400.woff2' | asset_url }}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{{ 'fonts/primary-700.woff2' | asset_url }}" as="font" type="font/woff2" crossorigin>

<style>
  @font-face {
    font-family: 'Primary';
    src: url('{{ 'fonts/primary-400.woff2' | asset_url }}') format('woff2');
    font-weight: 400;
    font-display: swap;
  }

  @font-face {
    font-family: 'Primary';
    src: url('{{ 'fonts/primary-700.woff2' | asset_url }}') format('woff2');
    font-weight: 700;
    font-display: swap;
  }
</style>
```

## CSS Organization Pattern

Organize stylesheets by scope and loading priority:

```liquid
<!-- Critical above-the-fold CSS inline or early load -->
<link rel="stylesheet" href="{{ 'styles/critical.css' | asset_url }}">

<!-- Main stylesheet -->
<link rel="stylesheet" href="{{ 'styles/main.css' | asset_url }}">

<!-- Optional deferred styles -->
<link rel="stylesheet" href="{{ 'styles/components.css' | asset_url }}" media="print" onload="this.media='all'">
```

## JavaScript Loading Pattern

Implement strategic script loading:

```liquid
<!-- Core functionality with defer -->
<script src="{{ 'scripts/core.js' | asset_url }}" defer></script>

<!-- Analytics with async -->
<script src="{{ 'scripts/analytics.js' | asset_url }}" async></script>

<!-- Inline critical bootstrap -->
<script>
  window.APP_ASSETS_URL = "{{ context.cdn_url }}";
</script>
```

## Asset Caching Pattern

Leverage CDN caching with proper headers:

```liquid
<!-- Immutable assets (versioned by hash) -->
{{ 'images/logo.png' | asset_url }}

<!-- Cache in browser for 1 year -->
{{ 'styles/main.css' | asset_url }}

<!-- Revalidate daily for dynamic content -->
{{ 'data/config.json' | asset_url }}
```

## Conditional Asset Loading

Load assets based on environment or context:

```liquid
{% if context.environment == 'production' %}
  <script src="{{ 'scripts/analytics-prod.js' | asset_url }}" async></script>
{% else %}
  <script src="{{ 'scripts/debug.js' | asset_url }}" defer></script>
{% endif %}
```

## Asset Version Pinning

Reference specific asset versions if needed:

```liquid
<!-- Without version (recommended - auto-versioned) -->
{{ 'scripts/app.js' | asset_url }}

<!-- Pin to specific deployment (advanced use) -->
{{ 'scripts/app.js' | asset_url | append: '?v=1.0.0' }}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
