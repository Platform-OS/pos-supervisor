# Authentication -- Advanced Topics

Edge cases, complex scenarios, and advanced patterns for the pos-module-user authentication system.

## Custom Permission Logic

The default permission system uses a flat role-to-actions mapping. For more complex rules (e.g., ownership checks, time-based access), wrap the helpers in a custom partial.

### Ownership-based access

```liquid
{% comment %} app/lib/helpers/can_edit_own.liquid {% endcomment %}
{% liquid
  function can = 'modules/user/helpers/can_do', requester: requester, do: do
  if can
    return true
  endif

  if requester == blank
    return false
  endif

  if object.user_id == requester.id
    return true
  endif

  return false
%}
```

Usage:

```liquid
{% function can_edit = 'helpers/can_edit_own',
  requester: profile,
  do: 'products.update',
  object: product
%}
```

### Time-based access

```liquid
{% comment %} app/lib/helpers/can_do_during_hours.liquid {% endcomment %}
{% liquid
  function can = 'modules/user/helpers/can_do', requester: requester, do: do
  unless can
    return false
  endunless

  assign hour = 'now' | date: '%H' | plus: 0
  if hour >= start_hour and hour < end_hour
    return true
  endif
  return false
%}
```

## Multi-Role Users

The default module stores a single role string per user. To support multiple roles, store them as a JSON array in a custom property and write a wrapper.

### Schema for multi-role

```yaml
# app/schema/user_profile.yml
properties:
  - name: roles
    type: array
    items:
      type: string
```

### Multi-role permission check

```liquid
{% comment %} app/lib/helpers/can_do_multi_role.liquid {% endcomment %}
{% liquid
  if requester == blank
    return false
  endif

  assign roles = requester.properties.roles
  if roles == blank
    return false
  endif

  function permissions = 'modules/user/queries/role_permissions/permissions'

  for role in roles
    if role == 'superadmin'
      return true
    endif
    assign role_actions = permissions[role]
    if role_actions contains do
      return true
    endif
  endfor

  return false
%}
```

## OAuth / External Authentication

When using an external identity provider (Google, GitHub, etc.), the flow is:

1. Redirect user to the provider's authorization URL
2. Provider redirects back with a code
3. Exchange the code for tokens via an API call
4. Find or create a local user record
5. Sign the user in with `{% sign_in %}`

### Callback handler

```liquid
---
slug: auth/callback
---
{% liquid
  function result = 'commands/auth/exchange_code', code: context.params.code

  if result.error
    include 'modules/core/helpers/redirect_to', url: '/login', alert: 'app.auth.oauth_failed'
    break
  endif

  graphql existing = 'users/find_by_provider', provider: 'google', provider_id: result.provider_id

  if existing.records.results.first
    assign user = existing.records.results.first
  else
    graphql user = 'users/create_from_oauth', email: result.email, provider: 'google', provider_id: result.provider_id
  endif

  sign_in user_id: user.id, timeout_in_minutes: 1440
  include 'modules/core/helpers/redirect_to', url: '/', notice: 'app.auth.welcome'
%}
```

## API Token Authentication

For headless or mobile clients that cannot use cookie sessions, implement token-based auth.

### Token verification partial

```liquid
{% comment %} app/lib/helpers/verify_api_token.liquid {% endcomment %}
{% liquid
  assign token = context.headers.HTTP_AUTHORIZATION | remove: 'Bearer '
  if token == blank
    return null
  endif

  graphql result = 'tokens/verify', token: token
  assign user = result.records.results.first
  return user
%}
```

### Protected API endpoint

```liquid
---
slug: api/v1/orders
layout: ""
---
{% liquid
  function profile = 'helpers/verify_api_token'
  if profile == blank
    assign error = { "error": "unauthorized" }
    render 'api/error', status: 401, body: error
    break
  endif

  graphql orders = 'orders/list', user_id: profile.id
  render 'api/orders/list', orders: orders
%}
```

## Remember Me / Extended Sessions

Implement "remember me" by varying the session timeout:

```liquid
{% liquid
  if context.params.remember_me == 'true'
    sign_in user_id: user.id, timeout_in_minutes: 43200
  else
    sign_in user_id: user.id, timeout_in_minutes: 60
  endif
%}
```

43200 minutes equals 30 days.

## Impersonation (Admin acting as another user)

Allow superadmins to sign in as another user for debugging:

```liquid
---
slug: admin/impersonate
method: post
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.impersonate'

  assign target_id = context.params.user_id
  sign_in user_id: target_id, timeout_in_minutes: 30
  include 'modules/core/helpers/redirect_to', url: '/', notice: 'app.admin.impersonating'
%}
```

**Warning:** Always restrict impersonation to `superadmin` or a dedicated admin action. Log every impersonation event.

## Rate Limiting Login Attempts

platformOS does not have built-in rate limiting for login. Implement it using a record counter.

```liquid
{% comment %} In login handler, before authenticating {% endcomment %}
{% liquid
  graphql attempts = 'auth/get_attempts', email: context.params.email
  assign count = attempts.records.results.first.properties.count | default: 0 | plus: 0

  if count >= 5
    include 'modules/core/helpers/flash/publish', alert: 'app.auth.too_many_attempts'
    render 'sessions/form'
    break
  endif

  graphql user = 'users/authenticate', email: context.params.email, password: context.params.password

  if user.user == blank
    graphql _ = 'auth/increment_attempts', email: context.params.email
    include 'modules/core/helpers/flash/publish', alert: 'app.sessions.invalid_credentials'
    render 'sessions/form'
    break
  endif

  graphql _ = 'auth/clear_attempts', email: context.params.email
  sign_in user_id: user.user.id
  redirect_to '/'
%}
```

## Password Reset Flow

1. User submits email on a "forgot password" page
2. Generate a one-time token, store it on the user record
3. Send a reset email (via events/consumers) with a link containing the token
4. User clicks the link, lands on a reset page that validates the token
5. User submits a new password; update the record and sign them in

This pattern involves forms, emails, and auth working together. See [Emails-SMS Patterns](../emails-sms/patterns.md) for the email-sending portion.

## See Also

- [Authentication Overview](README.md) -- introduction and key concepts
- [Authentication Configuration](configuration.md) -- role definitions and session setup
- [Authentication API](api.md) -- tags, helpers, and mutations
- [Authentication Patterns](patterns.md) -- standard login and guard workflows
- [Authentication Gotchas](gotchas.md) -- common errors and limits
- [Emails-SMS Reference](../emails-sms/README.md) -- sending password reset emails
- [Events-Consumers Reference](../events-consumers/README.md) -- async processing
