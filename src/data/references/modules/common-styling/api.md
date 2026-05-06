# modules/common-styling — API Reference

> Compatible with pos-cli 6.0.7+ (modernized canonical class names). The
> live class set is the source of truth — verify with
> `module_info(name: 'common-styling')` or scan `r.css_classes`.
> Fictional class names produce unstyled output.

## Composition Philosophy

This is a PARTIAL-FIRST framework, not a class-utility framework. For
anything more complex than a button or a heading, render a shipped
partial — they encode the design-system semantics correctly and ship the
right HTML structure. Hand-composing class soup is a footgun.

## Buttons

```html
<button class="pos-button pos-button-primary">Primary</button>
<button class="pos-button">Default</button>
<button class="pos-button pos-button-small">Small</button>
```

`pos-button-{secondary,danger,success,large}` do NOT ship.

## Cards

Use the partial:

```liquid
{% render 'modules/common-styling/content/card',
   url: '/posts/1', title: 'Title',
   content: 'Description', highlighted: true %}
```

If you need to compose by hand, the canonical structure is:

```html
<article class="pos-card pos-card-content">
  <a class="pos-card-content-permalink" href="/...">
    <h3 class="pos-card-content-title">Title</h3>
  </a>
  <div class="pos-card-content-image-container">
    <img class="pos-card-content-image" src="..." />
  </div>
  <p>Description</p>
  <footer class="pos-card-content-footer">…</footer>
</article>
```

`pos-card-header` and `pos-card-body` do NOT ship — those are legacy
names. Use `pos-card-content` and `pos-card-content-footer`.

## Alerts (use the partial)

```liquid
{% render 'modules/common-styling/content/alert',
   type: 'success', content: 'Saved.' %}
```

Renders `pos-card-alert pos-card-alert-success pos-card`. There is NO
`pos-alert-*` family — those names will NOT match any shipped CSS.
`type` must be one of: `success`, `error`, `warning`, `info`.

## Toasts (notifications)

```html
<div class="pos-toasts">
  <div class="pos-toast pos-toast-success">
    Saved.
    <button class="pos-toast-close" type="button">×</button>
  </div>
</div>
```

Toast variants: `pos-toast-success`, `pos-toast-error`,
`pos-toast-info`, `pos-toast-loading`, `pos-toast-unloading`.

## Forms

The shipped form partials handle the multi-element widgets:

```liquid
{% render 'modules/common-styling/forms/error_list',
   errors: errors.title, name: 'title' %}

{% render 'modules/common-styling/forms/multiselect',
   id: 'tags', name: 'tags',
   options: tag_options, selected: object.tags %}

{% render 'modules/common-styling/forms/password',
   id: 'password', name: 'password' %}

{% render 'modules/common-styling/forms/upload',
   id: 'image', name: 'image',
   presigned_upload: presigned, allowed_file_types: ['image/*'] %}

{% render 'modules/common-styling/forms/hcaptcha' %}
{% render 'modules/common-styling/forms/markdown', id: 'body', name: 'body' %}
```

Class families used inside these widgets:

- Inputs: `pos-form-input`, `pos-form-checkbox`, `pos-form-fieldset`,
  `pos-form-fieldset-combined`, `pos-form-actions`.
- Errors: `pos-form-error` on each `<li>` inside an
  `id="pos-form-{name}-error"` `<ul>` (see `forms/error_list.liquid`).
- Multiselect: `pos-form-multiselect-*` family (filter, list, items).
- Password: `pos-form-password-*` family with strength indicators
  (`pos-form-password-strength-{weak,medium,strong,1..3}`).

`pos-input`, `pos-label`, `pos-form-group`, `pos-checkbox` (without the
`pos-form-` prefix) do NOT ship — those are legacy names.

## Avatars

```html
<img class="pos-avatar pos-avatar-md" src="..." alt="…" />
```

Sizes: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl` — each as a modifier
class (`pos-avatar-md` etc.).

## Tags / Chips

```html
<ul class="pos-tags-list">
  <li class="pos-tag pos-tag-confirmation">confirmed</li>
  <li class="pos-tag pos-tag-warning">warn</li>
  <li class="pos-tag pos-tag-important">!</li>
  <li class="pos-tag pos-tag-interactive">click me</li>
</ul>
```

## Dialogs (modals)

Use the partial:

```liquid
{% render 'modules/common-styling/content/dialog',
   id: 'confirm-delete', title: 'Delete?',
   actions: actions_html, body: body_html %}
```

Class structure: `pos-dialog`, `pos-dialog-header`,
`pos-dialog-actions`, `pos-dialog-close`.

## Headings

```html
<h1 class="pos-heading-1">Title</h1>
<h2 class="pos-heading-with-action">
  Section <small>extra detail</small>
</h2>
```

`pos-heading-1` … `pos-heading-6` ship.

## Pagination

```liquid
{% render 'modules/common-styling/navigation/pagination',
   total_pages: result.records.total_pages %}
```

The partial owns the class structure; `pos-pagination` is the wrapper.
`pos-page-link` does NOT ship as a standalone — render the partial.

## Utility Classes (semantic, NOT atomic)

The module ships a small semantic-utility set, NOT a Tailwind-style
atomic-utility set:

- Gaps: `pos-gap-section-section`, `pos-gap-text-text`,
  `pos-gap-button-button`, etc. (named by SEMANTIC pair, not size).
- Margins: `pos-mt-section-section`, `pos-mt-text-text`, etc. (top-only,
  named pair).

There is NO `pos-p-1`, `pos-m-2`, `pos-text-primary`, `pos-flex`,
`pos-grid`, `pos-col-*`, `pos-row`. If you need a grid layout, use
native CSS Grid / Flexbox via your own scoped class.

## See Also

- [README](README.md) — overview + class inventory
- [Configuration](configuration.md) — setup + scope
- [Patterns](patterns.md) — common compositions
- [Gotchas](gotchas.md) — fictional-class footguns
- [Advanced](advanced.md) — overrides, dark-mode, custom themes
- [Prerequisites](prerequisites.md) — required app-side setup
