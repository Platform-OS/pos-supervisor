# Configuration

## .pos File (Environment Endpoints)

Located at project root. Defines environment URLs:

```yaml
dev:
  url: https://your-instance.staging.oregon.platform-os.com
staging:
  url: https://your-instance.staging.oregon.platform-os.com
production:
  url: https://your-instance.platform-os.com
```

## app/config.yml (Feature Flags)

Application-level configuration:

```yaml
# app/config.yml
modules:
  core:
    enabled: true
  user:
    enabled: true
  common-styling:
    enabled: true
```

## Constants (Runtime Configuration)

For secrets and environment-specific values. See `references/constants/`.

```bash
pos-cli constants set --name KEY --value "value" dev
```

## Environment Detection

```liquid
{% if context.environment == 'staging' %}
  {% comment %} Staging-only behavior {% endcomment %}
{% endif %}

{% if context.environment == 'production' %}
  {% comment %} Production-only behavior {% endcomment %}
{% endif %}
```

## Module Configuration

Modules are configured via installation and constants:

```bash
# Install module
pos-cli modules install payments

# Configure module via constants
pos-cli constants set --name stripe_sk_key --value "sk_..." dev
```
