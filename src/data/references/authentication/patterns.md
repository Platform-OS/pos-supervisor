# Authentication -- Patterns & Best Practices

Common workflows and real-world patterns for authentication and authorization in platformOS.

## Login Flow

### Login form page (GET)

```liquid
---
slug: sessions/new
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  if profile
    redirect_to '/'
    break
  endif
  render 'sessions/form'
%}
```

### Login form partial

```html
<form method="post" action="/sessions">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">

  <label for="email">Email</label>
  <input type="email" id="email" name="email" required>

  <label for="password">Password</label>
  <input type="password" id="password" name="password" required>

  <button type="submit">Sign In</button>
</form>
```

### Login handler (POST)

```liquid
---
slug: sessions
method: post
---
{% liquid
  graphql user = 'users/authenticate', email: context.params.email, password: context.params.password

  if user.user == blank
    include 'modules/core/helpers/flash/publish', alert: 'app.sessions.invalid_credentials'
    render 'sessions/form'
    break
  endif

  sign_in user_id: user.user.id, timeout_in_minutes: 1440
  include 'modules/core/helpers/redirect_to', url: '/', notice: 'app.sessions.signed_in'
%}
```

## Logout Flow

```liquid
---
slug: sessions
method: delete
---
{% liquid
  sign_out
  include 'modules/core/helpers/redirect_to', url: '/', notice: 'app.sessions.signed_out'
%}
```

The logout form uses a hidden `_method` field:

```html
<form method="post" action="/sessions">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="hidden" name="_method" value="delete">
  <button type="submit">Sign Out</button>
</form>
```

## Registration Flow

### Registration page (POST)

```liquid
---
slug: registrations
method: post
---
{% liquid
  function result = 'lib/commands/registrations/create', params: context.params
  if result.errors != blank
    render 'registrations/form', errors: result.errors, params: context.params
    break
  endif

  sign_in user_id: result.id, timeout_in_minutes: 1440
  include 'modules/core/helpers/redirect_to', url: '/', notice: 'app.registrations.welcome'
%}
```

## Page Guard Pattern

The most common auth pattern: protect a page by checking permissions at the top.

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.view', redirect_anonymous_to_login: true
%}
```

### Guard with custom redirect

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_redirect', requester: profile, do: 'orders.view', return_url: '/login'
%}
```

## Conditional UI Based on Role

Show or hide elements depending on what the user can do.

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  function can_edit = 'modules/user/helpers/can_do', requester: profile, do: 'products.update'
  function can_delete = 'modules/user/helpers/can_do', requester: profile, do: 'products.delete'
%}

<h1>{{ product.title }}</h1>

{% if can_edit %}
  <a href="/products/{{ product.id }}/edit">Edit</a>
{% endif %}

{% if can_delete %}
  <form method="post" action="/products/{{ product.id }}">
    <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
    <input type="hidden" name="_method" value="delete">
    <button type="submit">Delete</button>
  </form>
{% endif %}
```

## Admin Section Pattern

An entire area restricted to admin users.

### Admin layout guard

Place the check in a shared partial rendered at the top of every admin page:

```liquid
{% comment %} app/views/partials/admin/guard.liquid {% endcomment %}
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.view', redirect_anonymous_to_login: true
  return profile
%}
```

### Admin page using the guard

```liquid
---
slug: admin/users
---
{% liquid
  function profile = 'admin/guard'
  graphql users = 'admin/users/list'
  render 'admin/users/index', users: users.records.results, profile: profile
%}
```

## Multi-Role Permission Check

Check multiple permissions and pass results to a partial:

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  function can_create = 'modules/user/helpers/can_do', requester: profile, do: 'products.create'
  function can_export = 'modules/user/helpers/can_do', requester: profile, do: 'products.export'
  render 'products/toolbar', can_create: can_create, can_export: can_export
%}
```

## Best Practices

1. **Always fetch the profile first** -- every protected page starts with `queries/user/current`
2. **Authenticate before fetching data** -- check permissions before running GraphQL queries
3. **Use `can_do_or_unauthorized` for pages** -- it handles both 403 and login redirect
4. **Use `can_do` for UI toggles** -- conditionally show buttons and links
5. **Never check roles directly** -- always check action strings so the permission matrix stays the single source of truth
6. **Keep action strings consistent** -- use `resource.verb` format (e.g., `products.create`, `orders.view`)
7. **Redirect after sign-in/sign-out** -- always redirect to prevent form resubmission
8. **Include CSRF token** -- every non-GET form must have the `authenticity_token` field

## See Also

- [Authentication Overview](README.md) -- introduction and key concepts
- [Authentication Configuration](configuration.md) -- role definitions and permission files
- [Authentication API](api.md) -- tags, helpers, and context objects
- [Authentication Gotchas](gotchas.md) -- common errors and limits
- [Pages Patterns](../pages/patterns.md) -- page-level guard and CRUD patterns
- [Forms Patterns](../forms/patterns.md) -- form submission with auth
