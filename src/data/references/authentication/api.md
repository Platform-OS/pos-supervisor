# Authentication -- API Reference

This document covers the Liquid tags, module helpers, and context objects used for authentication and authorization in platformOS.

## Liquid Tags

### sign_in

Authenticates a user and creates a session.

```liquid
{% sign_in user_id: user.id %}
{% sign_in user_id: user.id, timeout_in_minutes: 60 %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | ID | Yes | The ID of the user record to sign in |
| `timeout_in_minutes` | Integer | No | Session timeout; omit for platform default |

**Behavior:** Sets a session cookie. After this tag, `context.current_user` is populated for subsequent requests.

### sign_out

Destroys the current session.

```liquid
{% sign_out %}
```

No parameters. The session is invalidated immediately. Typically followed by a redirect.

## Module Helpers

All helpers live in the `pos-module-user` module. Call them with `{% function %}` or `{% include %}`.

### Get current user

```liquid
{% function profile = 'modules/user/queries/user/current' %}
```

Returns the full user profile hash, or `nil` if not authenticated. **Always use this instead of `context.current_user`.**

| Field | Description |
|-------|-------------|
| `profile.id` | User record ID |
| `profile.email` | User email |
| `profile.role` | Assigned role name string |
| `profile.properties` | Custom user properties hash |

### can_do (check permission)

Returns `true` or `false`. Does NOT block execution.

```liquid
{% function can = 'modules/user/helpers/can_do',
  requester: profile,
  do: 'products.create'
%}

{% if can %}
  <a href="/products/new">Create Product</a>
{% endif %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requester` | Hash | Yes | User profile from `queries/user/current` |
| `do` | String | Yes | Action string to check (e.g., `products.create`) |

### can_do_or_unauthorized (enforce with 403)

Halts page execution if the user lacks permission. Returns a 403 status or redirects anonymous users to the login page.

```liquid
{% include 'modules/user/helpers/can_do_or_unauthorized',
  requester: profile,
  do: 'admin.view',
  redirect_anonymous_to_login: true
%}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `requester` | Hash | Yes | -- | User profile |
| `do` | String | Yes | -- | Action string to enforce |
| `redirect_anonymous_to_login` | Boolean | No | `false` | Redirect anonymous users to `/sign-in` instead of 403 |

### can_do_or_redirect (enforce with redirect)

Redirects the user to a specified URL if permission is denied.

```liquid
{% include 'modules/user/helpers/can_do_or_redirect',
  requester: profile,
  do: 'orders.view',
  return_url: '/login'
%}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requester` | Hash | Yes | User profile |
| `do` | String | Yes | Action string to enforce |
| `return_url` | String | Yes | URL to redirect to when denied |

## Context Objects

### context.current_user

Available after authentication. Contains basic user fields.

```liquid
{{ context.current_user.id }}
{{ context.current_user.email }}
```

**WARNING:** Do NOT use `context.current_user` for permission checks. Always use the module query and helpers. `context.current_user` is `null` when the CSRF token is missing on non-GET requests.

### context.authenticity_token

The CSRF token for the current session. Include in every non-GET form.

```liquid
{{ context.authenticity_token }}
```

### context.session

Raw session data. Prefer module helpers over direct session access.

```liquid
{{ context.session }}
```

## GraphQL Mutations

### User creation (registration)

```graphql
mutation create_user($email: String!, $password: String!) {
  user_create(user: {
    email: $email,
    password: $password
  }) {
    id
    email
  }
}
```

### Password authentication

```graphql
query authenticate($email: String!, $password: String!) {
  user(
    filter: {
      email: { value: $email }
      password: { value: $password }
    }
  ) {
    id
    email
  }
}
```

Returns the user record if credentials match; `null` otherwise.

### User update (role assignment)

```graphql
mutation update_role($id: ID!, $role: String!) {
  user_update(id: $id, user: {
    properties: [{ name: "role", value: $role }]
  }) {
    id
  }
}
```

## See Also

- [Authentication Overview](README.md) -- introduction and key concepts
- [Authentication Configuration](configuration.md) -- role definitions and session setup
- [Authentication Patterns](patterns.md) -- real-world login and guard patterns
- [Liquid Tags Reference](../liquid/tags/README.md) -- complete tag reference
- [GraphQL Reference](../graphql/README.md) -- query and mutation details
