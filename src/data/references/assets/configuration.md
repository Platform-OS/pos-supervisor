# Assets Configuration

## Overview

Static assets in platformOS are stored in `app/assets/` and served via CDN with automatic cache-busting. Subdirectories organize assets by type: `images/`, `fonts/`, `styles/`, and `scripts/`. All assets are synced to the CDN during deployment and referenced through Liquid filters.

## Directory Structure

```
app/assets/
├── images/
│   ├── logo.png
│   ├── icons/
│   └── backgrounds/
├── fonts/
│   ├── custom-font.woff2
│   └── fallbacks/
├── styles/
│   ├── main.css
│   └── vendor/
└── scripts/
    ├── app.js
    └── vendor/
```

## Configuration Files

### Asset Configuration in .pos File

The `.pos` file contains CDN endpoint configuration:

```yaml
environments:
  staging:
    url: 'https://staging-cdn.example.com'
  production:
    url: 'https://cdn.example.com'
```

### Asset Manifest (Optional)

For custom asset mapping and versioning:

```yaml
assets:
  cache_control: 'public, max-age=31536000'
  gzip: true
  minify: true
```

## Asset Serving

### CDN URLs

Use the `asset_url` filter to generate full CDN URLs:

```liquid
<img src="{{ 'images/logo.png' | asset_url }}" alt="Logo">
```

### Relative Paths

Use `asset_path` filter for relative URLs:

```liquid
<link rel="stylesheet" href="{{ 'styles/main.css' | asset_path }}">
```

## Cache Busting

platformOS automatically appends version hashes to asset filenames during deployment:

```
Original: logo.png
Deployed: logo-a1b2c3d4.png
```

Filters handle this transparently without manual intervention.

## Deploy Configuration

### Automatic Sync

Assets sync automatically on `pos-cli deploy`:

```bash
pos-cli deploy staging
# Compiles, uploads, and registers all assets in app/assets/
```

### Manual Asset Upload

For non-deployment scenarios:

```bash
pos-cli assets upload staging --path app/assets/
```

## Performance Best Practices

- Use CDN URLs with `asset_url` in production
- Serve fonts from `fonts/` with proper cache headers
- Minify CSS and JS before deployment
- Organize images logically with subdirectories
- Use webp format where supported with fallbacks

## MIME Type Configuration

platformOS automatically detects MIME types:

- CSS: `text/css`
- JS: `application/javascript`
- Fonts: `font/woff2`, `font/woff`
- Images: `image/png`, `image/jpeg`, `image/webp`

## See Also

- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
