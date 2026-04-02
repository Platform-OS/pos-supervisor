# modules/user - Common Gotchas

## Critical: Custom Permission Actions Silently Fail Without permissions.liquid

Using `can_do_or_redirect`, `can_do`, or `can_do_or_unauthorized` with a custom action string
(e.g., `do: 'blog_post.create'`) will silently deny ALL users — including authenticated ones —
if `app/views/partials/permissions.liquid` does not exist.

There is no error. The user is simply redirected or denied with no explanation.

```liquid
<!-- This silently fails for everyone if permissions.liquid doesn't exist -->
{% include 'modules/user/helpers/can_do_or_redirect' with_action: 'blog_post.create' %}
```

Fix: create `app/views/partials/permissions.liquid` that handles every action you use.
See prerequisites.md for a full setup checklist and examples.

---

## Critical: Do NOT Use Direct Context Access
Never access user context directly:

```liquid
<!-- WRONG - DO NOT DO THIS -->
{% if context.current_user %}
  <!-- This bypasses authorization checks -->
{% endif %}
```

Always use the module helpers:
```liquid
<!-- CORRECT -->
{% graphql current_user = 'modules/user/queries/user/current' %}
{% if current_user %}
  <!-- proper authorization -->
{% endif %}
```

## Critical: Do NOT Use authorization_policies/ Directly
Never reference authorization policy files directly:

```liquid
<!-- WRONG -->
{% render 'app/authorization_policies/admin_only' %}
```

Always use the helpers:
```liquid
<!-- CORRECT -->
{% render 'modules/user/helpers/can_do_or_redirect', with_action: 'admin_access' %}
```

## Critical: Role Assignment and Authorization Are a Three-Part Chain

`profiles/roles/append` and `can_do` look related but operate through separate mechanisms that must all be wired together. Missing any part causes silent failure.

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

**Step 2 — Map the role to actions in `app/views/partials/permissions.liquid`:**

```liquid
{% parse_json data %}
{
  "anonymous":     ["sessions.create", "users.register"],
  "authenticated": ["sessions.destroy"],
  "editor":        ["blog_posts.create", "blog_posts.update"],
  "admin":         ["blog_posts.create", "blog_posts.update", "blog_posts.delete", "users.manage"]
}
{% endparse_json %}
{% return data %}
```

**Step 3 — Check permission before acting:**

```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
    action: 'blog_posts.create' %}
```

**What goes wrong when any part is missing:**

| Missing | Symptom |
|---------|---------|
| `profiles/roles/append` never called | User has no roles — all `can_do` checks deny |
| `permissions.liquid` doesn't exist | Every `can_do` check denies everyone, no error |
| Role assigned but not in `permissions.liquid` | `can_do` denies — role name is unknown to the permission system |
| Action string mismatch (typo) | Silently denied — `"blog_post.create"` ≠ `"blog_posts.create"` |

**`can_do` does NOT check `current_user.roles` directly.** It calls `permissions.liquid`, gets the role→actions map, then checks if the current user's roles include a role that has the requested action. The role names in `profiles/roles/append` must exactly match the keys in `permissions.liquid`.

---

## Role-Based Logic Errors

### Checking Single Role
Don't check for single string:
```liquid
<!-- WRONG -->
{% if current_user.roles == 'admin' %}
```

Use array operations:
```liquid
<!-- CORRECT -->
{% if current_user.roles contains 'admin' %}
```

## Permission Caching Issues
Permissions are checked at request time. Don't cache permission results across requests:

```liquid
<!-- WRONG - caching permission in page data -->
{% assign can_edit = true %}
<!-- later... permission might have changed -->
```

Check permissions fresh each time:
```liquid
<!-- CORRECT -->
{% render 'modules/user/helpers/can_do', with_action: 'edit_post' %}
```

## OAuth2 Common Issues

### Missing State Parameter
Always validate OAuth state to prevent CSRF:
```liquid
<!-- platformOS handles this automatically -->
<!-- but verify in your callback -->
```

### Token Expiration
Handle expired tokens gracefully:
```liquid
{% if user.oauth_token_expired %}
  <!-- redirect to refresh flow -->
{% endif %}
```

## Password Reset Gotchas
Don't expose user existence through password resets:

```liquid
<!-- WRONG - tells attackers if email exists -->
{% if user_exists %}
  Password reset email sent
{% else %}
  Email not found
{% endif %}

<!-- CORRECT - always same message -->
If that email exists, you'll receive a reset link.
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Correct patterns
- advanced.md - Advanced techniques
