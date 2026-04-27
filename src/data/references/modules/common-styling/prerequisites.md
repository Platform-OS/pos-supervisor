# modules/common-styling — Required Setup

> Compatible with pos-cli 6.0.7+ (modernized canonical class names).
> Read this BEFORE adding any `pos-*` classes or rendering any
> `modules/common-styling/...` partial.

## Mental Model

This is a **partial-first**, **token-themed** CSS framework — not a
class-utility framework. Two corollaries:

- For anything beyond a button or a heading, **render a shipped partial**
  (`content/card`, `forms/upload`, `navigation/pagination`, etc.).
- For colors, gaps, spacing, **read the design tokens** in
  `pos-config.css` (CSS custom properties) — don't hardcode values.

The framework is NOT Tailwind, NOT Bootstrap, NOT a utility-class
generator. There are no atomic utilities like `pos-p-1`, `pos-text-primary`,
`pos-flex`, `pos-grid` — those names will NOT match any shipped CSS.

## Three Required Setup Steps

### 1. Render `init` in your layout `<head>`

```liquid
{% comment %} app/views/layouts/application.html.liquid {% endcomment %}
<!DOCTYPE html>
<html class="pos-app">
  <head>
    {% render 'modules/common-styling/init' %}
    ...
  </head>
  ...
</html>
```

`init` injects the `<link>` tags for every shipped CSS asset (button,
card, forms, toast, dialog, etc.) plus the JS for the interactive widgets
(multiselect, password strength meter, collapsible). Without it, no
styles or behaviors load.

### 2. Set `class="pos-app"` on the root element

```html
<html class="pos-app">
```

The shipped CSS is scoped to `.pos-app`. WITHOUT this class on a
container, NOTHING styles, even with `init` rendered.

You can scope to a sub-tree instead of the whole `<html>` if you're
embedding in a host page that has its own framework — put `pos-app` on a
container `<div>` and the styles only apply inside it.

### 3. (Optional) Pick a theme mode

```html
<!-- automatic via system preference -->
<html class="pos-app pos-theme-darkEnabled">

<!-- forced -->
<html class="pos-app pos-theme-dark">
```

If you don't add a theme class, the light theme is the default.

## Setup Checklist

- [ ] `pos-cli modules install common-styling` has been run.
- [ ] Layout `<head>` contains `{% render 'modules/common-styling/init' %}`.
- [ ] Root `<html>` (or top scope container) has `class="pos-app"`.
- [ ] No Tailwind / Bootstrap / utility-class generators are mixed in.
- [ ] Any custom CSS is loaded AFTER `init` so token overrides apply.
- [ ] You are using shipped partials for components (`content/card`,
      `forms/...`, `navigation/...`) rather than hand-composing.
- [ ] You are verifying class names against the live scan (or
      `module_info(name: 'common-styling')`) before committing them.

## Verifying a Class Name Exists

Before committing any `pos-*` class to your code:

```bash
node -e "import('./src/core/module-scanner.js').then(m => m.scanModule('.', 'common-styling').then(r => console.log(r.css_classes.filter(c => c.startsWith('pos-')).join('\n'))))" | grep -E '^pos-button'
```

If the class does NOT appear in the scan output, it does NOT ship.

## Module Dependencies

Per `modules/common-styling/pos-module.json` (1.37.27): no module
dependencies. It is a peer of `core` and `user` rather than depending on
either.

## Common First-Time Mistakes

1. Forgetting `pos-app` on the root → all styles invisible.
2. Forgetting `init` → CSS files never load.
3. Reaching for Tailwind / Bootstrap classes out of habit (`btn`,
   `container`, `flex`) — they don't ship.
4. Hand-composing `pos-alert-*`, `pos-card-header`, `pos-page-link
   active`, `pos-form-group`, `pos-input` — these are LEGACY names that
   no longer exist. Use the modern equivalents (see api.md and gotchas.md).
5. Loading custom CSS BEFORE `init` — your token overrides get reset
   by `pos-config.css`.

## See Also

- [README](README.md)
- [API](api.md)
- [Configuration](configuration.md)
- [Patterns](patterns.md)
- [Gotchas](gotchas.md)
- [Advanced](advanced.md)
