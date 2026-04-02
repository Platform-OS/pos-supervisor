# Authentication & Authorization

Authentication and authorization in platformOS use the **pos-module-user** module. NEVER use `authorization_policies/` or `context.current_user` directly. All user lookups, permission checks, and role definitions flow through module helpers.

## Key Purpose

The authentication system provides three core capabilities:

1. **User identity** -- retrieve the current logged-in user via a single module query
2. **Permission checking** -- verify whether a user can perform a specific action
3. **Access enforcement** -- block or redirect unauthorized users automatically

The module ships with three built-in roles (`anonymous`, `authenticated`, `superadmin`) and a customizable permission matrix that maps roles to fine-grained action strings.

## When to Use

- **Protecting pages** -- guard any route that requires login or a specific role
- **Conditional UI** -- show or hide buttons, links, and sections based on permissions
- **Signing users in/out** -- after credential validation or OAuth callback
- **Defining custom roles** -- when the built-in roles are not granular enough

You do NOT need this module when:
- Serving fully public content with no role-dependent elements
- Working with API keys or external auth (handle those at the API-call level)

## How It Works

1. A page calls `modules/user/queries/user/current` to get the user profile
2. The profile is passed to a `can_do` helper along with an action string (e.g., `products.edit`)
3. The helper looks up the user's role in the permissions matrix
4. If the role includes the action, access is granted; otherwise the helper returns false, raises a 403, or redirects

```
Request --> Get Profile --> Check Permission --> Grant / Deny
```

### Quick example

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.view', redirect_anonymous_to_login: true
%}
```

## Getting Started

1. Install `pos-module-user` (it ships with most platformOS starter kits)
2. At the top of every protected page, fetch the current user:

```liquid
{% function profile = 'modules/user/queries/user/current' %}
```

3. Choose an enforcement strategy:

| Helper | Behavior |
|--------|----------|
| `can_do` | Returns `true`/`false` -- use for conditional UI |
| `can_do_or_unauthorized` | Returns 403 or redirects to login |
| `can_do_or_redirect` | Redirects to a custom URL |

4. Define custom roles by overriding `permissions.liquid` (see [Configuration](configuration.md))

### Built-in roles

| Role | Description |
|------|-------------|
| `anonymous` | Unauthenticated visitors |
| `authenticated` | Any logged-in user |
| `superadmin` | Bypasses ALL permission checks |

## See Also

- [Authentication Configuration](configuration.md) -- role definitions, permission files, session setup
- [Authentication API](api.md) -- Liquid tags, helpers, and sign-in/sign-out interface
- [Authentication Patterns](patterns.md) -- common workflows for login, guards, and role-based UI
- [Authentication Gotchas](gotchas.md) -- common errors and platform limits
- [Authentication Advanced](advanced.md) -- multi-role users, custom permission logic, OAuth
- [Forms Reference](../forms/README.md) -- CSRF token handling for authenticated forms
- [Flash Messages](../flash-messages/README.md) -- feedback after login/logout actions
