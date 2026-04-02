# Configuration Advanced Techniques

## Encrypted Configuration Values

Encrypt sensitive configuration data:

```yaml
# app/config.yml
secrets:
  api_keys:
    external_service: $ENCRYPTED_API_KEY
    webhook_secret: $ENCRYPTED_WEBHOOK_SECRET
```

Store encrypted values and decrypt at runtime:

```liquid
{% assign decrypted_key = context.config.secrets.api_keys.external_service | decrypt %}
```

## Configuration Hot-Reloading

Implement configuration caching with version tracking:

```liquid
{% assign config_version = context.deployment.version %}
{% cache 'app-config-' | append: config_version, expire: 86400 %}
  {% assign config = context.config | json %}
  {{ config }}
{% endcache %}

<!-- Detect config changes on deployment -->
{% if config_version != context.session.last_config_version %}
  {% session last_config_version = config_version %}
  Config updated
{% endif %}
```

## Configuration Inheritance

Create configuration inheritance hierarchy:

```yaml
# app/config.yml
base: &base
  app:
    name: "Store"
    version: "1.0"
  features:
    new_ui: false

staging:
  <<: *base
  debug: true
  api_timeout: 5000

production:
  <<: *base
  debug: false
  api_timeout: 10000
  cdn_url: "https://cdn.example.com"
```

## Dynamic Configuration from Database

Load configuration from database at runtime:

```liquid
{% graphql dynamic_config = 'get_application_config' %}

{% assign app_config = dynamic_config.config %}
<title>{{ app_config.site_title }}</title>
```

Allows configuration changes without deployment.

## Feature Flag Gradual Rollout

Implement percentage-based feature rollout:

```yaml
# app/config.yml
features:
  new_checkout:
    enabled: true
    rollout_percentage: 10  # Only 10% of users
```

```liquid
{% assign feature_rollout = context.config.features.new_checkout.rollout_percentage %}
{% assign user_hash = context.current_user.id | md5 | plus: 0 %}
{% assign should_enable = user_hash | modulo: 100 | less_than: feature_rollout %}

{% if should_enable %}
  <!-- Use new feature -->
{% else %}
  <!-- Use old feature -->
{% endif %}
```

## Configuration Schema Validation

Validate configuration structure:

```liquid
{% assign required_keys = 'app.name,app.version,features' | split: ',' %}

{% for key in required_keys %}
  {% unless context.config[key] %}
    Configuration Error: Missing required key "{{ key }}"
    {%- break -%}
  {% endunless %}
{% endfor %}
```

## Multi-Stage Configuration Pipeline

Apply configuration transformations:

```yaml
# Base configuration
base: &base
  cache_ttl: 300

# Environment-specific overrides
staging:
  <<: *base
  cache_ttl: 60  # Shorter for testing

# Per-request overrides
runtime:
  cache_ttl_override: 10  # For this request only
```

```liquid
{% assign cache_ttl = context.config.cache_ttl %}

<!-- Override for specific request -->
{% if context.params.no_cache %}
  {% assign cache_ttl = 0 %}
{% endif %}
```

## Configuration Audit Trail

Track configuration changes:

```liquid
<!-- Log configuration access -->
{% if context.params.audit %}
  {% graphql log = 'log_config_access',
    user_id: context.current_user.id,
    key: context.params.config_key,
    timestamp: 'now'
  %}
{% endif %}
```

## Conditional Imports

Include configuration conditionally:

```yaml
# app/config.yml
imports:
  - base.yml
  - "#{environment}.yml"  # staging.yml or production.yml
  - "#{region}.yml"       # us.yml, eu.yml, etc.
```

## Configuration Defaults Factory

Generate default configuration:

```liquid
{% comment %}
Generate default config if not explicitly set
{% endcomment %}
{% assign app_config = context.config | default: 'defaults/app-config.json' | json_parse %}

<!-- Use with fallback -->
{{ app_config.setting1 | default: 'fallback_value' }}
```

## Configuration Metrics

Monitor configuration usage:

```liquid
<script>
  window.configMetrics = {
    features_enabled: {{ context.config.features | size }},
    modules_enabled: {{ context.config.modules | size }},
    environment: '{{ context.environment }}'
  };
</script>
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Gotchas & Issues](./gotchas.md)
