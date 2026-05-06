# modules/user - API Reference

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). The
> live API surface (call paths, required/optional params, return types)
> is the source of truth — call `module_info(name: 'user', section: 'api')`,
> which is scanned from disk and always current. This file provides
> narrative notes + GraphQL context that the scan cannot infer.

## GraphQL Schema Highlights

### Current User

Fetch the authenticated user's profile server-side:

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{{ current_user.email }}
```

Underlying operation (from `graphql/user/current.graphql`):

```graphql
query CurrentUser {
  current_user {
    id
    email
    first_name
    last_name
    roles { id name }
  }
}
```

### Find User by ID / email

The user-find query lives at `graphql/user/find.graphql` and accepts both
`$id` and `$email` filters:

```liquid
{% graphql found = 'modules/user/queries/user/find', id: id %}
```

The scan exposes the full param list and return shape under
`module_info → queries → 'queries/user/find'`.

## OAuth (record CRUD only)

The `user` module ships only the OAuth-record schema and CRUD ops:

- `graphql/oauth/create.graphql` — link a provider account to a user
- `graphql/oauth/delete.graphql` — unlink
- `graphql/oauth/find_by_sub.graphql` — find a record by provider + sub
- `graphql/oauth/find_by_user_id.graphql` — list a user's linked providers

The actual provider sign-in flows (GitHub, etc.) live in companion modules
(`oauth_github`, ...). If `oauth_github` is not installed, the
`views/pages/oauth/` callback pages are inert.

## Authorization Helpers — canonical `{% function %}` form

All `can_do*` helpers expect a profile-shaped `requester` (from the
`current_user` query) and a `do:` action string. The legacy
`{% include %}` and `with_action:` forms are rejected by the LSP.

### Permission check (returns boolean)

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function allowed = 'modules/user/helpers/can_do',
   requester: current_user,
   do: 'posts.delete' %}
{% if allowed %}...{% endif %}
```

### Redirect unauthorized users

```liquid
{% function _ = 'modules/user/helpers/can_do_or_redirect',
   requester: current_user,
   do: 'admin_pages.view',
   return_url: '/sign-in' %}
```

### 403 / redirect-anonymous

```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
   requester: current_user,
   do: 'admin.users.manage',
   redirect_anonymous_to_login: true %}
```

### Per-entity authorization via `access_callback`

For per-entity rules (ownership, tenancy), pass an `access_callback`:

```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
   requester: current_user,
   entity: post,
   do: 'posts.edit',
   access_callback: 'helpers/posts/access' %}
```

The callback is invoked with `requester`, `entity`, `do` and returns a
boolean. When present, it WINS over the role-permissions hash (see
advanced.md).

## OAuth Provider Helpers

```liquid
{% function linked    = 'modules/user/helpers/get_assigned_oauth_providers',
   user_id: current_user.id %}
{% function available = 'modules/user/helpers/get_available_oauth_providers',
   user_id: current_user.id %}
```

`available` returns providers the instance has configured (via constants)
that the user has not yet linked. `linked` returns existing OAuth records
for the user.

## See Also

- `configuration.md` — setup and configuration
- `patterns.md` — common usage patterns
- `gotchas.md` — common mistakes
- `advanced.md` — advanced techniques (callbacks, 2FA, sessions)
- `prerequisites.md` — required setup before using this module
