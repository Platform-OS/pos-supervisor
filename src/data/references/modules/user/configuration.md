# modules/user - Configuration

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Overview

`modules/user` is the authentication, authorization, and profile module. It
provides role-based access control (RBAC), OAuth record CRUD (the actual
provider flows live in optional companion modules like `oauth_github`), and
the standard user-management page set (sign in, sign up, profiles, password
reset, 2FA).

## Installation

`user` is a required module on most instances. Confirm presence:

```bash
ls modules/user/pos-module.json
```

Module dependencies (per `pos-module.json`): `core`, `common-styling`, and
optional `oauth_github`. Re-run `pos-cli modules version user` if
`template-values.json` and `pos-module.json` drift (the dashboard surfaces
this via `manifest_warnings`).

## Default Roles

The shipped `permissions.liquid` query enumerates these:

- **anonymous** — unauthenticated visitors
- **authenticated** — logged-in users (any role)
- **member** — basic user with a profile
- **admin** — admin-pages access + user management
- **superadmin** — impersonation rights including superadmin impersonation

These cover the module's own pages. Apps almost always need additional
roles + permissions, which means overriding `permissions.liquid`.

## Adding Custom Roles + Permissions

Create the override at the canonical app-relative path
`app/modules/user/public/lib/queries/role_permissions/permissions.liquid` and return a hash
mapping role-name → list of permission strings:

```liquid
{% parse_json data %}
{
  "anonymous":     ["sessions.create", "users.register"],
  "authenticated": ["sessions.destroy", "oauth.manage"],
  "member":        ["profile.manage"],
  "editor":        ["posts.create", "posts.update"],
  "admin":         ["admin_pages.view", "admin.users.manage", "users.impersonate", "posts.create", "posts.update", "posts.delete"],
  "superadmin":    ["users.impersonate_superadmin"]
}
{% endparse_json %}
{% return data %}
```

Include EVERY role you assign — a role missing from this hash gets denied
silently for every action.

## OAuth Provider Configuration

The `user` module ships only the OAuth-record schema and CRUD operations.
Provider flows are in companion modules:

- `oauth_github` — GitHub OAuth callback + linking flow.
- (other providers ship as separate modules where available)

If you need a provider not yet packaged, look at `oauth_github` for the
shape: it consumes the `user` module's `graphql/oauth/{create,delete}.graphql`
mutations to persist linked-account records.

Provider credentials are read from instance constants. Set them via
`pos-cli constants set <KEY> <VALUE>` rather than committing them to
`pos-module.json`.

## Permission Helpers (canonical call form)

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function can = 'modules/user/helpers/can_do',
   requester: current_user,
   do: 'posts.edit' %}
{% if can %}
  <!-- show edit button -->
{% endif %}
```

The legacy `{% include %}` call is deprecated — the LSP rejects it as
`DeprecatedTag`. Always use `{% function %}`.

## See Also
- api.md - API surface overview
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced configuration
- prerequisites.md - Required setup before using this module
