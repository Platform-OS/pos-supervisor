# Design System — platformOS Integration Guide

This is the canonical guide for applying the project's CSS design system to platformOS files.
Always follow these steps exactly — do not improvise asset loading or inline styles.

## CSS Files

The design system ships as four layered CSS files. They must be loaded in this order:

| File | Purpose |
|------|---------|
| `design-tokens.css` | CSS custom properties (colors, spacing, typography, radius, motion) |
| `base.css` | Element resets — body, h1–h3, p |
| `utilities.css` | Layout helpers — `.container`, `.section`, `.layout-grid`, `.col-*` |
| `components.css` | UI components — `.btn`, `.card`, `.hero`, `.feature-grid` |

## Step 1 — Upload CSS files

Copy all four files to `app/assets/styles/`:

```
app/assets/styles/design-tokens.css
app/assets/styles/base.css
app/assets/styles/utilities.css
app/assets/styles/components.css
```

## Step 2 — Load in the layout

In `app/views/layouts/application.html.liquid`, add the four `<link>` tags inside `<head>`.
**Use the `asset_url` filter — never hardcode paths.**

```liquid
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ context.page.metadata.title | default: "My App" }}</title>
  <link rel="stylesheet" href="{{ 'design-tokens.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'base.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'utilities.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'components.css' | asset_url }}">
  {% yield 'head' %}
</head>
<body>
  {% render 'shared/header' %}
  {{ content_for_layout }}
  {% yield 'footer_scripts' %}
</body>
</html>
```

> **Why `asset_url`?** platformOS serves assets from a CDN. The filter resolves the correct URL
> for the deployed environment (staging, production). Hardcoded `/assets/` paths break on deploy.

## Step 3 — Page-specific extra styles

If a single page needs additional CSS, use `{% content_for 'head' %}` — never inline styles:

```liquid
---
slug: landing
---
{% content_for 'head' %}
  <style>
    .hero-headline { font-size: var(--font-size-5); }
  </style>
{% endcontent_for %}

<section class="hero">
  ...
</section>
```

## Dark mode

Toggle dark mode by setting `data-theme="dark"` on the `<html>` element. All token values
switch automatically — no class changes needed on child elements.

```liquid
<html lang="en" data-theme="{{ context.session.theme | default: 'light' }}">
```

## Rules (enforced by pos-supervisor)

- **No inline `style=""` attributes** — use design token classes or `{% content_for 'head' %}` overrides.
- **No arbitrary color/spacing values** — every value must come from a `--token` variable.
- **Accent color (`--color-accent`)** is for interactive states only (hover, focus, CTAs). Never use it for text or backgrounds.
- **Grid columns** must be used inside `.layout-grid`. Do not apply `.col-*` outside a grid wrapper.

## See Also

- [Classes Reference](./classes.md) — full list of all available CSS classes
- [Page Patterns](./patterns.md) — complete page templates for common layouts
- [Layouts Reference](../layouts/README.md) — how platformOS layouts work
- [common-styling Migration Guide](./common-styling-migration.md) — using both systems together,
  phantom class fixes, acceptable inline style exceptions, form patterns
