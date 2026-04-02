# Assets (Static Files & CDN)

Static files (images, fonts, CSS, JavaScript) served via CDN.

## Location

`app/assets/`

## Directory Structure

```
app/assets/
├── images/
│   ├── logo.png
│   └── icons/
├── fonts/
├── styles/
│   ├── main.css
│   └── components/
├── scripts/
│   ├── app.js
│   └── modules/
└── media/
```

## Referencing Assets

### asset_url (full CDN URL)
```liquid
{{ 'images/logo.png' | asset_url }}
→ https://cdn.platformos.com/.../images/logo.png?updated=1234567890

<link rel="stylesheet" href="{{ 'styles/main.css' | asset_url }}">
<script src="{{ 'scripts/app.js' | asset_url }}"></script>
<img src="{{ 'images/logo.png' | asset_url }}" alt="Logo">
```

### asset_path (relative path)
```liquid
{{ 'images/logo.png' | asset_path }}
→ /assets/images/logo.png?updated=1234567890
```

Both include a cache-busting parameter.

## In CSS Files

Reference other assets using relative paths or the asset_url filter in `.css.liquid` files.

## In JavaScript

For dynamic asset URLs, pass them from Liquid to JS:

```liquid
<script>
  window.APP_CONFIG = {
    logoUrl: {{ 'images/logo.png' | asset_url | json }},
    apiBase: {{ context.location.host | json }}
  };
</script>
```

## Rules

- All static files go in `app/assets/`
- Use `asset_url` for full CDN URLs (preferred)
- Use `asset_path` for relative paths
- Files are served with automatic cache-busting
- Synced to CDN on `pos-cli deploy`
