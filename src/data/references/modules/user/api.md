# modules/user - API Reference

The live API surface (call signatures, required/optional params, return types)
is exposed via `module_info(name: 'user', section: 'api')` and scanned directly
from the installed module's source. This file provides narrative notes and
GraphQL context that a disk scan cannot infer.

## GraphQL Schema Highlights

### Current User

Fetch the authenticated user's information server-side:

```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{{ current_user.email }}
```

Underlying operation:

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

### User by ID

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    email
    created_at
    roles { name }
  }
}
```

## Mutations

### Update User Profile

```graphql
mutation UpdateProfile($email: String, $first_name: String) {
  user_update(data: {
    email: $email
    first_name: $first_name
  }) {
    user { id email }
  }
}
```

### Create User

```graphql
mutation CreateUser($email: String!, $password: String!) {
  user_create(data: {
    email: $email
    password: $password
  }) {
    user { id email }
  }
}
```

## Authorization Helpers (use `{% function %}`, NOT `{% include %}`)

platformOS has deprecated `{% include %}` for app code. All user-module
authorization helpers MUST be invoked via `{% function %}`. The scan-derived
`module_info(name: 'user', section: 'api')` response contains the exact call
signature for each helper — always prefer that over examples here.

### Permission check

```liquid
{% function allowed = 'modules/user/helpers/can_do', requester: context.current_user, do: 'delete_post' %}
{% if allowed %}...{% endif %}
```

### Redirect unauthorized users

```liquid
{% function _ = 'modules/user/helpers/can_do_or_redirect', requester: context.current_user, do: 'admin_panel' %}
```

### Return 403 Forbidden for unauthorized users

```liquid
{% function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: context.current_user, do: 'sensitive_action' %}
```

MUST NOT use `{% include 'modules/user/helpers/...' %}` — the module's public
interface uses `{% function %}` with `requester` and `do` as required params.

## See Also

- `configuration.md` — setup and configuration
- `patterns.md` — common usage patterns
- `gotchas.md` — common mistakes
- `advanced.md` — advanced techniques
