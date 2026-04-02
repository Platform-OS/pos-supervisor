# Assets API Reference

## Filters

### asset_url

Generates a full CDN URL with cache-busting hash.

**Syntax:**
```liquid
{{ 'path/to/asset' | asset_url }}
```

**Example:**
```liquid
<img src="{{ 'images/hero.jpg' | asset_url }}" alt="Hero Image">
<link rel="stylesheet" href="{{ 'styles/main.css' | asset_url }}">
<script src="{{ 'scripts/app.js' | asset_url }}"></script>
```

**Output:**
```html
<img src="https://cdn.example.com/images/hero-abc123.jpg" alt="Hero Image">
<link rel="stylesheet" href="https://cdn.example.com/styles/main-xyz789.css">
<script src="https://cdn.example.com/scripts/app-def456.js"></script>
```

### asset_path

Generates a relative URL to asset.

**Syntax:**
```liquid
{{ 'path/to/asset' | asset_path }}
```

**Example:**
```liquid
<img src="{{ 'icons/user.svg' | asset_path }}" alt="User">
<video src="{{ 'videos/intro.mp4' | asset_path }}"></video>
```

## Asset Context Variables

### context.assets

Access asset metadata in Liquid:

```liquid
{% if context.assets.images.logo %}
  <img src="{{ 'images/logo.png' | asset_url }}" alt="Logo">
{% endif %}
```

### context.cdn_url

Global CDN base URL:

```liquid
CDN: {{ context.cdn_url }}
Image URL: {{ context.cdn_url }}/images/logo.png
```

## CLI Commands

### List Assets

```bash
pos-cli assets list staging
```

Shows all uploaded assets with versions and sizes.

### Upload Assets

```bash
pos-cli assets upload staging --path app/assets/
```

Manually upload assets without full deployment.

### Remove Assets

```bash
pos-cli assets remove staging --path app/assets/fonts/old.woff
```

Remove specific assets from CDN.

## Asset Types

### Images

Supported formats: PNG, JPEG, WebP, SVG, GIF

```liquid
<!-- Responsive image with srcset -->
<img
  src="{{ 'images/photo.jpg' | asset_url }}"
  srcset="{{ 'images/photo-small.jpg' | asset_url }} 480w,
          {{ 'images/photo-medium.jpg' | asset_url }} 1024w,
          {{ 'images/photo-large.jpg' | asset_url }} 1920w"
  alt="Photo"
>
```

### Stylesheets

```liquid
<link rel="stylesheet" href="{{ 'styles/main.css' | asset_url }}">
<link rel="stylesheet" href="{{ 'styles/print.css' | asset_url }}" media="print">
```

### Scripts

```liquid
<script src="{{ 'scripts/app.js' | asset_url }}"></script>
<script src="{{ 'scripts/vendor.js' | asset_url }}" async></script>
```

### Fonts

```liquid
<link rel="preload" href="{{ 'fonts/main.woff2' | asset_url }}" as="font" type="font/woff2">
```

## See Also

- [Configuration Guide](./configuration.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
