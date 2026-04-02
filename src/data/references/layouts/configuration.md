# Layouts -- Configuration Reference

This document covers all configuration options for layout files in `app/views/layouts/`.

## File Location

All layouts live in `app/views/layouts/`. The filename (without extension) is the layout name referenced in page front matter.

```
app/views/layouts/
├── application.liquid      # Default layout for all pages
├── admin.liquid             # Admin section layout
├── mailer.liquid            # Email layout
└── minimal.liquid           # Minimal layout (no nav/footer)
```

## Selecting a Layout from Pages

Pages select their layout via the `layout:` property in YAML front matter:

```yaml
---
layout: application
---
```

### Layout selection options

| Front Matter Value  | Layout File Used                          | Use Case              |
|---------------------|-------------------------------------------|-----------------------|
| *(omitted)*         | `app/views/layouts/application.liquid`    | Default behavior      |
| `layout: application` | `app/views/layouts/application.liquid`  | Explicit default      |
| `layout: admin`     | `app/views/layouts/admin.liquid`          | Admin section         |
| `layout: mailer`    | `app/views/layouts/mailer.liquid`         | Email templates       |
| `layout: ""`        | No layout (raw output)                    | API endpoints, AJAX   |

## Core Layout Elements

### content_for_layout (required)

Every layout must include exactly one `{{ content_for_layout }}` tag. This is where the page's rendered output is inserted.

```liquid
<body>
  {{ content_for_layout }}
</body>
```

Without this tag, page content will not appear in the response.

### yield (named slots)

`{% yield 'name' %}` renders content that pages or partials have stored via `{% content_for 'name' %}`.

```liquid
<head>
  {% yield 'head' %}
</head>
<body>
  {{ content_for_layout }}
  {% yield 'footer_scripts' %}
</body>
```

### Common yield slot conventions

| Slot Name          | Location        | Purpose                                   |
|--------------------|-----------------|-------------------------------------------|
| `head`             | Inside `<head>` | Page-specific CSS, meta tags, preloads    |
| `footer_scripts`   | Before `</body>`| Page-specific JavaScript                  |
| `breadcrumbs`      | Above content   | Page-specific breadcrumb navigation       |
| `sidebar`          | Beside content  | Page-specific sidebar content             |

## Common-Styling Initialization

The `pos-app` class on `<html>` and the `common-styling/init` partial are required for the common-styling CSS framework:

```liquid
<html class="pos-app">
<head>
  {% render 'modules/common-styling/init' %}
</head>
```

This renders the CSS links and configuration needed by the design system. Without `class="pos-app"`, common-styling components will not render correctly.

## Flash Message Configuration

Flash messages (toasts) are displayed via the layout, typically just before `</body>`:

```liquid
{% liquid
  function flash = 'modules/core/commands/session/get', key: 'sflash'
  if context.location.pathname != flash.from or flash.force_clear
    function _ = 'modules/core/commands/session/clear', key: 'sflash'
  endif
  render 'modules/common-styling/toasts', params: flash
%}
```

The `from` check ensures the flash is only shown on the intended page and cleared after display.

### Flash message flow

1. A page sets a flash: `function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'Saved!', from: '/target'`
2. The page redirects to `/target`
3. The layout reads the flash from session
4. If `pathname != flash.from`, the flash is cleared (prevents stale messages)
5. The toast partial renders the notification

## Metadata in Layouts

Access page front matter metadata via `context.page.metadata`:

```liquid
<head>
  <title>{{ context.page.metadata.title | default: "My Application" }}</title>
  <meta name="description" content="{{ context.page.metadata.description }}">
  {% if context.page.metadata.og_image %}
    <meta property="og:image" content="{{ context.page.metadata.og_image | asset_url }}">
  {% endif %}
</head>
```

## Full Application Layout Example

```liquid
<!DOCTYPE html>
<html class="pos-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ context.page.metadata.title | default: "My App" }}</title>
  <meta name="description" content="{{ context.page.metadata.description }}">
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

## Email Layout Example

```liquid
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
  </style>
</head>
<body>
  {{ content_for_layout }}
  <footer>
    <p>{{ 'emails.footer' | t }}</p>
  </footer>
</body>
</html>
```

## See Also

- [Layouts Overview](README.md) -- introduction and key concepts
- [Layouts API](api.md) -- tags and objects available in layouts
- [Pages Configuration](../pages/configuration.md) -- how pages select layouts
- [Flash Messages](../flash-messages/README.md) -- toast notification details
- [Common Styling](../modules/common-styling/README.md) -- CSS framework setup
