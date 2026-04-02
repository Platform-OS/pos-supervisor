# Assets Gotchas

## Cache Busting Surprises

### Forgetting the Filter

```liquid
<!-- WRONG: Direct path doesn't get version hash -->
<img src="/app/assets/images/logo.png" alt="Logo">

<!-- RIGHT: Use filter for CDN URL with cache busting -->
<img src="{{ 'images/logo.png' | asset_url }}" alt="Logo">
```

Without the filter, browsers may cache old versions and users won't see updates.

## Environment-Specific URLs

### Different CDN in Staging vs Production

The `asset_url` filter automatically uses the environment's CDN endpoint from `.pos`:

```liquid
<!-- Automatically picks staging or production CDN -->
{{ 'images/logo.png' | asset_url }}
```

Don't hardcode CDN URLs—always use filters to ensure proper environment handling.

## Asset Upload Timing

### Assets Must Deploy with Code

Assets are synced during `pos-cli deploy`. If you:

1. Upload assets manually without deploying code changes
2. Code references assets that haven't been deployed yet

Result: 404 errors and broken pages.

**Solution:** Always deploy together:

```bash
pos-cli deploy staging  # Deploys code AND assets atomically
```

## SVG Security

### Inline SVG Can Execute Scripts

```liquid
<!-- RISKY: User-uploaded SVG with script tags -->
{{ dynamic_svg_content }}

<!-- SAFE: SVG as image source (sandbox) -->
<img src="{{ 'icons/safe.svg' | asset_url }}" alt="Icon">
```

Only inline SVGs you control. User-uploaded SVGs should be served as image sources or sanitized.

## Large Asset Handling

### Size Limits Affect Upload Speed

- Assets over 100MB: Use separate CDN or chunked upload
- Many small files: Bundle to reduce HTTP requests
- Uncompressed CSS/JS: Minify before deployment

Check deployment logs for upload performance issues.

## Path Resolution Issues

### Asset Paths Are Relative to app/assets/

```liquid
<!-- app/assets/images/logo.png -->
{{ 'images/logo.png' | asset_url }}  <!-- Correct -->

{{ 'app/assets/images/logo.png' | asset_url }}  <!-- Wrong: double path -->

{{ '/images/logo.png' | asset_url }}  <!-- Wrong: leading slash -->
```

Always use relative paths from the `app/assets/` root.

## CORS with Cross-Domain Assets

### CDN Assets and Cross-Origin Requests

For fonts or resources needed across domains:

```liquid
<link rel="preload" href="{{ 'fonts/main.woff2' | asset_url }}" as="font" crossorigin>
```

The `crossorigin` attribute is required for fonts to load properly.

## Subdirectory Depth

### Asset Path Limits

Some browsers limit URL length. Keep asset paths reasonable:

```liquid
<!-- Acceptable -->
{{ 'images/icons/user/profile/avatar.png' | asset_url }}

<!-- Too deep - consider flatter structure -->
{{ 'images/a/b/c/d/e/f/g/h/file.png' | asset_url }}
```

## Browser Caching Issues

### Hard Refresh Required for Updates

After deploying new assets, users may need to hard-refresh (Ctrl+Shift+R) to see updates due to browser caching. The hash helps but old cache may persist.

**Best practice:** Educate users or use service workers for cache invalidation.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
