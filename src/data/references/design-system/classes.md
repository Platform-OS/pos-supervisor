# Design System — CSS Class Reference

All available classes. Only these classes are valid — do not invent new ones without
adding them to `components.css` first.

## Layout

| Class | Description |
|-------|-------------|
| `.container` | Centered content wrapper, max-width 1200px, horizontal padding |
| `.section` | Full-width section with vertical padding (`--space-6` top/bottom) |
| `.section-alt` | Same as `.section` but with `--color-surface` background (white) |
| `.layout-grid` | 12-column CSS grid with `--space-4` gap |
| `.col-4` | Spans 4 of 12 columns (one-third) |
| `.col-6` | Spans 6 of 12 columns (half) |
| `.col-8` | Spans 8 of 12 columns (two-thirds) |
| `.col-12` | Spans all 12 columns (full width) |

> All `.col-*` classes collapse to `grid-columns: 1fr` on screens ≤ 768px.

## Components

| Class | Description |
|-------|-------------|
| `.btn` | Base button/link style — padding, border-radius, font-weight, transition |
| `.btn-primary` | Primary CTA — `--color-primary` background, white text, lift-on-hover |
| `.card` | Content card — white surface, shadow, rounded corners, lift-on-hover |
| `.hero` | Hero section wrapper — `--space-6` vertical padding |
| `.feature-grid` | 3-column grid for feature cards, collapses to 1 column on mobile |

## Design Tokens (CSS Variables)

Use these in `{% content_for 'head' %}` blocks or in `components.css` extensions.
Never hardcode hex values or px sizes.

### Colors
```css
var(--color-primary)   /* #0B3D91 — brand blue */
var(--color-accent)    /* #FF5C35 — interaction only (CTAs, hover, focus) */
var(--color-bg)        /* #F8FAFC — page background */
var(--color-surface)   /* #FFFFFF — card/panel surface */
var(--color-text)      /* #0F172A — primary text */
var(--color-muted)     /* #64748B — secondary text, captions */
var(--color-border)    /* #E2E8F0 — borders, dividers */
```

### Typography
```css
var(--font-size-1)   /* clamp(14px, 0.8vw, 16px) — small/caption */
var(--font-size-2)   /* clamp(16px, 1vw, 18px) — body (base) */
var(--font-size-3)   /* clamp(20px, 1.5vw, 24px) — h3 */
var(--font-size-4)   /* clamp(28px, 3vw, 40px) — h2 */
var(--font-size-5)   /* clamp(36px, 5vw, 64px) — h1 */
var(--line-height-tight)   /* 1.2 — headings */
var(--line-height-normal)  /* 1.6 — body text */
```

### Spacing
```css
var(--space-1)   /* 8px */
var(--space-2)   /* 16px */
var(--space-3)   /* 24px */
var(--space-4)   /* 32px */
var(--space-5)   /* 48px */
var(--space-6)   /* 64px */
```

### Other
```css
var(--radius-sm)        /* 6px */
var(--radius-md)        /* 12px */
var(--radius-lg)        /* 20px */
var(--shadow-sm)        /* subtle card shadow */
var(--shadow-md)        /* elevated/hover shadow */
var(--ease-standard)    /* cubic-bezier(.4,.0,.2,1) */
var(--duration-fast)    /* 150ms */
var(--duration-medium)  /* 250ms */
```

## Combining Classes

```liquid
<!-- Section with alternating background -->
<section class="section section-alt">
  <div class="container">
    ...
  </div>
</section>

<!-- Two-thirds + one-third layout inside a grid -->
<div class="layout-grid">
  <div class="col-8">main content</div>
  <div class="col-4">sidebar</div>
</div>

<!-- Button as anchor -->
<a href="/items/new" class="btn btn-primary">Create Listing</a>

<!-- Card -->
<div class="card">
  <h3>{{ item.title }}</h3>
  <p>{{ item.description }}</p>
</div>
```

## What NOT to Do

```liquid
<!-- WRONG: inline style -->
<div style="padding: 32px; background: #fff;">

<!-- WRONG: arbitrary value -->
<div style="color: #333;">

<!-- WRONG: col without layout-grid -->
<div class="col-8">

<!-- WRONG: accent color on body text -->
<p style="color: var(--color-accent);">

<!-- RIGHT: use tokens via content_for or component class -->
<div class="card">
```
