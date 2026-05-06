# modules/common-styling — Configuration

> Compatible with pos-cli 6.0.7+ (modernized canonical class names).

## Overview

`modules/common-styling` provides the CSS framework + reusable Liquid
partials for platformOS apps. It is partial-first: the shipped partials
are the canonical source of truth for component composition. The CSS is
scoped to a `.pos-app` container; design tokens live in
`pos-config.css` as CSS custom properties.

## Installation

```bash
pos-cli modules install common-styling
```

`common-styling` has no module dependencies (per `pos-module.json` 1.37.27).

## Required Initialization (canonical layout)

```liquid
{% comment %} app/views/layouts/application.html.liquid {% endcomment %}
<!DOCTYPE html>
<html class="pos-app">
  <head>
    {% render 'modules/common-styling/init' %}
    <meta charset="utf-8" />
    <title>{{ page.title | default: 'My App' }}</title>
  </head>
  <body>
    {{ content_for_layout }}
  </body>
</html>
```

Two things MUST be present:

1. `class="pos-app"` on the `<html>` element (or a top-level scope
   container if you're embedding in a host page that already has its own
   styling).
2. `{% render 'modules/common-styling/init' %}` inside `<head>`. This
   injects the asset link tags. Without this render, the CSS never loads.

`init` may also be rendered inside `<body>` if you can't touch `<head>`,
but `<head>` is canonical.

### Dark Mode

```html
<!-- automatic via system preference -->
<html class="pos-app pos-theme-darkEnabled">

<!-- forced -->
<html class="pos-app pos-theme-dark">
```

## Asset Layout

CSS files ship under `modules/common-styling/public/assets/style/`:

```
pos-reset.css       /* base reset */
pos-config.css      /* design tokens (CSS variables) */
pos-typography.css
pos-button.css
pos-card.css
pos-toast.css
pos-dialog.css
pos-popover.css
pos-tag.css
pos-table.css
pos-pagination.css
pos-forms.css
pos-avatar.css
pos-collapsible.css
pos-markdown.css
pos-upload.css
pos-utility.css     /* SEMANTIC utilities (gaps, margins) — NOT atomic */
dependency-easyMde.css
dependency-highlightJs.css
dependency-uppy.css
```

`{% render 'modules/common-styling/init' %}` wires up these assets via
`asset_url` automatically. You do not need to add `<link>` tags by hand.

## Class-Naming Convention

All shipped classes use the `pos-` prefix. Sub-elements are HYPHENATED,
not BEM (`pos-card-content-title`, NOT `pos-card__title`). Modifiers are
hyphenated suffixes (`pos-button-primary`, NOT `pos-button--primary`).

Verify a class name against the live scan before committing it:

```bash
node -e "import('./src/core/module-scanner.js').then(m => m.scanModule('.', 'common-styling').then(r => console.log(r.css_classes.filter(c => c.startsWith('pos-')).join('\n'))))"
```

## Don't Mix Foreign Frameworks

The shipped reset + tokens fight Tailwind / Bootstrap on contact. Do NOT
mix:

```liquid
<!-- WRONG -->
<button class="btn btn-primary pos-button">Mixed</button>

<!-- CORRECT -->
<button class="pos-button pos-button-primary">OK</button>
```

## Style Guide

Browse `/style-guide` on any instance for an interactive reference. Each
section corresponds to a partial under `views/partials/style-guide/`
(buttons, forms, toasts, headings, tables, etc.).

## Extending Styles via Custom CSS

Use the shipped CSS variables for colors, gaps, typography. Don't
hard-code colors:

```css
/* app/assets/custom.css */
.my-section {
  color: var(--pos-color-light-content-text);
  background: var(--pos-color-light-content-background);
  border: 1px solid var(--pos-color-light-frame);
  gap: var(--pos-gap-section-section);
}
```

The token names follow `--pos-color-{light|dark}-{role}` and
`--pos-gap-{from-to}` conventions; inspect `pos-config.css` for the full
set.

Add the asset to your layout via `asset_url`:

```liquid
<link rel="stylesheet" href="{{ 'custom.css' | asset_url }}">
```

## Component Library (renderable partials)

Pre-built compositions:

- `content/card`, `content/alert`, `content/dialog`
- `forms/error_list`, `forms/multiselect`, `forms/password`,
  `forms/upload`, `forms/markdown`, `forms/hcaptcha`
- `navigation/collapsible`, `navigation/pagination`
- `user/avatar`, `user/card`
- `style-guide/*` (each section of the live style guide)

```liquid
{% render 'modules/common-styling/content/card', ... %}
```

## See Also

- [README](README.md) — class inventory
- [API](api.md) — class families + partial signatures
- [Patterns](patterns.md) — composition recipes
- [Gotchas](gotchas.md) — fictional-class footguns
- [Advanced](advanced.md) — overrides, custom themes
- [Prerequisites](prerequisites.md) — setup checklist
