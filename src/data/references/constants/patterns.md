# Constants -- Patterns & Best Practices

Common workflows and real-world patterns for managing constants in platformOS.

## Multi-Environment Setup

The most common pattern: maintain different constant values across staging and production.

### Initial setup for a new project

```bash
# Staging environment
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_abc123" staging
pos-cli constants set --name STRIPE_PK_KEY --value "pk_test_abc123" staging
pos-cli constants set --name API_BASE_URL --value "https://api-staging.example.com" staging
pos-cli constants set --name SENDGRID_API_KEY --value "SG.test_key" staging

# Production environment
pos-cli constants set --name STRIPE_SK_KEY --value "sk_live_xyz789" production
pos-cli constants set --name STRIPE_PK_KEY --value "pk_live_xyz789" production
pos-cli constants set --name API_BASE_URL --value "https://api.example.com" production
pos-cli constants set --name SENDGRID_API_KEY --value "SG.live_key" production
```

### Documenting required constants

Keep a reference list in your project documentation so team members know which constants to set:

```
Required constants:
  STRIPE_SK_KEY        - Stripe secret key (sk_test_* for staging)
  STRIPE_PK_KEY        - Stripe publishable key (pk_test_* for staging)
  API_BASE_URL         - External API base URL
  SENDGRID_API_KEY     - SendGrid API key for transactional email
  WEBHOOK_SECRET       - Webhook signature verification secret
```

## Feature Flag Pattern

Use constants as simple feature toggles without code deploys.

### Setting the flag

```bash
pos-cli constants set --name FEATURE_NEW_CHECKOUT_ENABLED --value "true" staging
pos-cli constants set --name FEATURE_NEW_CHECKOUT_ENABLED --value "false" production
```

### Checking the flag in Liquid

```liquid
{% liquid
  if context.constants.FEATURE_NEW_CHECKOUT_ENABLED == 'true'
    render 'checkout/new_flow', cart: cart
  else
    render 'checkout/legacy_flow', cart: cart
  endif
%}
```

### Gradual rollout

Enable on staging first, verify, then enable on production:

```bash
# Step 1: Enable on staging, test thoroughly
pos-cli constants set --name FEATURE_NEW_CHECKOUT_ENABLED --value "true" staging

# Step 2: After QA passes, enable on production
pos-cli constants set --name FEATURE_NEW_CHECKOUT_ENABLED --value "true" production

# Step 3: Once stable, remove the flag and the legacy code path
```

## Migration Seeding Pattern

Automatically set constants when provisioning a new environment.

```liquid
{% comment %} app/migrations/20240115120000_seed_constants.liquid {% endcomment %}
{% liquid
  if context.environment == 'staging'
    graphql _ = 'constants/set', name: 'STRIPE_SK_KEY', value: 'sk_test_default_for_staging'
    graphql _ = 'constants/set', name: 'API_BASE_URL', value: 'https://api-staging.example.com'
    graphql _ = 'constants/set', name: 'FEATURE_NEW_CHECKOUT_ENABLED', value: 'false'
  endif
%}
```

**Warning:** Never seed production secrets in migrations. Migration files are in source control.

## Third-Party Integration Pattern

Store all credentials for an external service as a group of constants.

### Stripe integration

```bash
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_..." dev
pos-cli constants set --name STRIPE_PK_KEY --value "pk_test_..." dev
pos-cli constants set --name STRIPE_WEBHOOK_SECRET --value "whsec_..." dev
```

```liquid
{% comment %} In the page: pass keys to the integration partial {% endcomment %}
{% liquid
  render 'integrations/stripe/checkout',
    pk_key: context.constants.STRIPE_PK_KEY,
    amount: order.total
%}
```

```liquid
{% comment %} In a webhook handler page: verify the signature {% endcomment %}
{% liquid
  assign secret = context.constants.STRIPE_WEBHOOK_SECRET
  function valid = 'lib/helpers/verify_stripe_signature', payload: context.params, secret: secret
  unless valid
    render 'api/errors/unauthorized'
    break
  endunless
%}
```

### SendGrid integration

```bash
pos-cli constants set --name SENDGRID_API_KEY --value "SG.xxxx" dev
pos-cli constants set --name SENDGRID_FROM_EMAIL --value "noreply@example.com" dev
pos-cli constants set --name SENDGRID_FROM_NAME --value "My App" dev
```

## Module Configuration Pattern

After installing a module, configure it with constants.

```bash
# Install the payments module
pos-cli modules install payments

# Set the constants the module expects
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_..." dev
pos-cli constants set --name STRIPE_PK_KEY --value "pk_test_..." dev
```

The module internally reads `context.constants.STRIPE_SK_KEY` without you needing to pass it explicitly.

## Environment Detection Pattern

Combine `context.environment` with constants for environment-aware behavior.

```liquid
{% liquid
  if context.environment == 'production'
    assign tracking_id = context.constants.GA_TRACKING_ID
    render 'shared/analytics', tracking_id: tracking_id
  endif
%}
```

## Constant as Configuration Table Pattern

For complex configuration, store JSON as a constant value:

```bash
pos-cli constants set --name RATE_LIMITS --value '{"api": 100, "uploads": 10, "emails": 50}' dev
```

```liquid
{% liquid
  assign limits = context.constants.RATE_LIMITS | parse_json
  assign api_limit = limits.api
  assign upload_limit = limits.uploads
%}
```

## Best Practices

1. **NEVER hardcode secrets** -- all API keys, passwords, and tokens go in constants
2. **Use UPPER_SNAKE_CASE** -- consistent naming makes constants easy to identify
3. **Prefix with service name** -- `STRIPE_SK_KEY` not `SK_KEY`; `SENDGRID_API_KEY` not `API_KEY`
4. **Document required constants** -- maintain a list of all constants your app needs
5. **Seed staging in migrations** -- but never seed production secrets in source code
6. **Check for nil** -- always handle the case where a constant is not set
7. **Keep values as strings** -- constants are always strings; parse as needed
8. **Rotate secrets regularly** -- use `pos-cli constants set` to update credentials

## See Also

- [Constants Overview](README.md) -- introduction and key concepts
- [Constants Configuration](configuration.md) -- CLI and GraphQL setup reference
- [Constants API](api.md) -- runtime access in Liquid
- [Constants Gotchas](gotchas.md) -- common errors and limits
- [Constants Advanced](advanced.md) -- edge cases and optimization
- [Migrations](../migrations/README.md) -- seeding constants during provisioning
