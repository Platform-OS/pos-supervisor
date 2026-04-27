# pos-module-common-styling

The CSS framework + reusable partials for platformOS projects. NEVER mix
in Tailwind, Bootstrap, or custom CSS frameworks — they fight the shipped
design tokens.

**Required module** on most apps. Compatible with pos-cli 6.0.7+
(modernized canonical class names + partial names).

## Install

```bash
pos-cli modules install common-styling
```

## Setup

```liquid
{% comment %} layout <head> {% endcomment %}
{% render 'modules/common-styling/init' %}
```

```html
<!-- root html element gets the namespace class -->
<html class="pos-app">
```

For dark mode, add `pos-theme-darkEnabled` (auto via system preference) or
`pos-theme-dark` (forced).

```html
<html class="pos-app pos-theme-darkEnabled">
```

## Viewing Components

Browse the shipped style guide at `/style-guide` on any instance with this
module installed. Each section is a self-contained partial under
`views/partials/style-guide/` — copy what you need.

## Class Inventory (live)

The full `pos-*` class set is scanned from disk:

```bash
node -e "import('./src/core/module-scanner.js').then(m => m.scanModule('.', 'common-styling').then(r => console.log(r.css_classes.filter(c => c.startsWith('pos-')).join('\\n'))))"
```

This is the source of truth. `module_info(name: 'common-styling')` exposes
the same list. Class families:

- **Buttons**: `pos-button`, `pos-button-primary`, `pos-button-small`,
  `pos-button-label`. There is NO `pos-button-secondary` / `-danger` /
  `-success` / `-large` — those don't ship.
- **Cards**: `pos-card`, `pos-card-content`, `pos-card-content-footer`,
  `pos-card-content-image`, `pos-card-content-title`,
  `pos-card-content-permalink`, `pos-card-highlighted`. Card sub-elements
  are NOT BEM (`__`); they're hyphenated.
- **Alerts**: rendered via the `content/alert` partial; classes are
  `pos-card-alert` + `pos-card-alert-{success|error|warning|info}`. There
  is NO `pos-alert-*` family — those names will NOT match any shipped CSS.
- **Toasts**: `pos-toast`, `pos-toast-error`, `pos-toast-success`,
  `pos-toast-info`, `pos-toast-loading`, `pos-toast-close`, `pos-toasts`
  (container).
- **Forms**: `pos-form`, `pos-form-input`, `pos-form-error`,
  `pos-form-fieldset`, `pos-form-checkbox`, `pos-form-multiselect-*`,
  `pos-form-password-*`, `pos-form-actions`. Use the partials under
  `partials/forms/` for the multi-element widgets (multiselect, password,
  upload).
- **Avatars**: `pos-avatar`, `pos-avatar-{xs,sm,md,lg,xl,2xl,3xl}`.
- **Tags**: `pos-tag`, `pos-tag-confirmation`, `pos-tag-warning`,
  `pos-tag-important`, `pos-tag-interactive`, `pos-tags-list`.
- **Dialog**: `pos-dialog`, `pos-dialog-actions`, `pos-dialog-close`,
  `pos-dialog-header`, `pos-dialog-header-simple`.
- **Headings**: `pos-heading-{1..6}`, `pos-heading-with-action`.
- **Utility (semantic)**: `pos-gap-{section-section, text-text, …}`,
  `pos-mt-{...}`. NOT Tailwind-style atomic utilities — there's NO
  `pos-p-1`, `pos-mt-2`, `pos-text-primary`, `pos-flex`, `pos-grid`.

## Key Components (renderable partials)

```liquid
{% comment %} content card {% endcomment %}
{% render 'modules/common-styling/content/card',
   url: '/posts/1', title: 'Title',
   content: 'Description', highlighted: true %}

{% comment %} alert box {% endcomment %}
{% render 'modules/common-styling/content/alert',
   type: 'success', content: 'Saved.' %}

{% comment %} dialog (modal) {% endcomment %}
{% render 'modules/common-styling/content/dialog', ... %}

{% comment %} navigation widget {% endcomment %}
{% render 'modules/common-styling/navigation/collapsible', ... %}

{% comment %} form bits {% endcomment %}
{% render 'modules/common-styling/forms/error_list', errors: errors, name: 'title' %}
{% render 'modules/common-styling/forms/multiselect', ... %}
{% render 'modules/common-styling/forms/password', ... %}
{% render 'modules/common-styling/forms/upload',
   id: 'image', name: 'image',
   presigned_upload: presigned, allowed_file_types: ['image/*'] %}

{% comment %} user-facing avatar / card {% endcomment %}
{% render 'modules/common-styling/user/avatar', user: user %}
{% render 'modules/common-styling/user/card',   user: user %}
```

## Rules

- ALWAYS initialize with `{% render 'modules/common-styling/init' %}` in
  the layout `<head>`.
- ALWAYS set `class="pos-app"` on the `<html>` tag.
- NEVER mix in Tailwind / Bootstrap / utility-class generators.
- VERIFY every class name against the live scan — fictional names produce
  unstyled output.
- Prefer `{% render '...partial' %}` over hand-composed class soup; the
  shipped partials encode the design-system semantics correctly.
- For alerts use `content/alert`, NOT `pos-alert-*` classes (which don't
  exist).

## See Also

- [Configuration](configuration.md) — full setup
- [API](api.md) — class families + render-able partials
- [Patterns](patterns.md) — common compositions
- [Gotchas](gotchas.md) — fictional-class footguns
- [Advanced](advanced.md) — overrides, dark-mode, custom themes
- [Prerequisites](prerequisites.md) — required app-side setup
- Live class set: `module_info(name: 'common-styling')`
