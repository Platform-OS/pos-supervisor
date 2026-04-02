# Configuration Patterns

## Environment-Aware Service Configuration

Configure services differently per environment:

```yaml
# app/config.yml
services:
  email:
    staging:
      provider: 'sendgrid'
      api_key: $STAGING_SENDGRID_KEY
      from: 'test@example.com'

    production:
      provider: 'sendgrid'
      api_key: $PRODUCTION_SENDGRID_KEY
      from: 'noreply@example.com'

  payment:
    staging:
      provider: 'stripe'
      test_mode: true
      api_key: $STRIPE_TEST_KEY

    production:
      provider: 'stripe'
      test_mode: false
      api_key: $STRIPE_LIVE_KEY
```

```liquid
<!-- Use appropriate service config -->
{% assign service_config = context.config.services.email[context.environment] %}
```

## Feature Flag Management

Gate features behind configuration:

```yaml
# app/config.yml
features:
  new_ui: false
  advanced_search: true
  recommendation_engine: false
  social_login: true
  dark_mode: false
```

```liquid
<!-- Enable/disable UI components -->
{% if context.config.features.new_ui %}
  {% include 'ui/new-interface' %}
{% else %}
  {% include 'ui/legacy-interface' %}
{% endif %}

<!-- Toggle features without code changes -->
{% if context.config.features.dark_mode %}
  <link rel="stylesheet" href="{{ 'styles/dark-theme.css' | asset_url }}">
{% else %}
  <link rel="stylesheet" href="{{ 'styles/light-theme.css' | asset_url }}">
{% endif %}
```

## Rate Limiting Configuration

Configure rate limits per tier:

```yaml
# app/config.yml
rate_limiting:
  free_tier:
    requests_per_minute: 60
    requests_per_day: 1000

  pro_tier:
    requests_per_minute: 600
    requests_per_day: 100000

  enterprise_tier:
    requests_per_minute: 10000
    requests_per_day: 100000000
```

```liquid
{% assign user_tier = context.current_user.account_tier %}
{% assign limits = context.config.rate_limiting[user_tier] %}

{% if current_requests > limits.requests_per_minute %}
  Rate limit exceeded
{% endif %}
```

## Multi-Tenant Configuration

Configure per-tenant settings:

```yaml
# app/config.yml
tenants:
  acme_corp:
    name: "ACME Corporation"
    domain: "acme.example.com"
    logo: "https://cdn.example.com/acme-logo.png"
    primary_color: "#0066cc"
    features:
      - advanced_analytics
      - custom_branding

  globex:
    name: "Globex Inc"
    domain: "globex.example.com"
    logo: "https://cdn.example.com/globex-logo.png"
    primary_color: "#ff6600"
    features:
      - advanced_analytics
```

```liquid
{% assign tenant = context.config.tenants[context.current_tenant] %}

<img src="{{ tenant.logo }}" alt="{{ tenant.name }}">
<style>
  :root { --primary-color: {{ tenant.primary_color }}; }
</style>
```

## Dynamic Pricing Configuration

Store pricing rules in configuration:

```yaml
# app/config.yml
pricing:
  volume_discounts:
    - quantity: 1
      discount_percent: 0
    - quantity: 10
      discount_percent: 5
    - quantity: 50
      discount_percent: 10
    - quantity: 100
      discount_percent: 15

  regional_markup:
    US: 0
    EU: 0.21
    UK: 0.20
    CA: 0.13
```

```liquid
{% assign discounts = context.config.pricing.volume_discounts %}
{% assign markup = context.config.pricing.regional_markup[context.current_region] %}
```

## API Endpoint Configuration

Centralize API endpoints:

```yaml
# app/config.yml
apis:
  external_services:
    shipping:
      url: $SHIPPING_API_URL
      timeout: 5000
    inventory:
      url: $INVENTORY_API_URL
      timeout: 10000
    recommendations:
      url: $RECOMMENDATIONS_API_URL
      timeout: 3000
```

```liquid
{% assign shipping_url = context.config.apis.external_services.shipping.url %}
```

## Logging and Debug Configuration

Control debugging and logging:

```yaml
# app/config.yml
logging:
  level: debug  # debug, info, warn, error
  format: json  # json, text
  destinations:
    - stdout
    - file

debug:
  enabled: false
  sql_logging: false
  slow_query_threshold_ms: 500
```

## Theme Configuration

Store theme settings:

```yaml
# app/config.yml
theme:
  colors:
    primary: "#0066cc"
    secondary: "#ff6600"
    success: "#22c55e"
    error: "#ef4444"
    warning: "#f59e0b"

  fonts:
    primary: "Inter"
    secondary: "Menlo"
    size_base: 16

  spacing:
    unit: 8  # pixels
    gap_default: 2  # units
```

## Cache Configuration by Content Type

Different cache strategies per content:

```yaml
# app/config.yml
cache:
  static:
    ttl: 604800  # 7 days
  products:
    ttl: 3600    # 1 hour
  user_profiles:
    ttl: 300     # 5 minutes
  search:
    ttl: 1800    # 30 minutes
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
