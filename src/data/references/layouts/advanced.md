# Layouts -- Advanced Topics

Edge cases, optimization strategies, and advanced patterns for platformOS layouts.

## Multiple Layout Strategy

Most applications need only 2-3 layouts. Here is a recommended structure:

| Layout              | Purpose                            | Key Differences                    |
|---------------------|------------------------------------|------------------------------------|
| `application.liquid`| Main public-facing pages           | Full nav, footer, flash messages   |
| `admin.liquid`      | Admin/dashboard pages              | Sidebar nav, admin toolbar         |
| `mailer.liquid`     | Email templates                    | Inline CSS, no scripts, email-safe |
| `minimal.liquid`    | Auth pages (login, register)       | Centered card, no nav              |

Each layout should delegate its unique components to partials rather than duplicating HTML.

## Layout Inheritance via Partials

platformOS does not support layout inheritance directly. Simulate it by extracting shared sections into partials:

```liquid
{% comment %} app/views/partials/layouts/head.liquid {% endcomment %}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ context.page.metadata.title | default: title_prefix }}</title>
{% render 'modules/common-styling/init' %}
{% yield 'head' %}
```

Both layouts use the shared head:

```liquid
{% comment %} application.liquid {% endcomment %}
<head>
  {% render 'layouts/head', title_prefix: "My App" %}
</head>

{% comment %} admin.liquid {% endcomment %}
<head>
  {% render 'layouts/head', title_prefix: "Admin" %}
</head>
```

This avoids duplicating meta tags, common-styling init, and yield slots across layouts.

## Dynamic Body Classes

Add context-aware CSS classes to the body for page-specific styling:

```liquid
<body class="page-{{ context.page.slug | replace: '/', '-' }}">
  {{ content_for_layout }}
</body>
```

This generates classes like `page-products`, `page-admin-dashboard`, enabling targeted CSS rules without page-specific stylesheets.

## Conditional Layout Sections

Some sections should only appear on certain pages. Use page metadata or URL checks:

```liquid
{% unless context.page.metadata.hide_navigation %}
  {% render 'shared/navigation' %}
{% endunless %}

{{ content_for_layout }}

{% unless context.page.metadata.hide_footer %}
  {% render 'shared/footer' %}
{% endunless %}
```

Pages opt out via front matter:

```yaml
metadata:
  hide_navigation: true
  hide_footer: true
```

## Preloading Critical Assets

Optimize page load by preloading critical assets in the layout head:

```liquid
<head>
  {% render 'modules/common-styling/init' %}
  <link rel="preload" href="{{ 'fonts/inter.woff2' | asset_url }}" as="font" type="font/woff2" crossorigin>
  <link rel="preconnect" href="https://cdn.example.com">
  {% yield 'head' %}
</head>
```

## JSON-LD Structured Data

Inject structured data from page metadata:

```liquid
<head>
  {% if context.page.metadata.schema_type %}
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "{{ context.page.metadata.schema_type }}",
      "name": "{{ context.page.metadata.title | escape }}",
      "description": "{{ context.page.metadata.description | escape }}"
    }
    </script>
  {% endif %}
  {% yield 'head' %}
</head>
```

Pages provide the data:

```yaml
metadata:
  schema_type: Product
  title: "Blue Widget"
  description: "A high-quality blue widget"
```

## Content Security Policy Headers

Set CSP headers at the page level (since layouts cannot set response headers), but document the expected policy for layout assets:

```yaml
---
response_headers:
  Content-Security-Policy: "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"
---
```

For consistent CSP across all pages, create a shared module or partial that generates the correct header values.

## Print Layout Pattern

For pages that need print-friendly output, use a separate layout or yield slot:

```liquid
<head>
  {% render 'modules/common-styling/init' %}
  {% yield 'head' %}
  <style media="print">
    .no-print { display: none !important; }
    main { width: 100%; margin: 0; }
  </style>
</head>
<body>
  <div class="no-print">
    {% render 'shared/navigation' %}
  </div>
  <main>
    {{ content_for_layout }}
  </main>
  <div class="no-print">
    {% render 'shared/footer' %}
  </div>
</body>
```

## Performance Optimization

### Minimize partials in layouts

Each `{% render %}` call has overhead. Keep layout partials to essential shared components:

```liquid
{% comment %} GOOD: 3-4 partials {% endcomment %}
{% render 'shared/navigation' %}
{{ content_for_layout }}
{% render 'shared/footer' %}

{% comment %} AVOID: many small partials {% endcomment %}
{% render 'shared/skip_link' %}
{% render 'shared/top_bar' %}
{% render 'shared/logo' %}
{% render 'shared/nav_links' %}
{% render 'shared/search_bar' %}
{% render 'shared/user_menu' %}
```

Consolidate related partials into a single component.

### Avoid logic in layouts

Layouts should be mostly static HTML with minimal Liquid logic. Move conditional logic into partials:

```liquid
{% comment %} BAD: complex logic in layout {% endcomment %}
{% if context.current_user %}
  {% if context.current_user.role == 'admin' %}
    {% render 'admin/nav' %}
  {% else %}
    {% render 'user/nav' %}
  {% endif %}
{% else %}
  {% render 'guest/nav' %}
{% endif %}

{% comment %} GOOD: delegate to partial {% endcomment %}
{% render 'shared/navigation' %}
```

## Testing Layouts

Test that layouts render correctly by checking:

1. `{{ content_for_layout }}` inserts page content
2. `{% yield %}` slots render injected content
3. Flash messages appear and clear correctly
4. Navigation renders for both authenticated and guest users
5. Meta tags populate from page metadata with correct defaults

Use the `pos-cli gui serve` command to preview layouts locally during development.

## See Also

- [Layouts Overview](README.md) -- introduction and key concepts
- [Layouts Patterns](patterns.md) -- standard workflows
- [Layouts Gotchas](gotchas.md) -- common errors and limits
- [Assets Reference](../assets/README.md) -- managing CSS and JS assets
- [Translations](../translations/README.md) -- i18n for layout text
- [Caching](../caching/README.md) -- caching strategies for layout partials
