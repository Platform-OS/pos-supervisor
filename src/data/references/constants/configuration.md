# Constants -- Configuration Reference

This document covers all methods for setting, updating, and removing constants in platformOS.

## Setting Constants via CLI

The primary method for managing constants is the `pos-cli` command line tool.

### Set a constant

```bash
pos-cli constants set --name CONSTANT_NAME --value "constant_value" ENVIRONMENT
```

| Flag       | Type   | Required | Description                          |
|------------|--------|----------|--------------------------------------|
| `--name`   | String | Yes      | Constant name (UPPER_SNAKE_CASE)     |
| `--value`  | String | Yes      | Constant value (quote if it contains spaces) |
| ENVIRONMENT | String | Yes     | Target environment from `.pos` file  |

```bash
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_abc123" dev
pos-cli constants set --name API_BASE_URL --value "https://api.example.com" staging
pos-cli constants set --name FEATURE_CHAT_ENABLED --value "true" production
```

### List constants

```bash
pos-cli constants list ENVIRONMENT
```

Displays all constant names (values are masked for security).

### Overwrite a constant

Run `set` again with the same name. The value is replaced:

```bash
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_newvalue" dev
```

There is no separate "update" command; `set` is idempotent.

## Setting Constants via GraphQL

Constants can also be managed through the GraphQL interface (accessible via `pos-cli gui serve` or programmatically in migrations).

### constant_set mutation

```graphql
mutation {
  constant_set(name: "STRIPE_SK_KEY", value: "sk_test_abc123") {
    name
  }
}
```

| Argument | Type   | Required | Description              |
|----------|--------|----------|--------------------------|
| `name`   | String | Yes      | Constant name            |
| `value`  | String | Yes      | Constant value           |

### constant_unset mutation

Removes a constant entirely:

```graphql
mutation {
  constant_unset(name: "OLD_UNUSED_KEY") {
    name
  }
}
```

| Argument | Type   | Required | Description              |
|----------|--------|----------|--------------------------|
| `name`   | String | Yes      | Constant name to remove  |

### Querying constants

```graphql
query {
  constants {
    name
    value
  }
}
```

This returns all constants with their values. Use this in the `pos-cli gui` for debugging.

## Naming Rules

- Use `UPPER_SNAKE_CASE` exclusively
- Names must be unique per environment
- Names are case-sensitive: `Api_Key` and `API_KEY` are different constants
- Avoid special characters; stick to letters, digits, and underscores
- Prefix with service name for clarity: `STRIPE_SK_KEY`, not just `SK_KEY`

## Environment Scoping

Each constant is scoped to one environment. The same name can have different values across environments:

```bash
# Staging uses test keys
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_abc" staging
pos-cli constants set --name STRIPE_PK_KEY --value "pk_test_abc" staging

# Production uses live keys
pos-cli constants set --name STRIPE_SK_KEY --value "sk_live_xyz" production
pos-cli constants set --name STRIPE_PK_KEY --value "pk_live_xyz" production
```

There is no inheritance or fallback between environments. If a constant is not set in an environment, `context.constants.NAME` returns `nil`.

## Seeding Constants in Migrations

Use migration files to set default constants for new environments:

```liquid
{% comment %} app/migrations/20240115120000_seed_staging_constants.liquid {% endcomment %}
{% liquid
  if context.environment == 'staging'
    graphql _ = 'constants/set', name: 'STRIPE_SK_KEY', value: 'sk_test_example123'
    graphql _ = 'constants/set', name: 'API_BASE_URL', value: 'https://api-staging.example.com'
    graphql _ = 'constants/set', name: 'SMTP_HOST', value: 'smtp.mailtrap.io'
  endif
%}
```

The corresponding GraphQL file:

```graphql
# app/graphql/constants/set.graphql
mutation set_constant($name: String!, $value: String!) {
  constant_set(name: $name, value: $value) {
    name
  }
}
```

## File Structure

Constants have no file on disk. They are stored server-side per environment. The only related files are:

```
project-root/
├── .pos                              # Environment endpoints (where CLI connects)
├── app/
│   ├── graphql/
│   │   └── constants/
│   │       ├── set.graphql           # Mutation to set a constant
│   │       └── unset.graphql         # Mutation to unset a constant
│   └── migrations/
│       └── 20240115_seed_constants.liquid  # Optional migration to seed defaults
```

## See Also

- [Constants Overview](README.md) -- introduction and key concepts
- [Constants API](api.md) -- runtime access via `context.constants`
- [Constants Patterns](patterns.md) -- workflows for multi-environment setups
- [Constants Gotchas](gotchas.md) -- common errors and limits
- [Configuration Reference](../configuration/README.md) -- `.pos` and `app/config.yml`
- [CLI Reference](../cli/README.md) -- full `pos-cli` command reference
