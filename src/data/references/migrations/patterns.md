# Migrations Patterns

## Initial Schema Setup

Create database schema on first deployment:

```liquid
<!-- app/migrations/20240101000000_create_schema.liquid -->
{% comment %}
Migration: Create Initial Schema
Creates tables and indexes for the application
{% endcomment %}

{% if context.first_deployment %}
  {% graphql create = 'create_table',
    name: 'products',
    columns: '[
      { name: "id", type: "uuid", primary_key: true },
      { name: "name", type: "string" },
      { name: "description", type: "text" },
      { name: "price", type: "decimal" },
      { name: "created_at", type: "timestamp" }
    ]'
  %}

  {% graphql index = 'create_index',
    table: 'products',
    columns: 'name,category_id'
  %}
{% endif %}
```

## Data Seeding Pattern

Populate initial data:

```liquid
<!-- app/migrations/20240102000000_seed_categories.liquid -->
{% assign categories = 'Electronics,Clothing,Books,Home' | split: ',' %}

{% for category in categories %}
  {% graphql existing = 'get_category_by_name', name: category %}

  {% unless existing.category %}
    {% graphql create = 'create_category',
      name: category,
      active: true
    %}
  {% endunless %}
{% endfor %}
```

## Constants Initialization

Initialize application constants:

```liquid
<!-- app/migrations/20240103000000_initialize_constants.liquid -->
{% graphql const1 = 'set_constant',
  key: 'STORE_NAME',
  value: 'My Store'
%}

{% graphql const2 = 'set_constant',
  key: 'MAX_CART_ITEMS',
  value: '100'
%}

{% graphql const3 = 'set_constant',
  key: 'FREE_SHIPPING_THRESHOLD',
  value: '50'
%}

{% graphql const4 = 'set_constant',
  key: 'TAX_RATE',
  value: '0.08'
%}
```

## Admin User Setup

Create initial admin account:

```liquid
<!-- app/migrations/20240104000000_create_admin_user.liquid -->
{% unless context.first_deployment %}
  Admin already created
  {% break %}
{% endunless %}

{% graphql admin = 'create_user',
  email: 'admin@example.com',
  name: 'Administrator',
  password: $ADMIN_PASSWORD,
  role: 'admin'
%}

{% if admin.user %}
  Created admin user
{% else %}
  Failed to create admin: {{ admin.error }}
{% endif %}
```

## Default Configuration Setup

Initialize default settings:

```liquid
<!-- app/migrations/20240105000000_setup_defaults.liquid -->
{% graphql defaults = 'create_configuration',
  key: 'store_settings',
  value: {
    currency: 'USD',
    timezone: 'UTC',
    language: 'en',
    email_from: 'noreply@example.com'
  }
%}

{% graphql permissions = 'create_configuration',
  key: 'default_permissions',
  value: {
    guest_checkout: true,
    require_email_verification: false,
    enable_wishlists: true
  }
%}
```

## Feature Flag Initialization

Set up feature toggles:

```liquid
<!-- app/migrations/20240106000000_initialize_features.liquid -->
{% assign features = 'new_ui,advanced_search,recommendations,dark_mode' | split: ',' %}

{% for feature in features %}
  {% graphql result = 'create_feature_flag',
    key: feature,
    enabled: false,
    rollout_percentage: 0
  %}
{% endfor %}
```

## Environment-Specific Setup

Run different migrations per environment:

```liquid
<!-- app/migrations/20240107000000_environment_setup.liquid -->
{% if context.environment == 'production' %}
  {% graphql enable = 'enable_backups' %}
  {% graphql enable = 'enable_monitoring' %}
  {% graphql enable = 'enable_caching' %}
{% elsif context.environment == 'staging' %}
  {% graphql enable = 'enable_debug_logging' %}
  {% graphql disable = 'disable_external_emails' %}
{% endif %}
```

## Database Maintenance Migration

Run maintenance tasks:

```liquid
<!-- app/migrations/20240108000000_maintenance.liquid -->
{% graphql analyze = 'analyze_tables' %}
{% graphql reindex = 'reindex_all' %}
{% graphql vacuum = 'vacuum_database' %}

Migration maintenance complete
```

## Data Transformation Migration

Transform existing data:

```liquid
<!-- app/migrations/20240109000000_normalize_product_data.liquid -->
{% graphql all_products = 'get_all_products' %}

{% for product in all_products.products %}
  {% graphql update = 'update_product',
    id: product.id,
    slug: product.name | downcase | replace: ' ', '-',
    status: 'active'
  %}
{% endfor %}

Updated {{ all_products.products | size }} products
```

## Notification on Migration Completion

Alert when important migrations finish:

```liquid
<!-- app/migrations/20240110000000_send_deployment_complete.liquid -->
{% if context.first_deployment %}
  {% graphql notify = 'send_email',
    to: 'admin@example.com',
    subject: 'Initial deployment complete',
    body: 'Your application is ready to use'
  %}
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
