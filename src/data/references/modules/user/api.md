# modules/user - API Reference

## Queries

### Current User Query
Fetch the authenticated user's information:

```graphql
query CurrentUser {
  current_user {
    id
    email
    first_name
    last_name
    roles {
      id
      name
    }
  }
}
```

Usage in Liquid:
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
{{ current_user.email }}
```

### User by ID
Retrieve a specific user:

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
    user { id, email }
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
    user { id, email }
  }
}
```

## Authorization Helpers

### Permission Check
```liquid
{% include 'modules/user/helpers/can_do' with_action: 'delete_post' %}
```

### Enforce Authorization
Redirect unauthorized users:
```liquid
{% include 'modules/user/helpers/can_do_or_redirect' with_action: 'admin_panel' %}
```

Return 403 Forbidden:
```liquid
{% include 'modules/user/helpers/can_do_or_unauthorized' with_action: 'sensitive_action' %}
```

## See Also
- configuration.md - Setup and configuration
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced techniques
