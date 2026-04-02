# Deployment Patterns

## Full Deployment Workflow

### Development to Production Pipeline

```bash
# 1. Develop and test locally
pos-cli gui serve
pos-cli sync dev --watch

# 2. Run validation
platformos-check

# 3. Deploy to staging
pos-cli deploy staging

# 4. Test on staging
pos-cli test run staging

# 5. Review staging logs
pos-cli logs staging --filter error

# 6. Deploy to production
pos-cli deploy production

# 7. Monitor production
pos-cli logs production --follow
```

## Pre-Deployment Pattern

### Validation Checklist

```bash
#!/bin/bash
set -e

echo "Running pre-deployment checks..."

# 1. Lint and syntax check
platformos-check
echo "✓ platformos-check passed"

# 2. Run tests
pos-cli test run staging
echo "✓ Tests passed"

# 3. Verify environment
pos-cli env info production
echo "✓ Environment verified"

# 4. Check for errors in logs
ERROR_COUNT=$(pos-cli logs production --filter error | wc -l)
if [ $ERROR_COUNT -gt 0 ]; then
  echo "⚠ Warning: $ERROR_COUNT errors in production logs"
fi

echo "Ready for deployment"
```

## Staging Validation Pattern

### Pre-Production Testing

Deploy and test on staging before production:

```bash
# Deploy to staging
pos-cli deploy staging

# Run comprehensive tests
pos-cli test run staging

# Verify data integrity
pos-cli data export staging users data/test_export.csv

# Monitor for 24-48 hours
pos-cli logs staging --follow

# Check error rates
pos-cli logs staging --filter error --follow
```

## CI/CD Deployment Pattern

### GitHub Actions Workflow

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install CLI
        run: npm install -g @platformos/pos-cli

      - name: Validate
        run: platformos-check

      - name: Deploy to Staging
        run: pos-cli deploy staging
        env:
          POS_STAGING_TOKEN: ${{ secrets.POS_STAGING_TOKEN }}

      - name: Run Tests
        run: pos-cli test run staging
        env:
          POS_STAGING_TOKEN: ${{ secrets.POS_STAGING_TOKEN }}

      - name: Deploy to Production
        run: pos-cli deploy production
        if: success()
        env:
          POS_PROD_TOKEN: ${{ secrets.POS_PROD_TOKEN }}
```

## Migration Management Pattern

### Coordinated Schema Changes

```bash
# 1. Create migrations for schema changes
pos-cli migrations generate staging add_user_columns
# Edit migration file

# 2. Run migrations in staging
pos-cli deploy staging

# 3. Verify data integrity
pos-cli data export staging users data/verify.csv

# 4. Deploy same migrations to production
pos-cli deploy production
```

## Asset Deployment Pattern

### CDN Asset Management

```bash
# Assets in app/assets/ are automatically deployed
# During pos-cli deploy

# Structure:
app/assets/
├── images/logo.png
├── stylesheets/main.css
└── javascripts/app.js

# Reference in templates:
# CDN URL set during deployment
```

## Multi-Environment Deployment

### Environment Promotion

```bash
# .pos file with multiple environments
development:
  url: https://dev.platformos.com
  token: ${DEV_TOKEN}

staging:
  url: https://staging.platformos.com
  token: ${STAGING_TOKEN}

production:
  url: https://prod.platformos.com
  token: ${PROD_TOKEN}

# Deployment sequence
pos-cli deploy dev          # Test environment
pos-cli deploy staging      # QA environment
pos-cli deploy production   # Live environment
```

## Backup and Recovery Pattern

### Pre-Deployment Backup

```bash
#!/bin/bash
ENV=$1

echo "Backing up $ENV before deployment..."

# Export all data types
pos-cli data export $ENV users data/backup_$(date +%s)_users.csv
pos-cli data export $ENV products data/backup_$(date +%s)_products.csv

# Save migrations state
pos-cli migrations list $ENV > data/backup_migrations_$(date +%s).txt

echo "Backup completed"
```

## Incremental Deployment Pattern

### Gradual Feature Rollout

Use feature flags to control deployment:

```liquid
{% if context.constants.FEATURE_NEW_UI == 'true' %}
  {% include 'pages/new_ui_layout' %}
{% else %}
  {% include 'pages/old_ui_layout' %}
{% endif %}
```

Deploy with feature disabled, then enable via constants:

```bash
pos-cli constants set production FEATURE_NEW_UI "true"
```

## See Also

- [Deployment Configuration](./configuration.md)
- [Deployment API](./api.md)
- [CLI Patterns](../cli/patterns.md)
