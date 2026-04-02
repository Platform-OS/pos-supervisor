# Sessions Configuration

## Overview

Sessions in platformOS store temporary user data across requests using the `{% session %}` tag. Sessions are stored server-side and linked to user cookies, providing secure state management for shopping carts, multi-step wizards, flash messages, and user preferences. Sessions persist for the duration of a user's browser session.

## Session Storage

### Server-Side Storage

Sessions are stored on platformOS servers with user-specific access control:

```liquid
{% session cart_id = page.context.cart.id %}
{% session wizard_step = 2 %}
{% session preferences_color = 'dark' %}
```

Only the authenticated user can access their session data. Each user has isolated session storage.

## Session Lifecycle

### Session Duration

- Default: Until browser closes or 30 days of inactivity
- Configurable per deployment through platform settings
- Cleared on logout
- Persists across page navigation

### Session Initialization

Sessions are automatically initialized when first used:

```liquid
<!-- First use creates the session -->
{% session user_preferences = context.params.preferences %}

<!-- Subsequent uses read existing session -->
{{ context.session.user_preferences }}
```

## Configuration in Platform Settings

### Session Configuration

Configure in admin or `.pos` file:

```yaml
sessions:
  enabled: true
  timeout_minutes: 30
  secure_cookies: true
  same_site: 'Lax'
```

## Session Data Types

Sessions support:

- Strings: `{% session key = 'value' %}`
- Numbers: `{% session count = 5 %}`
- Booleans: `{% session flag = true %}`
- Arrays: `{% session tags = 'a,b,c' | split: ',' %}`
- Objects: `{% session user = page.user | json %}`

## Session Scope

### Global Session Access

Session variables are available throughout:

- All pages
- All layouts
- All partials
- All components

```liquid
<!-- Set in page -->
{% session active_tab = context.params.tab %}

<!-- Access in layout -->
<div class="active-{{ context.session.active_tab }}">
  {% include 'content' %}
</div>
```

## Session Security

### Automatic HTTPS

Sessions require HTTPS in production. HTTP sessions are disabled for security.

### Secure Flags

All session cookies include:

- `Secure`: Only transmitted over HTTPS
- `HttpOnly`: Not accessible from JavaScript
- `SameSite`: CSRF protection

## Sensitive Data Handling

Never store in sessions:

- Passwords or API keys
- Full credit card numbers
- Social security numbers
- Private authentication tokens

Use appropriate security measures for sensitive data.

## See Also

- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
