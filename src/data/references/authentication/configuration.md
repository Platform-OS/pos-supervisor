# Authentication -- Configuration Reference

This document covers all configuration files, role definitions, and session options for the pos-module-user authentication system.

## Permission File

The permissions matrix maps roles to action strings. Override it to define custom roles.

### Default location

```
modules/user/public/lib/queries/role_permissions/permissions.liquid
```

### Override path

```
app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

### Setup

```bash
mkdir -p app/modules/user/public/lib/queries/role_permissions
cp modules/user/public/lib/queries/role_permissions/permissions.liquid \
   app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

### Permission file format

```liquid
{% assign data = {
  "admin": [
    "admin.view",
    "users.manage",
    "products.create",
    "products.update",
    "products.delete"
  ],
  "editor": [
    "article.create",
    "article.update",
    "article.delete",
    "article.view"
  ],
  "viewer": [
    "article.view"
  ],
  "superadmin": []
} %}
{% return data %}
```

**Important:** `superadmin` is listed with an empty array because it automatically bypasses every permission check. You must still include the key so the role is recognized.

### Action string conventions

| Pattern | Example | Meaning |
|---------|---------|---------|
| `resource.verb` | `products.create` | Standard CRUD action |
| `namespace.action` | `admin.view` | Area-level access |
| `resource.*` | N/A (not supported) | Wildcards are NOT supported; list each action |

## Built-in Roles

| Role | Stored Value | Behavior |
|------|-------------|----------|
| `anonymous` | No user record | Unauthenticated visitor; checked when `profile` is nil |
| `authenticated` | Any user with a session | Passes any check that lists `authenticated` |
| `superadmin` | User with `superadmin` role | Bypasses ALL permission checks automatically |

### Assigning roles to users

Roles are stored on the user record. Set them via GraphQL when creating or updating a user:

```graphql
mutation set_role($id: ID!, $role: String!) {
  user_update(id: $id, user: { properties: [{ name: "role", value: $role }] }) {
    id
  }
}
```

Or via a command partial that wraps the mutation.

## Session Configuration

### Sign-in options

```liquid
{% sign_in user_id: user.id %}
{% sign_in user_id: user.id, timeout_in_minutes: 60 %}
{% sign_in user_id: user.id, timeout_in_minutes: 1440 %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `user_id` | ID | required | The user record ID to authenticate |
| `timeout_in_minutes` | Integer | Platform default | Session duration in minutes |

### Sign-out

```liquid
{% sign_out %}
```

No parameters. Destroys the current session immediately.

## CSRF Token Configuration

Non-GET requests MUST include the CSRF token. Without it, `context.current_user` is `null` and the user appears unauthenticated.

```html
<form method="post" action="/login">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <!-- fields -->
</form>
```

For AJAX requests, include the token as a header or form field:

```javascript
fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    authenticity_token: document.querySelector('[name="authenticity_token"]').value,
    // ...payload
  })
});
```

## File Structure

```
app/
├── modules/
│   └── user/
│       └── public/
│           └── lib/
│               └── queries/
│                   └── role_permissions/
│                       └── permissions.liquid    # Custom role definitions
├── views/
│   └── pages/
│       ├── sessions/
│       │   ├── new.liquid                        # GET  /sessions/new  (login form)
│       │   ├── create.liquid                     # POST /sessions      (sign in)
│       │   └── destroy.liquid                    # DELETE /sessions     (sign out)
│       └── registrations/
│           ├── new.liquid                        # GET  /registrations/new
│           └── create.liquid                     # POST /registrations
└── graphql/
    └── users/
        ├── create.graphql                        # Registration mutation
        ├── find.graphql                          # Lookup by email
        └── update_role.graphql                   # Role assignment
```

## Environment Considerations

- **Staging vs Production:** Permission files are deployed with the codebase. Role data lives in the database. Ensure test users on staging have appropriate roles.
- **Module updates:** When upgrading `pos-module-user`, re-check that your override file is still compatible with the module's expected return format.

## See Also

- [Authentication Overview](README.md) -- introduction and key concepts
- [Authentication API](api.md) -- Liquid tags and helpers
- [Authentication Patterns](patterns.md) -- login flow, guards, role-based rendering
- [Authentication Gotchas](gotchas.md) -- common configuration errors
- [Forms Configuration](../forms/configuration.md) -- CSRF and form setup
