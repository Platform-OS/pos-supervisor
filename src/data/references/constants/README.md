# Constants (Secrets & Environment Configuration)

Constants in platformOS store **sensitive data** (API keys, secrets) and **environment-specific configuration** (URLs, feature flags). They are set per-environment via CLI or GraphQL and accessed at runtime through `context.constants`. Constants are never exposed in `{{ context }}` output for security.

## Key Purpose

Constants serve three critical roles in a platformOS application:

1. **Secret management** -- API keys, webhook secrets, and third-party credentials stay out of source control
2. **Environment-specific config** -- different values for staging vs production (API URLs, feature toggles)
3. **Module configuration** -- modules read constants for service credentials after installation

Think of constants as environment variables: set once per environment, available everywhere at runtime.

## When to Use

- **Storing API keys and secrets** -- Stripe keys, OpenAI tokens, SMTP passwords
- **Environment-specific URLs** -- API base URLs, webhook endpoints that differ per environment
- **Feature flags** -- toggle features on/off per environment without code changes
- **Module configuration** -- providing credentials that installed modules need to operate

You do NOT need constants when:
- The value is the same in all environments (use translations or hardcode in config)
- The value is user-specific (use session or database records)
- The value is page-specific (use front matter metadata)

## How It Works

1. A developer sets a constant via `pos-cli constants set` or the `constant_set` GraphQL mutation
2. The constant is stored server-side, scoped to that specific environment
3. At runtime, Liquid templates access the value via `{{ context.constants.CONSTANT_NAME }}`
4. Constants are excluded from `{{ context }}` serialization so they cannot leak to browser output

```
CLI / GraphQL  -->  Server-side storage (per-environment)  -->  context.constants.KEY
```

### Minimal example

```bash
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_abc123" dev
```

```liquid
{% liquid
  assign api_key = context.constants.STRIPE_SK_KEY
  graphql result = 'payments/charge', api_key: api_key, amount: 1000
%}
```

## Getting Started

1. Decide on a name using `UPPER_SNAKE_CASE` (e.g., `STRIPE_SK_KEY`)
2. Set the constant on your target environment:
   ```bash
   pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_abc123" dev
   ```
3. Access it in any Liquid template:
   ```liquid
   {{ context.constants.STRIPE_SK_KEY }}
   ```
4. Set a different value for production:
   ```bash
   pos-cli constants set --name STRIPE_SK_KEY --value "sk_live_xyz789" production
   ```
5. Optionally seed staging constants via a migration file

### Naming conventions

| Category       | Pattern                     | Examples                                        |
|----------------|-----------------------------|-------------------------------------------------|
| API keys       | `SERVICE_API_KEY`           | `STRIPE_SK_KEY`, `OPENAI_API_KEY`               |
| API secrets    | `SERVICE_SECRET`            | `TWILIO_API_SECRET`, `WEBHOOK_SECRET`            |
| API URLs       | `SERVICE_BASE_URL`          | `API_BASE_URL`, `WEBHOOK_URL`                    |
| Feature flags  | `FEATURE_NAME_ENABLED`      | `FEATURE_NEW_CHECKOUT_ENABLED`                   |
| Service config | `SERVICE_SETTING`           | `SMTP_HOST`, `SMTP_PORT`, `CDN_BUCKET`           |

## See Also

- [Constants Configuration](configuration.md) -- CLI commands, GraphQL mutations, and setup options
- [Constants API](api.md) -- runtime access patterns and Liquid usage
- [Constants Patterns](patterns.md) -- real-world workflows and best practices
- [Constants Gotchas](gotchas.md) -- common errors, limits, and troubleshooting
- [Constants Advanced](advanced.md) -- migrations, module config, and edge cases
- [Configuration Reference](../configuration/README.md) -- `.pos` and `app/config.yml` settings
- [Migrations](../migrations/README.md) -- seeding constants during environment setup
