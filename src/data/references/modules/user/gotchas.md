# modules/user - Common Gotchas

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). Helpers use
> `{% function %}` and the `do:` parameter; the LSP rejects legacy
> `{% include %}` calls and `with_action:` aliases.

## Critical: Custom Permission Actions Silently Fail Without an Override

Calling `can_do_or_redirect`, `can_do`, or `can_do_or_unauthorized` with an
action string that isn't in the role-permissions map (e.g. `do: 'posts.edit'`)
silently denies every user — including authenticated ones. There is no
exception; the user is simply redirected or 403'd.

The module ships a default `permissions.liquid` query at
`modules/user/public/lib/queries/role_permissions/permissions.liquid` listing
the roles the module's own pages need (`anonymous`, `authenticated`, `admin`,
`member`, `superadmin`). To add custom permissions for your app, override that
query by creating it at the canonical app-relative path:

```
app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

The override must return a hash mapping role-name → list of permission
strings. See prerequisites.md for a full checklist.

```liquid
<!-- This silently fails for everyone if the override is missing -->
{% function _ = 'modules/user/helpers/can_do_or_redirect',
   requester: current_user,
   do: 'posts.edit' %}
```

---

## Critical: Always Pull `current_user` via the Module Query

Never pass `context.current_user` directly to a helper:

```liquid
<!-- WRONG - context.current_user is the runtime user object,
     not the profile shape these helpers expect -->
{% function _ = 'modules/user/helpers/can_do',
   requester: context.current_user, do: 'posts.edit' %}
```

Always go through the module query first — it returns the profile-shaped
object with `roles`, `id`, etc. populated correctly:

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function _ = 'modules/user/helpers/can_do',
   requester: current_user, do: 'posts.edit' %}
```

## Critical: Do NOT Render `app/authorization_policies/` Directly

Never `{% render %}` a policy partial from your view:

```liquid
<!-- WRONG -->
{% render 'app/authorization_policies/admin_only' %}
```

Always go through a `can_do*` helper. Policies are wired into the helpers
via the role-permissions map.

```liquid
<!-- CORRECT -->
{% function _ = 'modules/user/helpers/can_do_or_redirect',
   requester: current_user, do: 'admin.access' %}
```

## Critical: `{% include %}` Is Deprecated for Helpers — LSP Rejects It

The modern canonical form is `{% function %}`. The LSP `DeprecatedTag` check
flags any `{% include 'modules/user/helpers/...' %}` call. Always:

```liquid
{% function _ = 'modules/user/helpers/can_do',
   requester: current_user, do: 'posts.edit' %}
```

## Critical: Role Assignment and Authorization Are a Three-Part Chain

`profiles/roles/append` and `can_do` operate through separate mechanisms
that must all be wired together. Missing any part causes silent failure.

**The full chain:**

```
profiles/roles/append (id, role)
  → writes role name to user's profile (e.g. "editor")
      → current_user.roles now contains "editor"
          → can_do checks permissions.liquid: does "editor" map to this action?
              → YES → allowed / NO or key missing → denied (silently)
```

**Step 1 — Assign the role to a profile:**

```liquid
{% function result = 'modules/user/commands/profiles/roles/append',
    id: current_user.id,
    role: 'editor' %}
```

**Step 2 — Map the role to actions in your override
`app/modules/user/public/lib/queries/role_permissions/permissions.liquid`:**

```liquid
{% parse_json data %}
{
  "anonymous":     ["sessions.create", "users.register"],
  "authenticated": ["sessions.destroy"],
  "editor":        ["posts.create", "posts.update"],
  "admin":         ["posts.create", "posts.update", "posts.delete", "users.manage"]
}
{% endparse_json %}
{% return data %}
```

**Step 3 — Check permission before acting:**

```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
    requester: current_user,
    do: 'posts.create' %}
```

**What goes wrong when any part is missing:**

| Missing | Symptom |
|---------|---------|
| `profiles/roles/append` never called | User has no roles — all `can_do` checks deny |
| `permissions.liquid` override missing | Custom action denies everyone, no error |
| Role assigned but not in the override | `can_do` denies — role unknown to the map |
| Action-string typo | Silently denied — `"post.create"` ≠ `"posts.create"` |

`can_do` does NOT check `current_user.roles` directly. It calls
`permissions.liquid`, gets the role→actions map, then checks whether the
current user's roles include any role that contains the requested action.

---

## Role-Based Logic Errors

### Don't compare `roles` to a single string
`current_user.roles` is always an array, even for a single role.

```liquid
<!-- WRONG -->
{% if current_user.roles == 'admin' %}

<!-- CORRECT -->
{% if current_user.roles contains 'admin' %}
```

## Permission Caching

Permissions are evaluated per-request. Do not memoize a `can` result across
unrelated parts of the page if the role/permissions change mid-request
(e.g. after `roles/append`):

```liquid
<!-- Re-check after role mutation, not before -->
{% function result = 'modules/user/commands/profiles/roles/append',
   id: current_user.id, role: 'editor' %}
{% function can = 'modules/user/helpers/can_do',
   requester: current_user, do: 'posts.create' %}
```

## OAuth2 Common Issues

OAuth provider integrations live in the optional `oauth_github` module
(separate dependency since user 5.x). The `user` module exposes the OAuth
record CRUD (`graphql/oauth/{create,delete,find_by_sub,find_by_user_id}.graphql`)
and the helper that lists assigned providers
(`helpers/get_assigned_oauth_providers`).

If `oauth_github` is not installed, the OAuth pages under
`views/pages/oauth/` are inert — the callback simply has no provider to talk
to. Don't pretend the user module ships the GitHub flow on its own.

## Password Reset Gotchas

Don't expose user existence through reset responses:

```liquid
<!-- WRONG - tells attackers if email exists -->
{% if user_exists %}
  Password reset email sent
{% else %}
  Email not found
{% endif %}

<!-- CORRECT - always the same message -->
If that email exists, you'll receive a reset link.
```

## 2FA Partials (new in user 5.x)

`views/partials/2fa/` ships set-up, verify, and disable partials. They are
rendered from the user pages flow — your app rarely needs to render them
directly. If you ARE customizing the 2FA flow, render the shipped partials
rather than building from scratch:

```liquid
{% render 'modules/user/2fa/setup' %}
```

The 2FA storage is in the user profile; verifying it goes through
`commands/session/...` rather than a separate 2FA-only command.

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Correct patterns
- advanced.md - Advanced techniques
- prerequisites.md - Required setup before using this module
