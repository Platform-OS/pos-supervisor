# Sessions

Server-side session storage accessible via `context.session`.

## Setting Session Data

```liquid
{% session cart_id = order.id %}
{% session user_preference = 'dark_mode' %}
{% session step = 2 %}
```

## Reading Session Data

```liquid
{{ context.session.cart_id }}
{{ context.session.user_preference }}
```

## Clearing Session Data

```liquid
{% session cart_id = null %}
{% session cart_id = blank %}
```

## Using Core Module Session Helpers

```liquid
{% comment %} Get structured session data {% endcomment %}
{% function data = 'modules/core/commands/session/get', key: 'sflash' %}

{% comment %} Clear structured session data {% endcomment %}
{% function _ = 'modules/core/commands/session/clear', key: 'sflash' %}
```

## Use Cases

- Shopping cart persistence
- Multi-step form wizards
- User preferences
- Flash messages (via core module)
- Temporary authentication tokens

## Rules

- Session data persists across requests for the same user
- Use `null` or `blank` to clear a session key
- Don't store large objects in session
- Session is server-side (not accessible from client JS)
