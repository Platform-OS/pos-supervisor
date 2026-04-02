# Flash Messages Configuration

## Overview

Flash messages in platformOS are temporary notifications displayed to users via the `pos-module-core` module. They persist across a single redirect and are automatically cleared.

## Module Setup

Flash messages require `pos-module-core` to be installed and included in your module dependencies.

### Enable in Module Configuration

In `app/modules/module.yml`:

```yaml
dependencies:
  - pos-module-core
```

### Include Flash Helper in Layout

Add to main layout file (`app/views/layouts/application.liquid`):

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}
```

This initializes the flash context for the current request.

## Flash Message Types

platformOS supports four flash message types:

| Type | CSS Class | Use Case |
|------|-----------|----------|
| `notice` / `success` | `.notice` | Positive confirmation, success messages |
| `alert` / `error` | `.alert` | Error messages, warnings |
| `warning` | `.warning` | Non-critical warnings |
| `info` | `.info` | Informational messages |

## Session Flash Management

Flash messages are stored in the session and cleared based on page navigation:

```liquid
{% if sflash %}
  {% assign current_path = request.url_path %}
  {% if current_path != previous_path %}
    {% assign sflash = nil %}
  {% endif %}
{% endif %}
```

## Flash Storage Structure

Flash data is stored in session with the following structure:

```json
{
  "notice": "user.profile_updated",
  "alert": null,
  "warning": null,
  "info": null,
  "pathname": "/dashboard"
}
```

Localization keys are resolved in views for multi-language support.

## Layout Pattern

Recommended layout structure for flash messages:

```liquid
<!DOCTYPE html>
<html>
<head>
  <title>{{ page.title }}</title>
</head>
<body>
  {% include 'modules/core/helpers/flash/get_flash' %}

  {% if sflash %}
    <div class="flash-container">
      {% if sflash.notice %}
        <div class="flash notice">
          {{ sflash.notice | t }}
        </div>
      {% endif %}
      {% if sflash.alert %}
        <div class="flash alert">
          {{ sflash.alert | t }}
        </div>
      {% endif %}
    </div>
  {% endif %}

  {{ page.body }}
</body>
</html>
```

## CSS Classes

Standard CSS for flash styling:

```css
.flash-container {
  position: relative;
  z-index: 1000;
}

.flash {
  padding: 16px;
  margin-bottom: 16px;
  border-radius: 4px;
  font-size: 14px;
}

.flash.notice,
.flash.success {
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
}

.flash.alert,
.flash.error {
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
}

.flash.warning {
  background-color: #fff3cd;
  border: 1px solid #ffeeba;
  color: #856404;
}

.flash.info {
  background-color: #d1ecf1;
  border: 1px solid #bee5eb;
  color: #0c5460;
}
```

## JavaScript Integration

Access flash messages from JavaScript:

```javascript
const flashMessage = document.querySelector('.flash.notice');
if (flashMessage) {
  console.log('Flash message:', flashMessage.textContent);
}
```

## File Structure

```
app/
├── views/layouts/
│   └── application.liquid
├── modules/
│   └── module.yml
└── graphql/
    └── mutations/
```

Flash helpers are provided by `pos-module-core` module.

## Best Practices

1. **Always redirect after setting flash** for best UX
2. **Use localization keys** for multi-language support
3. **Clear flash after showing** to prevent persistence
4. **Validate flash type** before rendering
5. **Use semantic types** (notice for success, alert for errors)

## See Also

- [Flash Messages API Reference](./api.md)
- [Common Patterns](./patterns.md)
- [Known Gotchas](./gotchas.md)
- [Advanced Techniques](./advanced.md)
