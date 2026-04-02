# Flash Messages & Toasts

Flash messages provide user feedback after actions (success, error notifications).

## Layout Setup

Add before `</body>` in your layout:

```liquid
{% liquid
  function flash = 'modules/core/commands/session/get', key: 'sflash'
  if context.location.pathname != flash.from or flash.force_clear
    function _ = 'modules/core/commands/session/clear', key: 'sflash'
  endif
  render 'modules/common-styling/toasts', params: flash
%}
```

## Server-Side Flash Messages

### Set flash and redirect
```liquid
{% include 'modules/core/helpers/redirect_to', url: '/products', notice: 'app.products.created' %}
{% include 'modules/core/helpers/redirect_to', url: '/products', alert: 'app.products.error' %}
```

### Set flash without redirect
```liquid
{% include 'modules/core/helpers/flash/publish', notice: 'app.order.confirmed' %}
{% include 'modules/core/helpers/flash/publish', alert: 'app.order.failed' %}
```

## Client-Side Toasts (JavaScript)

```javascript
new pos.modules.toast('success', 'Saved successfully!');
new pos.modules.toast('error', 'Something went wrong');
new pos.modules.toast('warning', 'Please check your input');
new pos.modules.toast('info', 'Processing your request...');
```

## Flash Message Types

| Type | Usage |
|------|-------|
| `notice` | Success messages |
| `alert` | Error messages |
| `warning` | Warning messages |
| `info` | Informational messages |
