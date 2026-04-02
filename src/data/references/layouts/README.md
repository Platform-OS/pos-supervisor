# Layouts

Layouts are wrapper templates that provide the common HTML shell around page content. They define the `<head>`, `<body>`, navigation, footer, and shared assets that every page inherits. Layouts live in `app/views/layouts/`.

## Key Purpose

Layouts serve as the outermost template layer in platformOS rendering. They handle:

1. **HTML document structure** -- DOCTYPE, head, body, meta tags
2. **Shared assets** -- CSS initialization (common-styling), global scripts
3. **Navigation and chrome** -- headers, footers, sidebars shared across pages
4. **Content injection slots** -- named yield points where pages can inject page-specific assets
5. **Flash messages** -- toast notifications displayed after redirects

The default layout is `application.liquid`. Pages use it automatically unless they specify a different layout in front matter.

## When to Use

- **Wrapping all HTML pages** -- the default `application.liquid` covers most pages
- **Creating an admin section** -- use a separate `admin.liquid` layout with different navigation
- **Email templates** -- use a `mailer.liquid` layout with email-safe HTML
- **Raw output** -- set `layout: ""` in page front matter to skip layouts entirely (for API JSON endpoints)

You do NOT need a new layout when:
- You only need a different sidebar or header (use conditional rendering in partials)
- You need a landing page variant (use `{% content_for %}` to inject custom styles)

## How It Works

1. A request hits a page file
2. The page executes its Liquid body (GraphQL calls, partial renders)
3. The page output becomes `content_for_layout`
4. platformOS wraps that output inside the specified layout
5. The layout renders, inserting page output via `{{ content_for_layout }}`
6. Named `{% yield %}` slots are filled from `{% content_for %}` blocks

```
Page Output → {{ content_for_layout }} inside Layout → Final HTML Response
```

### Standard layout structure

```liquid
<!DOCTYPE html>
<html class="pos-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ context.page.metadata.title }}</title>
  {% render 'modules/common-styling/init' %}
  {% yield 'head' %}
</head>
<body>
  {% render 'shared/navigation' %}

  {{ content_for_layout }}

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

## Getting Started

1. The default `app/views/layouts/application.liquid` is created with a new project
2. Add `{% render 'modules/common-styling/init' %}` in `<head>` for CSS
3. Place `{{ content_for_layout }}` where page content should appear
4. Add `{% yield 'head' %}` and `{% yield 'footer_scripts' %}` for page-specific assets
5. Include flash message handling before `</body>`
6. Create additional layouts only when you need fundamentally different HTML shells

### Quick layout file

```liquid
<!DOCTYPE html>
<html class="pos-app">
<head>
  <meta charset="utf-8">
  <title>{{ context.page.metadata.title | default: "My App" }}</title>
  {% render 'modules/common-styling/init' %}
  {% yield 'head' %}
</head>
<body>
  {{ content_for_layout }}
  {% yield 'footer_scripts' %}
</body>
</html>
```

## See Also

- [Pages](../pages/README.md) -- pages select and fill layouts
- [Partials](../partials/README.md) -- partials render inside layouts and pages
- [Liquid Tags](../liquid/tags/README.md) -- `yield`, `content_for`, `render` tags
- [Flash Messages](../flash-messages/README.md) -- toast notification system
- [Common Styling Module](../modules/common-styling/README.md) -- CSS framework initialization
