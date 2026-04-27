# modules/common-styling — Common Patterns

> Compatible with pos-cli 6.0.7+ (modernized canonical class names).
> The framework is partial-first — render the shipped partials rather
> than hand-composing class soup.

## Layout Patterns

### Basic Page Layout

```liquid
{% comment %} app/views/layouts/application.html.liquid {% endcomment %}
<!DOCTYPE html>
<html class="pos-app">
  <head>
    {% render 'modules/common-styling/init' %}
    <title>{{ page.title | default: 'My App' }}</title>
  </head>
  <body>
    <header>
      <h1 class="pos-heading-1">My App</h1>
    </header>
    <main>
      {{ content_for_layout }}
    </main>
    <footer>
      <p>&copy; 2026</p>
    </footer>
  </body>
</html>
```

`pos-app` goes on the `<html>` tag, NOT a wrapper `<div>` (per the
shipped style-guide).

### Multi-Column Layout (use native CSS Grid/Flexbox)

The module ships NO grid system. Use native CSS:

```html
<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem;">
  {% render 'modules/common-styling/content/card', title: 'Main', content: '...' %}
  {% render 'modules/common-styling/content/card', title: 'Side', content: '...' %}
</div>
```

Or scope a project-specific class in your own CSS file. Don't reach for
`pos-row` / `pos-col-*` — those don't ship.

## Form Patterns

### Login Form (composed via shipped partials)

```liquid
<form class="pos-form" method="post">
  <fieldset class="pos-form-fieldset">
    <label for="email">Email</label>
    <input class="pos-form-input" type="email" name="email" id="email" required>
    {% render 'modules/common-styling/forms/error_list',
       errors: errors.email, name: 'email' %}
  </fieldset>

  {% render 'modules/common-styling/forms/password',
     id: 'password', name: 'password' %}

  <div class="pos-form-actions">
    <button type="submit" class="pos-button pos-button-primary">Sign In</button>
  </div>
</form>
```

### Search Form

```liquid
<form class="pos-form" method="get">
  <fieldset class="pos-form-fieldset pos-form-fieldset-combined">
    <input class="pos-form-input" type="text" name="q" placeholder="Search…">
    <button type="submit" class="pos-button pos-button-primary">Search</button>
  </fieldset>
</form>
```

## Data Display

### Card List

```liquid
{% for item in items %}
  {% render 'modules/common-styling/content/card',
     url: item.url,
     title: item.title,
     content: item.description,
     image: item.image,
     highlighted: item.featured %}
{% endfor %}
```

### Notification Display (use the alert partial, not class soup)

```liquid
{% if notice %}
  {% render 'modules/common-styling/content/alert',
     type: 'success', content: notice %}
{% endif %}

{% if error %}
  {% render 'modules/common-styling/content/alert',
     type: 'error', content: error %}
{% endif %}
```

For non-blocking notifications (toasts), render the toast structure
directly:

```html
<div class="pos-toasts">
  <div class="pos-toast pos-toast-success">
    Saved.
    <button class="pos-toast-close" type="button">×</button>
  </div>
</div>
```

## Pagination

```liquid
{% render 'modules/common-styling/navigation/pagination',
   total_pages: result.records.total_pages,
   current_page: context.params.page %}
```

The shipped partial owns the markup. There is no `pos-page-link active`
hand-composable class — use the partial.

## Style-Guide Reference (live, on-instance)

The module renders its own style guide at `/style-guide` for any instance
that has it installed. Each section has a corresponding partial under
`views/partials/style-guide/` (e.g. `buttons.liquid`, `forms.liquid`,
`toasts.liquid`) — use those as the canonical reference for class
combinations.

## Dark Mode

```html
<!-- system-preference auto -->
<html class="pos-app pos-theme-darkEnabled">

<!-- forced -->
<html class="pos-app pos-theme-dark">
```

Components that ship dark variants pick them up automatically; no
component-level toggling is needed.

## See Also

- [README](README.md) — overview + class inventory
- [API](api.md) — class families + render-able partials
- [Configuration](configuration.md) — setup
- [Gotchas](gotchas.md) — fictional-class footguns
- [Advanced](advanced.md) — overrides, custom themes
- [Prerequisites](prerequisites.md) — required setup before using this module
