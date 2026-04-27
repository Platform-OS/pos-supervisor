# modules/user - Required Setup

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). All helper
> calls below use `{% function %}` and the `do:` parameter. The legacy
> `{% include %}` and `with_action:` forms are rejected by the LSP
> (`DeprecatedTag`) and must NOT be used.

## CRITICAL: Custom Permission Actions Require an Override

If you use `can_do_or_redirect`, `can_do`, or `can_do_or_unauthorized` with
ANY custom action string (anything beyond what the module's own pages need),
you MUST override the role-permissions query at:

```
app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

**Without this override, every custom action denies every user — silently.**
There is no error: `can_do_or_redirect` simply sends the user away,
`can_do_or_unauthorized` returns 403, `can_do` returns false. This is the
single most common auth-setup mistake.

### Minimal override

The override must return a hash mapping role-name → list of action strings:

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

Every role you assign via `commands/profiles/roles/append` must appear as a
key. Every action you check via `can_do(do: '...')` must appear in at least
one role's list.

### "Any authenticated user" pattern

```liquid
{% parse_json data %}
{
  "authenticated": ["sessions.destroy", "posts.read", "comments.create"]
}
{% endparse_json %}
{% return data %}
```

Then:

```liquid
{% function _ = 'modules/user/helpers/can_do_or_redirect',
   requester: current_user,
   do: 'comments.create' %}
```

### Per-entity authorization (ownership, tenancy)

Hash-only authorization can't express "user owns this row." Use an
`access_callback` (see advanced.md) — it receives `requester`, `entity`,
and `do`, and returns a boolean. The callback wins over the hash.

---

## CRITICAL: Use `{% function %}`, NOT `{% include %}`

The modernized canonical form for every helper call is `{% function %}`:

```liquid
<!-- CORRECT - LSP-compliant -->
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function can = 'modules/user/helpers/can_do',
   requester: current_user, do: 'posts.edit' %}
{% if can %}
  <!-- ... -->
{% endif %}
```

```liquid
<!-- WRONG - LSP rejects (DeprecatedTag) -->
{% include 'modules/user/helpers/can_do' with_action: 'posts.edit' %}
```

`{% function %}` returns the helper's value into the named variable
(`can` above). `{% function _ = '...' %}` discards it when the helper is
side-effecting (redirect, 403).

---

## CRITICAL: Always Pull `current_user` via the Module Query

Helpers expect a profile-shaped `requester:` (with `id`, `roles`, etc.).
`context.current_user` is the runtime context object — different shape, not
interchangeable. ALWAYS:

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function _ = 'modules/user/helpers/can_do',
   requester: current_user, do: '...' %}
```

---

## Setup Checklist Before Using Authorization

Before adding any auth checks to your pages or partials:

- [ ] `app/modules/user/public/lib/queries/role_permissions/permissions.liquid` exists and lists
      EVERY role you assign + EVERY action you check
- [ ] All helper calls use `{% function %}` syntax (never `{% include %}`)
- [ ] All helper calls pass `requester:` from the module query, not from
      `context.current_user`
- [ ] All helper calls use the `do:` parameter (never `with_action:`)
- [ ] Pages that mutate data call the auth helper BEFORE any
      `commands/...` execution

## Module Dependencies

Per `modules/user/pos-module.json` (version 5.2.8):

- `core` ≥ 2.1.8 (required)
- `common-styling` ≥ 1.11.0 (required)
- `oauth_github` ≥ 0.0.12 (optional — only if your app uses GitHub OAuth)

Run `pos-cli modules version user` if `template-values.json` and
`pos-module.json` drift; the dashboard surfaces this via `manifest_warnings`.
