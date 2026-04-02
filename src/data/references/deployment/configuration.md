# Deployment Configuration Reference

## Environment Setup

Configure deployment environments via `.pos` file in project root:

```yaml
development:
  url: https://dev.platformos.com
  token: dev_token_xyz
  email: dev@company.com

staging:
  url: https://staging.platformos.com
  token: staging_token_abc
  email: staging@company.com

production:
  url: https://prod.platformos.com
  token: prod_token_123
  email: prod@company.com
```

## Deployment Infrastructure

### File Structure Requirements

```
app/
├── views/
│   ├── pages/
│   ├── partials/
│   └── layouts/
├── api_calls/
├── migrations/
├── assets/
│   ├── stylesheets/
│   └── javascripts/
└── lib/
    └── test/
```

### .pos File Security

**Never commit `.pos` file:**

```bash
# .gitignore
.pos
*.env
secrets/
```

Use environment variables instead:

```bash
export POS_DEV_TOKEN="token_xyz"
export POS_STAGING_TOKEN="token_abc"
```

## Pre-Deployment Checklist

### Configuration Items

1. **Environment Variables** - All constants set in `pos-cli constants set`
2. **Migration Status** - Latest migrations included
3. **Asset References** - CDN paths configured
4. **Secrets** - Stored as constants, never hardcoded
5. **Validation** - `platformos-check` passes

### Required Files

- `app/views/pages/` - At least home page
- `config/translations.yml` - Translation keys defined
- `app/migrations/` - Migration files up to date
- `.pos` - Environment configuration (gitignored)

## Deployment Profiles

### Development Profile

```yaml
development:
  url: https://dev.instance.platformos.com
  token: ${POS_DEV_TOKEN}
  email: dev@example.com
  features:
    skip_tests: true
    enable_debug: true
```

### Staging Profile

```yaml
staging:
  url: https://staging.instance.platformos.com
  token: ${POS_STAGING_TOKEN}
  email: staging@example.com
  features:
    skip_tests: false
    enable_debug: false
```

### Production Profile

```yaml
production:
  url: https://instance.platformos.com
  token: ${POS_PROD_TOKEN}
  email: prod@example.com
  features:
    skip_tests: false
    enable_debug: false
    backup_before_deploy: true
```

## Asset Configuration

### CDN Setup

Configure asset delivery in deployment:

```liquid
{% assign cdn_url = "https://cdn.example.com" %}
<script src="{{ cdn_url }}/js/app.js"></script>
<link rel="stylesheet" href="{{ cdn_url }}/css/style.css">
```

### Asset Paths

Assets located at:

```
app/assets/
├── images/
├── stylesheets/
├── javascripts/
└── downloads/
```

Deployed to CDN automatically during deployment.

## Migration Configuration

### Migration Directory

```
app/migrations/
├── 001_create_tables.graphql
├── 002_add_columns.graphql
└── 003_create_indices.graphql
```

### Running Migrations

Migrations execute automatically during deployment:

```bash
pos-cli deploy staging
# Migrations run as part of deployment
```

## Schema Configuration

### Schema Files

```
app/schema/
├── types/
│   └── custom_type.yml
├── models/
│   └── user.yml
└── relations/
```

Schema applied during deployment.

## See Also

- [CLI Configuration](../cli/configuration.md)
- [Deployment Patterns](./patterns.md)
- [Deployment Gotchas](./gotchas.md)
