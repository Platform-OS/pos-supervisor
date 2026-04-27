# modules/common-styling — Common Gotchas

> Compatible with pos-cli 6.0.7+ (modernized canonical class names).

## TOP GOTCHA: Don't Hand-Compose Fictional Class Names

A whole family of plausible-looking class names DO NOT ship in this
module. Putting them in your HTML produces unstyled output:

| Fictional (don't use)                          | Reason                                                |
|------------------------------------------------|-------------------------------------------------------|
| `pos-btn`, `pos-btn-primary`                   | Class is `pos-button`, not `pos-btn`                  |
| `pos-button-secondary` / `-danger` / `-success`/ `-large` | Only `pos-button-primary` and `pos-button-small` ship |
| `pos-card-header` / `pos-card-body` / `pos-card__title` | Use `pos-card-content`, `pos-card-content-title`, `pos-card-content-footer` |
| `pos-alert-success` / `pos-alert-error` / `pos-alert-warning` / `pos-alert-danger` | Use the `content/alert` partial OR `pos-card-alert pos-card-alert-{type}` |
| `pos-row`, `pos-col-12`, `pos-col-md-6`        | NO grid system ships — use native CSS Grid/Flexbox    |
| `pos-p-1`, `pos-m-2`, `pos-text-primary`, `pos-flex`, `pos-grid` | NO Tailwind-style atomic utilities ship   |
| `pos-input`, `pos-label`, `pos-checkbox`, `pos-form-group` | Use `pos-form-input`, `pos-form-checkbox`, `pos-form-fieldset` |
| `pos-page-link active` (pagination)            | Use the `navigation/pagination` partial               |
| `pos-btn-block`                                | NO block helper ships — set `width: 100%` if you need it |

ALWAYS verify a class name against the live scan
(`module_info(name: 'common-styling')` or
`r.css_classes.filter(c => c.startsWith('pos-'))`) before committing it.

## Don't Mix Tailwind / Bootstrap

The shipped `pos-config.css` defines design tokens (CSS custom properties)
that the rest of the module consumes. Mixing Tailwind utilities or
Bootstrap classes leads to:

- Conflicting reset rules (Bootstrap's `*` reset fights `pos-reset.css`).
- Tokens out of sync — Tailwind's defaults override `--pos-color-*` vars,
  breaking dark mode and theme overrides.

```html
<!-- WRONG - foreign framework -->
<button class="btn btn-primary">Click</button>

<!-- CORRECT - shipped class -->
<button class="pos-button pos-button-primary">Click</button>
```

## `pos-app` Goes on `<html>`, Not a Wrapper Div

The shipped CSS scopes selectors to `.pos-app`. Without that class on a
container, NOTHING styles. Per the shipped style guide
(`partials/style-guide/initialization.liquid`), the canonical home is the
root `<html>` tag:

```html
<!-- CORRECT -->
<html class="pos-app">
  <head>
    {% render 'modules/common-styling/init' %}
  </head>
  ...
</html>
```

If you need to scope styles to a sub-tree (e.g. embedding in a host page
that already has its own framework), you can also put `pos-app` on a
container `<div>` — the styles cascade only inside it.

```html
<!-- WRONG - no pos-app anywhere -->
<body>
  <button class="pos-button">Wrong</button>
</body>
```

## Forgetting to Render `init`

`{% render 'modules/common-styling/init' %}` injects the asset link
tags. Without it, the CSS never loads:

```liquid
<!-- WRONG - styles never reach the browser -->
<html class="pos-app">
  <head><title>App</title></head>
  ...
</html>

<!-- CORRECT -->
<html class="pos-app">
  <head>
    {% render 'modules/common-styling/init' %}
    <title>App</title>
  </head>
  ...
</html>
```

## Card Sub-Element Names (modernized)

The card sub-elements are hyphenated, not BEM:

```html
<!-- WRONG (legacy/BEM) -->
<div class="pos-card">
  <div class="pos-card__title">Title</div>
  <div class="pos-card__body">Body</div>
</div>

<!-- CORRECT (modern) -->
<article class="pos-card pos-card-content">
  <h3 class="pos-card-content-title">Title</h3>
  <p>Body</p>
  <footer class="pos-card-content-footer">…</footer>
</article>
```

For most cases, RENDER the partial instead of hand-composing:

```liquid
{% render 'modules/common-styling/content/card',
   url: '/x', title: 'Title', content: 'Body' %}
```

## Form Composition (modernized)

Forms use `pos-form-fieldset` (not `pos-form-group`) to wrap a label +
input. Inputs are `pos-form-input` (not `pos-input`):

```html
<!-- WRONG (legacy) -->
<form class="pos-form">
  <div class="pos-form-group">
    <label class="pos-label">Email</label>
    <input class="pos-input" type="email">
  </div>
</form>

<!-- CORRECT (modern) -->
<form class="pos-form">
  <fieldset class="pos-form-fieldset">
    <label for="email">Email</label>
    <input class="pos-form-input" type="email" id="email">
  </fieldset>
</form>
```

For complex widgets (multiselect, password, upload, hcaptcha, markdown),
RENDER the shipped partial under `forms/`:

```liquid
{% render 'modules/common-styling/forms/upload',
   id: 'image', name: 'image',
   presigned_upload: presigned, allowed_file_types: ['image/*'] %}
```

## Toasts vs Alerts — Different Things

- **Alerts** are inline, content-flow notifications.
  Use `content/alert` partial → renders as `pos-card-alert`.
- **Toasts** are floating, transient notifications.
  Hand-composed using the `pos-toasts` container + `pos-toast` items.

There is NO `pos-alert-*` family. Don't confuse the two — alerts and
toasts have different visual + behavior contracts.

## Pagination Active State

The shipped pagination partial owns the active-page class. Don't hand-roll:

```liquid
<!-- WRONG: pos-page-link doesn't ship as a standalone class -->
<a class="pos-page-link active" href="?page=2">2</a>

<!-- CORRECT: render the partial -->
{% render 'modules/common-styling/navigation/pagination',
   total_pages: result.records.total_pages %}
```

## See Also

- [README](README.md) — class inventory
- [API](api.md) — class families + partials
- [Configuration](configuration.md) — setup
- [Patterns](patterns.md) — composition recipes
- [Advanced](advanced.md) — overrides + custom themes
- [Prerequisites](prerequisites.md) — required setup checklist
