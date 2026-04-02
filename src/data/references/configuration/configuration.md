# Configuration Configuration

## Overview

platformOS configuration is managed through two main files: the `.pos` file containing environment endpoints and credentials in YAML format, and `app/config.yml` containing feature flags, module settings, and application constants. Context variables expose configuration at runtime via `context.environment`, `context.config`, and constants. Proper configuration management separates environment-specific values from code.

## .pos File Structure

The `.pos` file stores authentication and deployment endpoints:

```yaml
# .pos file
environments:
  staging:
    endpoint: 'https://staging.platformos.com'
    token: 'your-staging-token'
    url: 'https://staging-app.example.com'
    cdn_url: 'https://staging-cdn.example.com'

  production:
    endpoint: 'https://production.platformos.com'
    token: 'your-production-token'
    url: 'https://app.example.com'
    cdn_url: 'https://cdn.example.com'
```

Never commit `.pos` with real tokens. Use environment variables.

## Environment Variables in .pos

Reference environment variables for security:

```yaml
# .pos file
environments:
  staging:
    endpoint: $STAGING_ENDPOINT
    token: $STAGING_TOKEN
    url: 'https://staging-app.example.com'

  production:
    endpoint: $PRODUCTION_ENDPOINT
    token: $PRODUCTION_TOKEN
    url: 'https://app.example.com'
```

Set variables locally:

```bash
export STAGING_ENDPOINT='https://staging.platformos.com'
export STAGING_TOKEN='abc123def456'
```

## app/config.yml Structure

Application-level configuration:

```yaml
# app/config.yml
app:
  name: "My Store"
  version: "1.0.0"
  description: "My awesome store"

features:
  enable_reviews: true
  enable_recommendations: true
  enable_wishlists: false

modules:
  seo:
    enabled: true
    config:
      max_title_length: 60
      max_description_length: 160

  emails:
    enabled: true
    config:
      from_address: "noreply@example.com"
      from_name: "My Store"

  payments:
    provider: "stripe"
    config:
      currency: "USD"
      test_mode: true
```

## Context Environment Detection

Detect current environment in templates:

```liquid
<!-- Current environment: 'staging' or 'production' -->
{{ context.environment }}

<!-- Use environment-specific logic -->
{% if context.environment == 'production' %}
  <!-- Production only -->
  {% include 'analytics' %}
{% else %}
  <!-- Staging/development -->
  Development Mode Active
{% endif %}
```

## Constants Configuration

Define application constants:

```yaml
# app/config.yml
constants:
  MAX_PRODUCTS_PER_PAGE: 20
  CART_EXPIRATION_DAYS: 30
  LOYALTY_POINTS_PER_DOLLAR: 1
  FREE_SHIPPING_THRESHOLD: 50
  TAX_RATE: 0.08
```

## Accessing Configuration

### Context Configuration

Access config in templates:

```liquid
{{ context.config.app.name }}
{{ context.config.features.enable_reviews }}
{{ context.config.modules.seo.enabled }}
```

### Conditional Features

Gate features behind configuration:

```liquid
{% if context.config.features.enable_wishlists %}
  <button class="add-to-wishlist">♡ Add to Wishlist</button>
{% endif %}
```

## Environment-Specific Configuration

Load different configs per environment:

```yaml
# app/config.yml
default: &default
  app:
    name: "Store"

staging:
  <<: *default
  debug: true
  cache_ttl: 300

production:
  <<: *default
  debug: false
  cache_ttl: 3600
```

## Module Configuration

Configure individual modules:

```yaml
# app/config.yml
modules:
  shipping:
    enabled: true
    providers:
      - name: "UPS"
        api_key: $UPS_API_KEY
      - name: "FedEx"
        api_key: $FEDEX_API_KEY

  inventory:
    enabled: true
    config:
      warn_threshold: 10
      auto_reorder: false
```

## Database Configuration

Configure database connections:

```yaml
# app/config.yml
database:
  primary:
    host: "db.example.com"
    port: 5432
    name: "app_production"
    pool_size: 10

  replica:
    host: "db-replica.example.com"
    port: 5432
    name: "app_production"
    pool_size: 5
```

## Feature Flags

Define feature toggles:

```yaml
# app/config.yml
features:
  new_checkout_ui: false
  enhanced_search: true
  beta_recommendations: false
  dark_mode: true
  two_factor_auth: true
```

Enable/disable features without code changes.

## See Also

- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
