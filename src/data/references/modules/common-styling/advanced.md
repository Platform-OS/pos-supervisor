# modules/common-styling — Advanced Topics

> Compatible with pos-cli 6.0.7+ (modernized canonical class names).

## Theme Customization via Design Tokens

The shipped CSS exposes its tokens as CSS custom properties under
`pos-config.css`. Override them in your own stylesheet to retheme without
touching the framework files:

```css
/* app/assets/theme.css — loaded AFTER common-styling/init */
.pos-app {
  --pos-color-light-page-background: #fafafa;
  --pos-color-light-content-background: #fff;
  --pos-color-light-content-text: #1a1a1a;
  --pos-color-light-frame: #e6e6e6;
  --pos-gap-section-section: 3rem;
  --pos-gap-text-text: 0.75rem;
}
```

Wire it up:

```liquid
{% comment %} layout <head>, AFTER init render {% endcomment %}
{% render 'modules/common-styling/init' %}
<link rel="stylesheet" href="{{ 'theme.css' | asset_url }}">
```

Inspect `modules/common-styling/public/assets/style/pos-config.css` for
the canonical token list. Token naming pattern:
`--pos-color-{light|dark}-{role}` and `--pos-gap-{from-to}`.

## Dark Mode

The module ships dark variants automatically. Activate at the root:

```html
<!-- system-preference auto-switching -->
<html class="pos-app pos-theme-darkEnabled">

<!-- forced dark -->
<html class="pos-app pos-theme-dark">
```

The dark token set parallels the light one (`--pos-color-dark-*`). To
customize dark, override in a `[class~="pos-theme-dark"]` selector:

```css
.pos-theme-dark.pos-app,
.pos-theme-darkEnabled.pos-app {
  --pos-color-dark-content-background: #0d0d0d;
  --pos-color-dark-content-text: #e8e8e8;
}
```

## Extending Components

Components are partials + classes. To add a custom variant:

1. Add a class in your own stylesheet that COMPOSES the shipped class.
2. Use it alongside the shipped class.

```css
.my-button-cta {
  /* compose with pos-button rules */
  background: linear-gradient(135deg,
    var(--pos-color-light-accent),
    var(--pos-color-light-accent-2));
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
```

```html
<button class="pos-button pos-button-primary my-button-cta">
  Get Started
</button>
```

Don't use SCSS `@extend .pos-button` — the shipped CSS is plain CSS with
custom properties; SCSS toolchain may not be present.

## Custom Card Variants

Cards are render-with-extras: pass extra classes to the partial via
your own wrapper:

```liquid
<div class="my-premium-card">
  {% render 'modules/common-styling/content/card',
     url: '/x', title: 'Premium', content: '…',
     highlighted: true %}
</div>
```

```css
.my-premium-card .pos-card-content-title {
  color: var(--pos-color-light-accent);
}
.my-premium-card .pos-card-highlighted {
  border-color: var(--pos-color-light-accent);
}
```

## Responsive Design

The module ships NO grid system, NO `pos-col-*`. Use native CSS Grid /
Flexbox with media queries:

```css
.section-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--pos-gap-section-section);
}
@media (min-width: 768px) {
  .section-grid {
    grid-template-columns: 2fr 1fr;
  }
}
```

```html
<div class="section-grid">
  {% render 'modules/common-styling/content/card', ... %}
  {% render 'modules/common-styling/content/card', ... %}
</div>
```

## Transitions / Animations

The shipped CSS already animates a few interactive components (toasts on
load/unload, dialogs, collapsibles). For your own work:

```css
.pos-card {
  transition: box-shadow 200ms ease;
}
.pos-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
```

Toast load animation:

```html
<div class="pos-toast pos-toast-success">Saved.</div>
<!-- when hiding -->
<div class="pos-toast pos-toast-success pos-toast-unloading">Saved.</div>
```

## Overriding Shipped Partials

To customize a shipped partial, copy it to the module-override mirror:

```bash
mkdir -p app/modules/common-styling/public/views/partials/content
cp modules/common-styling/public/views/partials/content/card.liquid \
   app/modules/common-styling/public/views/partials/content/card.liquid
```

Edit the override; it shadows the shipped one when consumers `{% render
'modules/common-styling/content/card', ... %}`.

Keep overrides minimal — diverging too far from upstream means painful
module upgrades.

## Asset Performance

Add `?v={hash}` cache-busting via `asset_url`:

```liquid
<link rel="stylesheet" href="{{ 'custom.css' | asset_url }}">
```

`asset_url` already appends a content-hash query parameter. Don't add
your own.

## Accessibility

The shipped components ship with sane semantic markup (`<button>` for
interactive, `aria-*` where required, `role="alert"` on alerts via the
content/alert partial). When composing by hand, preserve these:

```html
<button class="pos-button pos-button-primary"
        aria-label="Submit form">Submit</button>
```

For alerts, prefer the partial — it sets `role="alert"` and the icon for
you.

## See Also

- [README](README.md)
- [API](api.md)
- [Configuration](configuration.md)
- [Patterns](patterns.md)
- [Gotchas](gotchas.md)
- [Prerequisites](prerequisites.md)
