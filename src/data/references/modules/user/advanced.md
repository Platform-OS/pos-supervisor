# modules/user - Advanced Topics

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Custom Permission Logic via `access_callback`

For per-entity authorization beyond simple role→action mapping, pass an
`access_callback` to the helper. The callback is your own helper file; it
receives `requester`, `entity`, and `do`, and must return a boolean.

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% graphql post = 'queries/posts/find', id: context.params.id %}

{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
   requester: current_user,
   entity: post,
   do: 'posts.edit',
   access_callback: 'helpers/posts/access' %}
```

Your callback at `app/lib/helpers/posts/access.liquid`:

```liquid
{% doc %}
  @param {object} requester
  @param {object} entity
  @param {string} do
{% enddoc %}
{% liquid
  if requester.roles contains 'admin'
    return true
  endif
  if do == 'posts.edit' and entity.author_id == requester.id
    return true
  endif
  return false
%}
```

The callback **wins** over the role-permissions map: when present,
`can_do` skips the permissions hash and uses your decision. Use this for
ownership / tenancy / time-windowed access — everything else stays in the
hash override.

## Multi-Tenant Authorization

Tenant isolation belongs in your callback (above), not in the permissions
map. Permissions answer "what *kind* of action," ownership/tenancy
answers "this *specific* entity."

```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
   requester: current_user,
   entity: tenant_resource,
   do: 'tenant.read',
   access_callback: 'helpers/tenancy/owns' %}
```

Always pair it with tenant-scoped GraphQL queries (filter by `tenant_id`)
so the model layer never returns the wrong tenant's rows in the first place.

## OAuth: Multiple Providers

The user module ships only the OAuth-record CRUD. Concrete provider flows
live in companion modules (`oauth_github`, etc.). To enumerate the providers
that are linkable for the current user, call:

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function available = 'modules/user/helpers/get_available_oauth_providers',
   user_id: current_user.id %}

{% for provider in available %}
  <a href="/oauth/{{ provider.name }}/authorize">
    Sign in with {{ provider.name | capitalize }}
  </a>
{% endfor %}
```

`get_available_oauth_providers` returns the providers the instance has
configured (via constants) but the user has not yet linked.

To list the providers already linked to a user:

```liquid
{% function linked = 'modules/user/helpers/get_assigned_oauth_providers',
   user_id: current_user.id %}
```

To unlink a provider, delete the OAuth record via
`graphql/oauth/delete.graphql`.

## Session Management

The session lifecycle is owned by `commands/session/`. The user module ships:

- `commands/session/create.liquid` — sign-in flow entry point
- `commands/session/destroy.liquid` — sign-out
- `commands/authentication_links/create.liquid` — magic-link flow

Custom session timeouts belong in your layout — check
`current_user.last_active_at` (or your own `session.last_seen` constant) and
call `commands/session/destroy` when stale.

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% if current_user %}
  {% assign now      = 'now'                  | date: '%s' | plus: 0 %}
  {% assign last     = current_user.last_active_at | date: '%s' | plus: 0 %}
  {% assign elapsed  = now | minus: last %}
  {% if elapsed > 1800 %}
    {% function _ = 'modules/user/commands/session/destroy' %}
  {% endif %}
{% endif %}
```

## 2FA Hooks (user 5.x)

The 2FA partial set lives at `views/partials/2fa/` and is rendered from the
shipped pages flow. To integrate 2FA into a custom sign-in screen, render
the shipped partials rather than rebuilding:

```liquid
{% render 'modules/user/2fa/setup' %}
{% render 'modules/user/2fa/verify' %}
```

The 2FA secret is stored on the user profile. Verification is a normal
session-create flow with the OTP attached — the module's
`commands/session/create` already handles the OTP step.

## Audit Logging Authorization

The user module does not ship an audit log. If you need one, log from your
own callback:

```liquid
{% liquid
  function r = 'commands/audit_log/create',
    user_id: requester.id,
    action: do,
    entity_id: entity.id,
    granted: result
  return result
%}
```

Avoid wrapping `can_do` itself in a logger — log inside your `access_callback`
so you only record decisions you actually made.

## See Also
- configuration.md - Basic setup
- api.md - API surface overview
- patterns.md - Common patterns
- gotchas.md - Common mistakes
- prerequisites.md - Required setup before using this module
