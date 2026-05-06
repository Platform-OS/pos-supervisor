# pos-module-user

The user module provides authentication, role-based access control (RBAC),
profile management, and OAuth record CRUD. Provider-specific OAuth flows
(GitHub, etc.) live in optional companion modules like `oauth_github`.

**Required module** — must be installed in every project.
Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Install

```bash
pos-cli modules install user
```

## Documentation

- Live API surface: `module_info(name: 'user', section: 'api')` — scanned
  from disk, always current.
- Upstream: https://github.com/Platform-OS/pos-module-user

## Key Calls

All helpers use `{% function %}` and the `do:` parameter. The legacy
`{% include %}` and `with_action:` forms are rejected by the LSP.

### Get Current User
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
```

**NEVER use `context.current_user` directly** — helpers expect the
profile-shaped object this query returns.

### Check Permission (returns boolean)
```liquid
{% function can = 'modules/user/helpers/can_do',
   requester: current_user,
   do: 'products.create' %}
```

### Enforce Permission (403 if denied; redirect anonymous to login)
```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
   requester: current_user,
   do: 'admin_pages.view',
   redirect_anonymous_to_login: true %}
```

### Redirect If Denied
```liquid
{% function _ = 'modules/user/helpers/can_do_or_redirect',
   requester: current_user,
   do: 'orders.view',
   return_url: '/sign-in' %}
```

## Built-in Roles (shipped permissions hash)

| Role | Description |
|------|-------------|
| `anonymous` | Unauthenticated visitors |
| `authenticated` | Any logged-in user |
| `member` | Authenticated user with profile |
| `admin` | Admin-pages + user management |
| `superadmin` | Impersonation incl. other superadmins |

## Custom Roles & Permissions

Override the role-permissions query at the canonical module-override path:

```
app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

```liquid
{% parse_json data %}
{
  "anonymous":     ["sessions.create", "users.register"],
  "authenticated": ["sessions.destroy", "oauth.manage"],
  "editor":        ["posts.create", "posts.update"],
  "admin":         ["admin_pages.view", "users.manage", "posts.create", "posts.update", "posts.delete"],
  "superadmin":    []
}
{% endparse_json %}
{% return data %}
```

`superadmin` MAY have an empty list — the helper short-circuits to allow
for that role unconditionally.

## Rules

- ALWAYS pull `current_user` via `modules/user/queries/user/current`.
- ALWAYS use `{% function %}` for helpers (never `{% include %}`).
- ALWAYS use `do:` (never `with_action:`).
- NEVER render `app/authorization_policies/` partials directly — go through
  a `can_do*` helper.
- For per-entity rules (ownership/tenancy), pass `access_callback:` —
  see advanced.md.
