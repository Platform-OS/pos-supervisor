# modules/user - Common Patterns

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). Helpers are
> invoked via `{% function %}`, never `{% include %}` — the LSP rejects the
> latter as `DeprecatedTag`.

## Authentication Patterns

### Check if User is Logged In
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% if current_user %}
  Welcome, {{ current_user.first_name }}!
{% else %}
  <a href="/sign-in">Sign In</a>
{% endif %}
```

### Conditional Content by Role
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% if current_user.roles contains 'admin' %}
  <div class="admin-panel">
    <!-- admin features -->
  </div>
{% endif %}
```

## Authorization Patterns

Authorization helpers all take a `do:` parameter (the permission key) and a
`requester:` (the user profile). Always pull the user via the module query
first — never read `context.current_user` directly into the helper, because
the helper expects a profile shape, not the runtime context object.

### Require Authentication (redirect if not authorized)
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function _ = 'modules/user/helpers/can_do_or_redirect',
   requester: current_user,
   do: 'profile.view',
   return_url: '/sign-in' %}

<h1>{{ current_user.first_name }}'s Profile</h1>
```

### Check Permission Before Showing UI
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function can = 'modules/user/helpers/can_do',
   requester: current_user,
   do: 'posts.edit' %}

{% if can %}
  <button>Edit Post</button>
{% else %}
  <p>You cannot edit this post</p>
{% endif %}
```

### Admin-Only Pages (404 / 403 if not authorized)
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function _ = 'modules/user/helpers/can_do_or_unauthorized',
   requester: current_user,
   do: 'admin_pages.view',
   redirect_anonymous_to_login: true %}

<h1>User Management</h1>
```

`can_do_or_unauthorized` returns 403 for authenticated users without the
permission; with `redirect_anonymous_to_login: true` it sends anonymous users
to `/sessions/new` and stashes the original URL in the session.

## OAuth2 Patterns

OAuth provider integrations live in the optional `oauth_github` module
(separate dependency since user 5.x). The `user` module exposes the OAuth
record CRUD; the actual sign-in flow is owned by the provider module.

### Linked-providers query for the current user
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{% function providers = 'modules/user/helpers/get_assigned_oauth_providers',
   user_id: current_user.id %}
{% for p in providers %}
  Linked: {{ p.provider }} ({{ p.sub }})
{% endfor %}
```

### Available providers (configured but not yet linked)
```liquid
{% function available = 'modules/user/helpers/get_available_oauth_providers',
   user_id: current_user.id %}
```

## User Data Patterns

### Display User Profile
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}

<div class="profile">
  <h2>{{ current_user.first_name }} {{ current_user.last_name }}</h2>
  <p>{{ current_user.email }}</p>
  <p>Member since {{ current_user.created_at | date: '%B %Y' }}</p>
</div>
```

### Update Profile via Module Command
```liquid
{% function result = 'modules/user/commands/profiles/update',
   id: current_user.id,
   first_name: 'Ada',
   last_name: 'Lovelace' %}
{% if result.valid %}
  Saved.
{% else %}
  {{ result.errors }}
{% endif %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API surface overview
- gotchas.md - Common mistakes
- advanced.md - Advanced techniques (incl. permissions override + 2FA hooks)
- prerequisites.md - Required setup before using this module
