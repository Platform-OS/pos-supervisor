# Design System — common-styling Coexistence Guide

For projects where `modules/common-styling` is already installed alongside the custom CSS design system.

---

## Load Order

`modules/common-styling/init` must load **before** the design system CSS files:

```liquid
<!-- app/views/layouts/application.html.liquid -->
<head>
  {% render 'modules/common-styling/init', reset: true %}
  <link rel="stylesheet" href="{{ 'styles/design-tokens.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'styles/base.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'styles/utilities.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'styles/components.css' | asset_url }}">
</head>
```

Loading design-tokens.css after common-styling ensures design system tokens take precedence.
The `asset_url` filter is required — hardcoded `/assets/` paths break on deploy.

---

## What common-styling Provides (keep using these)

| Class | Use for |
|-------|---------|
| `pos-button`, `pos-button-primary`, `pos-button-secondary`, `pos-button-small` | All button/CTA elements |
| `pos-link` | Styled links |
| `pos-heading-1` … `pos-heading-4` | Semantic heading sizes |
| `pos-form`, `pos-form-simple` | Form wrapper |
| `pos-input`, `pos-label` | Input/label styling |
| `pos-form-actions` | Form button row |
| `pos-site-header` | Header bar background + border |

Form error module partials — always include `name:` param:

```liquid
{% render 'modules/common-styling/forms/error_list', errors: object.errors, name: 'form' %}
{% render 'modules/common-styling/forms/error_input_handler', errors: object.errors.field, name: 'field' %}
```

Without `name:`, ARIA `aria-describedby` linkage breaks and pos-supervisor raises `MetadataParamsCheck` errors.

---

## What the Design System Provides (use for layout and content)

| Class | Use for |
|-------|---------|
| `container` | Max-width centered wrapper |
| `section` | Vertical padding block |
| `section-alt` | Alternating background section |
| `layout-grid` | 12-column grid |
| `col-4`, `col-6`, `col-8`, `col-12` | Grid columns |
| `card` | Content card — surface, shadow, rounded corners |
| `feature-grid` | 3-column responsive card grid |
| `hero` | Hero section wrapper |
| `btn`, `btn-primary` | Alternative button set (design-system styled) |

---

## Inline Style Exception — Flex Layout

Neither common-styling nor the design system provides a `.flex` utility class. Use inline styles for flex containers — this is the one accepted exception to the no-inline-styles rule:

```liquid
<!-- header nav row -->
<div class="container" style="display:flex; align-items:center; justify-content:space-between; padding-block:0.875rem;">

<!-- action button row -->
<div style="display:flex; gap:var(--space-2); flex-wrap:wrap; align-items:center;">

<!-- inline form (sign-out) -->
<form action="/sessions" method="post" style="display:inline">
```

Rules for inline style exceptions:
- Only for `display:flex`, flex alignment, `gap`, `display:inline`
- Spacing values must use `var(--space-N)` tokens
- Color values must use `var(--color-*)` tokens
- Never use inline styles for `padding`, `margin`, `background`, `border` — use component/section classes instead

---

## The Header Pattern

```liquid
{% doc %}
  Navigation header partial. Reads auth state from context directly.
{% enddoc %}

<header class="pos-site-header">
  <div class="container" style="display:flex; align-items:center; justify-content:space-between; padding-block:0.875rem;">
    <a href="/" style="font-size:var(--font-size-3); font-weight:700; color:var(--color-primary); text-decoration:none;">Site Title</a>

    <ul style="display:flex; align-items:center; gap:var(--space-2); list-style:none; margin:0; padding:0;">
      <li><a href="/items" class="pos-link">Items</a></li>
      {% if context.current_user.id %}
        <li><a href="/items/new" class="pos-button pos-button-primary pos-button-small">New Item</a></li>
        <li>
          <form action="/sessions" method="post" style="display:inline">
            <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
            <input type="hidden" name="_method" value="delete">
            <button type="submit" class="pos-button pos-button-small">Sign Out</button>
          </form>
        </li>
      {% else %}
        <li><a href="/sessions/new" class="pos-link">Sign In</a></li>
        <li><a href="/users/new" class="pos-button pos-button-secondary pos-button-small">Sign Up</a></li>
      {% endif %}
    </ul>
  </div>
</header>
```

Key points:
- Auth check uses `context.current_user.id` (not `context.current_user`)
- Sign-out is a POST form with `_method: delete`
- Sign-in URL is `/sessions/new` — not `/sessions`
- Sign-up URL is `/users/new` — not `/users`

---

## The toasts Partial — Known Linter Noise

```liquid
{% theme_render_rc 'modules/common-styling/toasts' %}
```

pos-supervisor reports `MetadataParamsCheck` errors on this line. These are expected — the toasts partial uses `{% comment %}` for param declarations (older module convention) rather than `{% doc %}`. The params all have `| default:` fallbacks so functionality is unaffected. These errors cannot be fixed at the app level.

---

## See Also

- [Classes Reference](./classes.md)
- [Page Patterns](./patterns.md)
