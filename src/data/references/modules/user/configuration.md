# modules/user - Configuration

## Overview
The `modules/user` is a required module that handles authentication, authorization, and user management. It provides role-based access control (RBAC) and OAuth2 integration.

## Installation

The user module is required and installed by default. No additional setup steps are needed.

## Core Configuration

### User Context Access
Get the current user in your Liquid code:
```liquid
{% graphql current_user = 'modules/user/queries/user/current' %}
```

### Roles Setup
The module provides three default roles:
- **anonymous**: Unauthenticated users
- **authenticated**: Logged-in users
- **superadmin**: Full system access

### Custom Roles
Create custom roles by overriding `permissions.liquid`:
```liquid
# app/lib/modules/user/permissions.liquid
{% case role %}
  {% when 'moderator' %}
    can_moderate: true
  {% when 'content-editor' %}
    can_edit_content: true
{% endcase %}
```

## OAuth2 Configuration

### Provider Setup
Configure OAuth2 providers in your instance:

```yaml
oauth_providers:
  - provider: google
    client_id: YOUR_CLIENT_ID
    client_secret: YOUR_CLIENT_SECRET
  - provider: github
    client_id: YOUR_CLIENT_ID
    client_secret: YOUR_CLIENT_SECRET
```

### Environment Variables
Set credentials via environment:
```
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=yyy
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=yyy
```

## Permission Helpers

### Check Permissions
Use the permission helper to verify access:
```liquid
{% include 'modules/user/helpers/can_do' with_action: 'edit_post' %}
{% if can_do %}
  <!-- show edit button -->
{% endif %}
```

## See Also
- api.md - API endpoints and queries
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced configuration
