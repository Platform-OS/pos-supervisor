# modules/user - Common Patterns

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
{% if current_user.roles contains 'admin' %}
  <div class="admin-panel">
    <!-- admin features -->
  </div>
{% endif %}
```

## Authorization Patterns

### Require Authentication
Use the helper to redirect unauthenticated users:
```liquid
{% include 'modules/user/helpers/can_do_or_redirect'
  with_action: 'view_profile'
%}

<h1>{{ current_user.first_name }}'s Profile</h1>
```

### Check Permission Before Action
```liquid
{% include 'modules/user/helpers/can_do' with_action: 'edit_post' %}

{% if can_do %}
  <button>Edit Post</button>
{% else %}
  <p>You cannot edit this post</p>
{% endif %}
```

### Admin-Only Pages
```liquid
{% include 'modules/user/helpers/can_do_or_unauthorized'
  with_action: 'manage_users'
%}

<h1>User Management</h1>
```

## OAuth2 Patterns

### Social Login Button
```html
<a href="/auth/oauth/callback?provider=google">
  Sign in with Google
</a>
```

### Link Social Account
```liquid
{% graphql result = 'mutations/oauth/link_provider',
  provider: 'github'
%}
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

### Update User Settings
```liquid
{% graphql %}
  mutation UpdateSettings($bio: String) {
    profile_update(data: { bio: $bio }) {
      profile { id }
    }
  }
{% endgraphql %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API endpoints
- gotchas.md - Common mistakes
- advanced.md - Advanced techniques
