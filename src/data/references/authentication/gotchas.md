# Authentication -- Gotchas & Limits

Common errors and platform constraints when working with authentication and authorization.

## Common Errors

### "context.current_user is null after form submission"

**Cause:** The CSRF token (`authenticity_token`) is missing from the form. On non-GET requests, platformOS nullifies `context.current_user` when the token is absent or invalid.

**Solution:** Add the hidden CSRF field to every non-GET form:

```html
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

### "User appears anonymous despite being logged in"

**Cause:** Using `context.current_user` directly instead of the module query. The raw context object has different behavior and may not reflect the full user profile.

**Solution:** Always fetch the user through the module:

```liquid
{% function profile = 'modules/user/queries/user/current' %}
```

### "Permission check always returns false"

**Cause:** The action string in the page does not match any entry in `permissions.liquid`. Action strings are exact matches -- no wildcards.

**Solution:** Verify the action string in your `permissions.liquid` file matches exactly what you pass to `can_do`:

```liquid
{% comment %} In permissions.liquid: "editor": ["article.create"] {% endcomment %}
{% comment %} In page -- must match exactly: {% endcomment %}
{% function can = 'modules/user/helpers/can_do', requester: profile, do: 'article.create' %}
```

### "403 error on admin pages after deploying updated permissions"

**Cause:** The override file at `app/modules/user/public/lib/queries/role_permissions/permissions.liquid` has a syntax error (invalid hash/array literal in `assign`) or is missing the updated role.

**Solution:** Validate the hash literal inside `assign` carefully. Test by logging the output:

```liquid
{% log data, type: 'debug' %}
```

### "sign_in tag has no effect"

**Cause:** The `user_id` parameter is `nil` or references a non-existent user. This typically happens when the authentication query returned no results but the code did not check for that.

**Solution:** Always verify the user exists before signing in:

```liquid
{% if user.user == blank %}
  {% comment %} Handle invalid credentials {% endcomment %}
  {% break %}
{% endif %}
{% sign_in user_id: user.user.id %}
```

### "Session expires unexpectedly"

**Cause:** `timeout_in_minutes` was set too low, or omitted on a subsequent `sign_in` call which reset the timeout to the platform default.

**Solution:** Set `timeout_in_minutes` explicitly on every `sign_in` call:

```liquid
{% sign_in user_id: user.id, timeout_in_minutes: 1440 %}
```

### "authorization_policies/ files are ignored"

**Cause:** platformOS supports `authorization_policies/` as a legacy feature, but the pos-module-user system does not use them. Mixing both systems causes unpredictable behavior.

**Solution:** Remove all files from `app/authorization_policies/` and use `modules/user/helpers/can_do` exclusively.

## Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Max custom roles | No hard limit | Defined in permissions.liquid JSON |
| Max actions per role | No hard limit | Keep lists manageable for maintenance |
| Session timeout range | 1 -- 525600 min | 525600 = 1 year |
| CSRF token lifetime | Tied to session | Expires when session expires |
| `superadmin` override | Always bypasses | Cannot be restricted per-action |
| Password min length | Platform default | Configurable via user module settings |
| Concurrent sessions | Unlimited | Each device/browser gets its own session |

## See Also

- [Authentication Overview](README.md) -- introduction and key concepts
- [Authentication Configuration](configuration.md) -- role and permission setup
- [Authentication API](api.md) -- tags and helpers reference
- [Authentication Patterns](patterns.md) -- correct usage patterns
- [Authentication Advanced](advanced.md) -- edge cases and complex scenarios
- [Forms Gotchas](../forms/gotchas.md) -- CSRF-related form issues
