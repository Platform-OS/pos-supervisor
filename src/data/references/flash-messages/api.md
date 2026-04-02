# Flash Messages API Reference

## Overview

platformOS provides flash message helpers through `pos-module-core` for setting and rendering temporary notifications.

## Core Helpers

### Redirect with Flash Message

Set flash message and redirect in a single action:

```liquid
{% include 'modules/core/helpers/redirect_to',
  url: '/dashboard',
  notice: 'user.profile_updated'
%}
```

The `notice` parameter accepts:

- Localization key: `'user.profile_updated'` -> resolves via i18n
- Dynamic text: `'Welcome ' | append: user.name`

### Flash Message Parameters

The `redirect_to` helper accepts these flash parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `notice` | String | Success/info message (notice type) |
| `alert` | String | Error message (alert type) |
| `warning` | String | Warning message (warning type) |
| `info` | String | Informational message (info type) |
| `url` | String | Redirect destination (required) |

### Set Flash Message Only

Set flash without immediate redirect:

```liquid
{% include 'modules/core/helpers/flash/publish',
  notice: 'changes_saved'
%}
```

Available flash types: `notice`, `alert`, `warning`, `info`

## Getting Flash Messages

### Retrieve Flash from Session

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash %}
  Notice: {{ sflash.notice }}
  Alert: {{ sflash.alert }}
{% endif %}
```

The helper populates `sflash` variable with current flash data.

### Check Flash Existence

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash.notice %}
  {% assign notice_text = sflash.notice | t %}
{% endif %}

{% if sflash.alert %}
  {% assign error_text = sflash.alert | t %}
{% endif %}
```

## Clearing Flash Messages

### Automatic Clearing

Flash messages automatically clear when:
- Page pathname changes
- Session expires
- Explicit clear is called

### Manual Clear

Clear flash messages programmatically:

```liquid
{% include 'modules/core/helpers/flash/clear' %}
```

## JavaScript Toast Implementation

Create toast notifications from JavaScript:

```javascript
new pos.modules.toast('success', 'Profile updated successfully');
new pos.modules.toast('error', 'An error occurred');
new pos.modules.toast('warning', 'Please review your changes');
new pos.modules.toast('info', 'Remember to save your work');
```

### Toast Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| Type | String | 'success', 'error', 'warning', 'info' |
| Message | String | Toast message text |
| Duration | Number | Optional: milliseconds to show (default: 3000) |

## Toast Duration Control

```javascript
new pos.modules.toast('success', 'Message', 5000); // 5 seconds
new pos.modules.toast('info', 'Persistent message', 0); // Never auto-dismiss
```

## Flash Message Structure

Flash messages follow this structure in session:

```json
{
  "notice": "i18n.key.or.text",
  "alert": null,
  "warning": null,
  "info": null,
  "pathname": "/current/path"
}
```

## Combining Multiple Flash Types

Set multiple flash messages in redirect:

```liquid
{% include 'modules/core/helpers/redirect_to',
  url: '/form',
  notice: 'partial_save',
  warning: 'some_fields_required'
%}
```

Only one message per type is supported simultaneously.

## Liquid Filters with Flash

Apply Liquid filters to flash messages:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash.notice %}
  <div class="flash">
    {{ sflash.notice | t | upcase }}
  </div>
{% endif %}
```

## Response Headers

When using `redirect_to`, HTTP headers are set:

```
Location: /dashboard
Set-Cookie: sflash={"notice":"i18n.key"}; ...
```

The cookie automatically manages flash lifecycle.

## See Also

- [Configuration Guide](./configuration.md)
- [Common Patterns](./patterns.md)
- [Known Gotchas](./gotchas.md)
- [Advanced Techniques](./advanced.md)
