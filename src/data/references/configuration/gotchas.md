# Configuration Gotchas

## Secrets Leaked in Version Control

### Committing .pos File with Real Tokens

```yaml
# WRONG: .pos file with real tokens committed to git
environments:
  production:
    token: 'abc123realproductiontoken'
    endpoint: 'https://production.platformos.com'
```

**Solution:** Use environment variables:

```yaml
# RIGHT: Reference environment variables
environments:
  production:
    token: $PRODUCTION_TOKEN
    endpoint: $PRODUCTION_ENDPOINT
```

Never commit real credentials. Add `.pos` to `.gitignore`.

## Configuration Not Reloading After Changes

### Edits to app/config.yml Don't Take Effect

Changes to `app/config.yml` require redeployment:

```bash
# Edit app/config.yml
# Make changes...

# Must deploy for changes to take effect
pos-cli deploy staging
```

Hot-reload not supported. Redeploy after config changes.

## Typos in Configuration Keys

### Silent Failures When Keys Misspelled

```liquid
<!-- Key exists -->
{{ context.config.features.enable_reviews }}  <!-- Works -->

<!-- Typo in key name -->
{{ context.config.features.enable_review }}   <!-- Returns nil silently -->
```

Use `pos-cli config validate` to catch typos:

```bash
pos-cli config validate
# Reports unknown keys in configuration
```

## Environment Variables Not Substituted

### $VARIABLE References Don't Work

```yaml
# WRONG: Variable not exported
environments:
  production:
    token: $PRODUCTION_TOKEN
    # If PRODUCTION_TOKEN not set, uses literal string "$PRODUCTION_TOKEN"
```

**Solution:** Export variables before deploy:

```bash
export PRODUCTION_TOKEN='abc123'
pos-cli deploy production
```

## Circular Configuration Dependencies

### Configuration References Each Other

```yaml
# WRONG: Circular reference
app:
  name: $APP_NAME
  description: "App: %{name}"  # References itself
```

Avoid self-referencing configuration. Keep it flat.

## Large Configuration Files

### Performance Issues with Big app/config.yml

```yaml
# WRONG: Thousands of config entries in one file
app:
  products:
    # 1000s of product configs hardcoded
```

**Solution:** Split into multiple config files:

```yaml
# app/config.yml (main)
# app/config/products.yml (specific)
```

Keep configuration files reasonably sized.

## Type Mismatches in Configuration

### String vs Number vs Boolean Confusion

```yaml
# app/config.yml
defaults:
  per_page: "20"     # String, not number
  enabled: "true"    # String, not boolean
  multiplier: 1.5    # Float is fine
```

```liquid
<!-- Type confusion -->
{% for i in (1..config.per_page) %}  <!-- Fails: string not iterable -->
{% if config.enabled %}              <!-- Always true: non-empty string -->
```

Be explicit about types in configuration:

```yaml
defaults:
  per_page: 20       # Number
  enabled: true      # Boolean
```

## Configuration Not Available in Migrations

### context.config Undefined During Migrations

```liquid
<!-- app/migrations/20240101000000_init.liquid -->
<!-- WRONG: config not available during migration -->
{% if context.config.features.auto_migrate %}
```

Configuration is only available at runtime. Use hardcoded values or GraphQL queries in migrations.

## Nested Key Access Errors

### Accessing Undefined Nested Keys

```liquid
<!-- WRONG: No error checking -->
{{ context.config.modules.payment.providers[0].api_key }}
<!-- Fails if payment module not configured -->

<!-- RIGHT: Safe access -->
{% if context.config.modules.payment %}
  {{ context.config.modules.payment.providers[0].api_key }}
{% endif %}
```

Check parent keys before accessing nested values.

## Configuration Drift Between Environments

### Staging and Production Configs Out of Sync

```yaml
# Staging config updated
staging:
  features:
    new_checkout: true

# Production config not updated
production:
  features:
    new_checkout: false  # Different!
```

**Solution:** Use shared base config:

```yaml
defaults: &defaults
  features:
    new_checkout: false

staging:
  <<: *defaults
  debug: true

production:
  <<: *defaults
  debug: false
```

## YAML Syntax Errors

### Malformed Configuration YAML

```yaml
# WRONG: Improper indentation
app:
name: "Store"    # Should be indented
enabled: true

# WRONG: Unquoted special characters
url: https://example.com?key=value  # ? needs quotes
regex: ^[a-z]+$  # Regex needs quotes
```

**Solution:** Properly format YAML:

```yaml
# RIGHT
app:
  name: "Store"
  enabled: true
  url: "https://example.com?key=value"
  regex: "^[a-z]+$"
```

## Missing Required Configuration

### Application Crashes Due to Missing Config

```liquid
<!-- WRONG: Assumes config always exists -->
{{ context.config.required_setting }}
<!-- Fails if required_setting not in config -->

<!-- RIGHT: Provide fallback -->
{{ context.config.required_setting | default: 'fallback_value' }}
```

Always provide defaults for optional configuration.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
