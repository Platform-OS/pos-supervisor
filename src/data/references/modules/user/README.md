# pos-module-user

The user module provides authentication, role-based access control (RBAC), and OAuth2 integration.

**Required module** — must be installed in every project.

## Install

```bash
pos-cli modules install user
```

## Documentation

Full docs: https://github.com/Platform-OS/pos-module-user

## Key Functions

### Get Current User

```liquid
{% function profile = 'modules/user/queries/user/current' %}
```

**NEVER use `context.current_user` directly.**

### Check Permission (returns boolean)

```liquid
{% function can = 'modules/user/helpers/can_do',
  requester: profile,
  do: 'products.create'
%}
```

### Enforce Permission (403 if denied)

```liquid
{% include 'modules/user/helpers/can_do_or_unauthorized',
  requester: profile,
  do: 'admin.view',
  redirect_anonymous_to_login: true
%}
```

### Redirect If Denied

```liquid
{% include 'modules/user/helpers/can_do_or_redirect',
  requester: profile,
  do: 'orders.view',
  return_url: '/login'
%}
```

## Built-in Roles

| Role | Description |
|------|-------------|
| `anonymous` | Unauthenticated visitors |
| `authenticated` | Any logged-in user |
| `superadmin` | Bypasses ALL permission checks |

## Custom Roles & Permissions

Override the permissions file:

```bash
mkdir -p app/modules/user/public/lib/queries/role_permissions
cp modules/user/public/lib/queries/role_permissions/permissions.liquid \
   app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

Define roles:

```liquid
{% assign data = {
  "admin": ["admin.view", "users.manage", "products.create", "products.update", "products.delete"],
  "editor": ["article.create", "article.update"],
  "viewer": ["article.view", "products.view"],
  "superadmin": []
} %}
{% return data %}
```

## Rules

- NEVER use `context.current_user` directly
- NEVER use `authorization_policies/` directory
- Always get user via module query
- Always check permissions via module helpers
