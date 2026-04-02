# Constants -- Advanced Topics

Edge cases, optimization techniques, and advanced patterns for constants in platformOS.

## Storing Complex Configuration as JSON

For structured configuration that goes beyond simple key-value pairs, store JSON strings:

```bash
pos-cli constants set --name RATE_LIMITS --value '{"api":100,"uploads":10,"emails":50}' dev
pos-cli constants set --name ALLOWED_ORIGINS --value '["https://app.example.com","https://admin.example.com"]' dev
```

Parse at runtime:

```liquid
{% liquid
  assign limits = context.constants.RATE_LIMITS | parse_json
  assign api_limit = limits.api
  assign upload_limit = limits.uploads
%}
```

```liquid
{% liquid
  assign origins = context.constants.ALLOWED_ORIGINS | parse_json
  for origin in origins
    if context.headers.HTTP_ORIGIN == origin
      assign cors_allowed = true
      break
    endif
  endfor
%}
```

**Caveat:** The value must be valid JSON and fit within the 64 KB size limit. For very large configuration, use database records instead.

## Constant Rotation Strategy

When rotating API keys (e.g., during a security incident), follow this process:

### Zero-downtime key rotation

```bash
# Step 1: Set the new key alongside the old one
pos-cli constants set --name STRIPE_SK_KEY_NEW --value "sk_live_newkey" production

# Step 2: Deploy code that reads the new constant
# In Liquid: assign key = context.constants.STRIPE_SK_KEY_NEW

# Step 3: Verify new key works in production

# Step 4: Update the primary constant and deploy code back to using it
pos-cli constants set --name STRIPE_SK_KEY --value "sk_live_newkey" production

# Step 5: Remove the temporary constant
```

For critical services, use a helper that checks both keys:

```liquid
{% liquid
  assign primary_key = context.constants.STRIPE_SK_KEY
  assign fallback_key = context.constants.STRIPE_SK_KEY_FALLBACK
  assign active_key = primary_key | default: fallback_key
%}
```

## Multi-Tenant Configuration

When the same codebase serves multiple tenants, use constants to differentiate:

```bash
# Tenant A instance
pos-cli constants set --name TENANT_NAME --value "Acme Corp" tenant-a
pos-cli constants set --name TENANT_THEME --value "blue" tenant-a
pos-cli constants set --name TENANT_LOGO_URL --value "https://cdn.example.com/acme-logo.png" tenant-a

# Tenant B instance
pos-cli constants set --name TENANT_NAME --value "Beta Inc" tenant-b
pos-cli constants set --name TENANT_THEME --value "green" tenant-b
pos-cli constants set --name TENANT_LOGO_URL --value "https://cdn.example.com/beta-logo.png" tenant-b
```

```liquid
{% liquid
  assign tenant_name = context.constants.TENANT_NAME
  assign theme = context.constants.TENANT_THEME
  render 'layouts/header', tenant_name: tenant_name, theme: theme
%}
```

## Constants in Background Jobs

Background jobs have access to `context.constants` just like regular page requests:

```liquid
{% comment %} In a background job partial {% endcomment %}
{% liquid
  assign api_key = context.constants.SENDGRID_API_KEY
  graphql _ = 'emails/send_batch', api_key: api_key, recipients: recipients
%}
```

No special configuration is needed; constants are available in all execution contexts.

## Programmatic Constant Management

### Bulk setting via a management page

Create an admin page that sets constants programmatically:

```liquid
---
slug: admin/constants/update
method: post
---
{% liquid
  function profile = 'modules/user/queries/user/current'
  include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.constants'
  graphql _ = 'constants/set', name: context.params.name, value: context.params.value
  redirect_to '/admin/constants'
%}
```

**Security warning:** Restrict this page to super-admin users only. Validate inputs carefully.

### Constant cleanup script

Remove deprecated constants via a migration:

```liquid
{% comment %} app/migrations/20240601_cleanup_old_constants.liquid {% endcomment %}
{% liquid
  graphql _ = 'constants/unset', name: 'DEPRECATED_API_KEY'
  graphql _ = 'constants/unset', name: 'OLD_WEBHOOK_URL'
  graphql _ = 'constants/unset', name: 'LEGACY_FEATURE_FLAG'
%}
```

## Constants vs Database Records

| Criteria               | Constants                    | Database Records (Tables)          |
|------------------------|------------------------------|------------------------------------|
| Set by                 | Developer via CLI/GraphQL    | Application logic                  |
| Scope                  | Entire environment           | Per-record (can be user-scoped)    |
| Visibility             | Hidden from context output   | Visible via GraphQL queries        |
| Size limit             | 64 KB per value              | Field-level limits                 |
| Change frequency       | Rarely (config/secrets)      | Frequently (application data)      |
| Access speed           | Instant (preloaded)          | Requires GraphQL query             |
| Best for               | Secrets, env config, flags   | User data, application state       |

## Constants with API Call Notifications

Use constants to configure webhook and notification endpoints:

```liquid
{% liquid
  assign slack_webhook = context.constants.SLACK_WEBHOOK_URL
  if slack_webhook != blank
    graphql _ = 'api_calls/slack_notify', url: slack_webhook, message: alert_message
  endif
%}
```

This pattern allows disabling notifications by simply unsetting the constant.

## Performance Considerations

- Constants are loaded once per request as part of the `context` object
- Accessing a constant has negligible overhead compared to a GraphQL query
- Parsing JSON from a constant adds minimal processing time
- There is no caching needed for constants; they are already in-memory per request
- Avoid storing very large values (>10 KB) that require repeated parsing

## Debugging Constants

### In pos-cli gui serve

1. Open `pos-cli gui serve` in your browser
2. Navigate to the GraphQL editor
3. Run: `query { constants { name value } }`
4. Verify the constant exists and has the expected value

### In page code

```liquid
{% liquid
  assign key = context.constants.MY_KEY
  if key == blank
    log 'MY_KEY constant is not set', type: 'error'
  else
    log 'MY_KEY constant is set (not logging value)', type: 'debug'
  endif
%}
```

Never log the actual value of secret constants.

## See Also

- [Constants Overview](README.md) -- introduction and key concepts
- [Constants Configuration](configuration.md) -- CLI and GraphQL setup
- [Constants API](api.md) -- runtime access patterns
- [Constants Patterns](patterns.md) -- common workflows
- [Constants Gotchas](gotchas.md) -- common errors and limits
- [Background Jobs](../background-jobs/README.md) -- async job execution
- [Migrations](../migrations/README.md) -- seeding and cleanup scripts
