# Layouts -- Patterns & Best Practices

Common workflows and real-world patterns for layout files in platformOS.

## Standard Application Layout

The most common layout pattern includes navigation, content, flash messages, and yield slots.

```liquid
<!DOCTYPE html>
<html class="pos-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ context.page.metadata.title | default: "My App" }}</title>
  {% render 'modules/common-styling/init' %}
  {% yield 'head' %}
</head>
<body>
  {% render 'shared/navigation' %}
  <main>
    {{ content_for_layout }}
  </main>
  {% render 'shared/footer' %}
  {% liquid
    function flash = 'modules/core/commands/session/get', key: 'sflash'
    if context.location.pathname != flash.from or flash.force_clear
      function _ = 'modules/core/commands/session/clear', key: 'sflash'
    endif
    render 'modules/common-styling/toasts', params: flash
  %}
  {% yield 'footer_scripts' %}
</body>
</html>
```

## Admin Layout Pattern

A separate layout for admin sections with different navigation and restricted access styling.

```liquid
<!DOCTYPE html>
<html class="pos-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin - {{ context.page.metadata.title | default: "Dashboard" }}</title>
  {% render 'modules/common-styling/init' %}
  {% yield 'head' %}
</head>
<body>
  <div class="admin-layout">
    {% render 'admin/sidebar_navigation' %}
    <div class="admin-content">
      {% render 'admin/top_bar' %}
      <main>
        {{ content_for_layout }}
      </main>
    </div>
  </div>
  {% liquid
    function flash = 'modules/core/commands/session/get', key: 'sflash'
    if context.location.pathname != flash.from or flash.force_clear
      function _ = 'modules/core/commands/session/clear', key: 'sflash'
    endif
    render 'modules/common-styling/toasts', params: flash
  %}
  {% yield 'footer_scripts' %}
</body>
</html>
```

Pages use it via front matter:

```yaml
---
layout: admin
---
```

## Email Layout Pattern

Email layouts use inline-safe HTML with no external CSS dependencies.

```liquid
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 32px; }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #eee; }
    .footer { text-align: center; padding-top: 24px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{ 'emails.app_name' | t }}</h1>
    </div>
    {{ content_for_layout }}
    <div class="footer">
      <p>{{ 'emails.footer_text' | t }}</p>
    </div>
  </div>
</body>
</html>
```

## Page-Specific Asset Injection

Pages inject CSS or JS into layout slots using `{% content_for %}`:

```liquid
{% comment %} In a page or partial {% endcomment %}
{% content_for 'head' %}
  <link rel="stylesheet" href="{{ 'styles/product-gallery.css' | asset_url }}">
{% endcontent_for %}

{% content_for 'footer_scripts' %}
  <script src="{{ 'scripts/product-gallery.js' | asset_url }}"></script>
{% endcontent_for %}
```

The layout renders these via `{% yield 'head' %}` and `{% yield 'footer_scripts' %}`.

## Conditional Navigation Pattern

Show different navigation based on authentication state:

```liquid
{% comment %} In shared/navigation.liquid partial {% endcomment %}
{% if context.current_user %}
  {% render 'shared/nav_authenticated', user: context.current_user %}
{% else %}
  {% render 'shared/nav_guest' %}
{% endif %}
```

## SEO Meta Tags Pattern

Use page metadata for dynamic SEO tags:

```liquid
<head>
  <title>{{ context.page.metadata.title | default: "My App" }}</title>
  <meta name="description" content="{{ context.page.metadata.description | default: 'Default description' }}">
  {% if context.page.metadata.canonical_url %}
    <link rel="canonical" href="{{ context.page.metadata.canonical_url }}">
  {% endif %}
  <meta property="og:title" content="{{ context.page.metadata.title | default: 'My App' }}">
  <meta property="og:description" content="{{ context.page.metadata.description }}">
  {% if context.page.metadata.og_image %}
    <meta property="og:image" content="{{ context.page.metadata.og_image | asset_url }}">
  {% endif %}
</head>
```

## Breadcrumb Slot Pattern

Layouts can include a breadcrumb slot that pages fill:

```liquid
<body>
  {% render 'shared/navigation' %}
  {% yield 'breadcrumbs' %}
  <main>
    {{ content_for_layout }}
  </main>
</body>
```

Pages provide breadcrumbs:

```liquid
{% content_for 'breadcrumbs' %}
  {% render 'shared/breadcrumbs', items: 'Home:/,Products:/products,Edit' %}
{% endcontent_for %}
```

## Minimal / No-Layout Pattern

API endpoints and AJAX responses skip the layout entirely:

```yaml
---
slug: api/products
layout: ""
---
```

This outputs only the page body with no HTML shell.

## Best Practices

1. **Keep layouts minimal** -- layouts should contain structure, not logic
2. **One layout per use case** -- `application`, `admin`, `mailer` cover most apps
3. **Always include flash handling** -- users expect feedback after form submissions
4. **Use yield slots** -- allow pages to inject CSS/JS without modifying the layout
5. **Use translations** -- never hardcode text in layouts (use `{{ 'key' | t }}`)
6. **Include common-styling/init** -- required for the design system to work
7. **Set pos-app class** -- `<html class="pos-app">` enables common-styling
8. **Delegate to partials** -- navigation, footer, and other components should be partials

## See Also

- [Layouts Overview](README.md) -- introduction and key concepts
- [Layouts Configuration](configuration.md) -- file structure and settings
- [Layouts API](api.md) -- tags and objects available
- [Layouts Gotchas](gotchas.md) -- common errors and limits
- [Pages Patterns](../pages/patterns.md) -- how pages interact with layouts
- [Flash Messages](../flash-messages/README.md) -- toast notification details
