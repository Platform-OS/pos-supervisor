# Flash Messages Gotchas

## Overview

Common pitfalls and troubleshooting tips for flash message implementation in platformOS.

## Flash Not Appearing

### Module Not Included

Flash messages require `pos-module-core` in dependencies. Add to `app/modules/module.yml`:

```yaml
dependencies:
  - pos-module-core
```

Without this, the helper functions won't be available.

### Missing get_flash Include

Flash won't display if `get_flash` helper isn't called in your layout:

```liquid
<!-- Add to app/views/layouts/application.liquid -->
{% include 'modules/core/helpers/flash/get_flash' %}
```

Call this early in layout before rendering flash elements.

### Conditional Layout Application

Verify flash-enabled layout is used on redirect target page:

```liquid
<!-- Correct: Layout includes get_flash -->
{% if sflash %}
  <div class="alert">{{ sflash.notice | t }}</div>
{% endif %}
```

If layout doesn't include the helper, `sflash` variable is undefined.

## Flash Persisting Across Pages

### Pathname Not Changing

Flash should clear when pathname changes. Check that URL actually changed:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}
<!-- Debug: Check pathname -->
<!-- Current: {{ request.url_path }} -->
<!-- Previous: {{ sflash.pathname }} -->
```

If both are identical, flash persists (by design).

### Same URL with Different Anchors

URL anchors (#section) don't affect pathname, flash won't clear:

```
/page#section1 -> /page#section2
<!-- Same pathname, flash persists -->
```

Manually clear if needed:

```liquid
{% include 'modules/core/helpers/flash/clear' %}
```

## Localization Key Not Resolving

### Missing i18n Key

Flash expects localization keys to exist in translation files:

```yaml
# config/i18n/en.yml
en:
  user:
    profile_updated: "Your profile has been updated"
```

Without this key, `{{ flash_key | t }}` renders empty or the key itself.

### Wrong Key Format

Localization keys use dot notation:

```liquid
<!-- Correct -->
{% include 'modules/core/helpers/redirect_to',
  url: '/dashboard',
  notice: 'user.profile_updated'
%}

<!-- Incorrect -->
{% include 'modules/core/helpers/redirect_to',
  url: '/dashboard',
  notice: 'user-profile-updated'
%}
```

## Flash with Redirect Loop

### Incorrect URL in Redirect

Infinite redirect occurs if redirect URL points back to itself:

```liquid
<!-- WRONG: Creates redirect loop -->
{% if form.valid? %}
  {% include 'modules/core/helpers/redirect_to',
    url: request.url_path,
    notice: 'saved'
  %}
{% endif %}
```

Always redirect to a different URL:

```liquid
<!-- CORRECT -->
{% include 'modules/core/helpers/redirect_to',
  url: '/dashboard',
  notice: 'saved'
%}
```

## Multiple Flash Types Not Working

### Only One Type Renders

Only one flash message per type displays at a time:

```liquid
<!-- Second notice overwrites first -->
{% include 'modules/core/helpers/flash/publish', notice: 'first' %}
{% include 'modules/core/helpers/flash/publish', notice: 'second' %}
<!-- Only 'second' displays -->
```

Use single call with appropriate type or restructure logic.

### Mixed Types Work

Different types work together:

```liquid
{% include 'modules/core/helpers/redirect_to',
  url: '/form',
  notice: 'saved',
  warning: 'some_fields_empty'
%}
```

Both `notice` and `warning` will display.

## Flash with Dynamic Content

### User Input in Flash

Sanitize user input before putting in flash:

```liquid
<!-- UNSAFE -->
{% include 'modules/core/helpers/redirect_to',
  url: '/items',
  notice: user_provided_message
%}

<!-- SAFE -->
{% include 'modules/core/helpers/redirect_to',
  url: '/items',
  notice: 'item.created'
%}
```

Always use localization keys for user-facing messages.

### Variable Interpolation

Variables don't interpolate in flash keys automatically:

```liquid
<!-- WRONG: Variable not substituted -->
{% assign item_name = 'Widget' %}
{% include 'modules/core/helpers/redirect_to',
  url: '/items',
  notice: 'item.created_called_{{ item_name }}'
%}

<!-- RIGHT: Use i18n with parameters -->
{{ 'item.created' | t: name: item_name }}
```

## JavaScript Toast Issues

### pos.modules Object Undefined

Toast requires pos module loading:

```javascript
// May fail if module not loaded yet
new pos.modules.toast('success', 'Message');

// Safe: wrap in load handler
document.addEventListener('posModulesReady', function() {
  new pos.modules.toast('success', 'Message');
});
```

### Toast Missing in Markup

Toast visual styles require CSS classes. Ensure styles are loaded:

```liquid
<link rel="stylesheet" href="/modules/core/css/toast.css">
```

Without CSS, toast displays as plain text or invisible.

## Session Flash Cleared Unexpectedly

### Session Timeout

Flash lives in session. Session timeout clears flash:

```liquid
<!-- If session expires, flash is lost -->
{% include 'modules/core/helpers/flash/get_flash' %}
<!-- sflash is empty -->
```

Keep session timeout appropriate for expected redirect time.

### Cookie Handling

Verify cookies are enabled and not blocked:

```javascript
if (navigator.cookieEnabled) {
  // Flash will work
} else {
  // Flash won't work without cookies
}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Common Patterns](./patterns.md)
- [Advanced Techniques](./advanced.md)
