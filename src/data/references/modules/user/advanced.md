# modules/user - Advanced Configuration

## Custom Permission System

### Override Permission Logic
Create custom permission rules in `permissions.liquid`:

```liquid
# app/lib/modules/user/permissions.liquid

{% assign action = include.action %}
{% assign user = include.user %}

{% case action %}
  {% when 'edit_post' %}
    {% if post.author_id == user.id %}
      {% assign can_do = true %}
    {% endif %}
  {% when 'delete_post' %}
    {% if user.roles contains 'moderator' %}
      {% assign can_do = true %}
    {% endif %}
{% endcase %}
```

### Role Hierarchies
Implement role inheritance:

```liquid
{% assign role = current_user.roles.first %}

{% case role %}
  {% when 'superadmin' %}
    {% assign permissions = 'create_user,delete_user,manage_settings' | split: ',' %}
  {% when 'admin' %}
    {% assign permissions = 'create_user,edit_content' | split: ',' %}
  {% when 'moderator' %}
    {% assign permissions = 'edit_content,delete_comments' | split: ',' %}
{% endcase %}
```

## Multi-Tenant Authorization

### Tenant Context
Add tenant awareness to permissions:

```liquid
{% assign tenant_id = site.tenant_id %}

{% include 'modules/user/helpers/can_do'
  with_action: 'edit_content'
  with_context: tenant_id
%}
```

### Tenant Isolation
Ensure cross-tenant data protection:

```graphql
query UserContent($tenant_id: ID!) {
  content(filter: { tenant_id: $tenant_id }) {
    id
    title
  }
}
```

## Advanced OAuth2 Setup

### Multiple Provider Configuration
Support multiple OAuth2 providers:

```liquid
{% liquid
  assign providers = 'google,github,linkedin' | split: ','
%}

{% for provider in providers %}
  <a href="/auth/oauth/{{ provider }}">
    Sign in with {{ provider | capitalize }}
  </a>
{% endfor %}
```

### Custom Provider Integration
Add custom OAuth2 provider:

```graphql
mutation ConfigureOAuthProvider($name: String!, $config: JSON!) {
  oauth_provider_create(data: {
    name: $name
    client_id: $config.client_id
    client_secret: $config.client_secret
  }) {
    oauth_provider { id }
  }
}
```

## Session Management

### Custom Session Timeout
Implement session expiration:

```liquid
{% assign session_duration = 3600 %}
{% assign session_created = current_user.session_created_at %}
{% assign now = 'now' | date: '%s' | plus: 0 %}
{% assign elapsed = now | minus: session_created %}

{% if elapsed > session_duration %}
  <!-- force logout -->
{% endif %}
```

### Concurrent Session Control
Limit concurrent logins:

```liquid
{% graphql active_sessions = 'queries/user/active_sessions' %}

{% if active_sessions.size >= max_concurrent_sessions %}
  <!-- ask user to logout from another device -->
{% endif %}
```

## Audit Logging

### Track Authorization Events
Log all authorization checks:

```liquid
{% include 'modules/user/helpers/can_do'
  with_action: 'delete_sensitive_data'
  with_audit: true
%}
```

### Create Audit Entry
```graphql
mutation LogAuthorizationEvent($action: String!, $result: Boolean) {
  audit_log_create(data: {
    action: $action
    result: $result
    user_id: $user_id
    timestamp: "now"
  }) {
    audit_log { id }
  }
}
```

## See Also
- configuration.md - Basic setup
- api.md - API reference
- patterns.md - Common patterns
- gotchas.md - Common mistakes
