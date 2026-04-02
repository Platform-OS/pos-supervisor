# Deployment API Reference

## Deploy Command

### Basic Deployment

Deploy application to environment:

```bash
pos-cli deploy [environment]
pos-cli deploy production
```

Deployment process:
1. Validates with platformos-check
2. Syncs all files
3. Executes pending migrations
4. Applies schema updates
5. Uploads assets to CDN

### Deployment with Options

```bash
pos-cli deploy production --force
pos-cli deploy staging --skip-tests
pos-cli deploy dev --verbose
```

## Sync Command

Synchronize changes without full deployment:

```bash
pos-cli sync [environment]
pos-cli sync dev
```

File sync only - no migrations or schema changes.

### Watch Mode

Continuous synchronization:

```bash
pos-cli sync dev --watch
pos-cli sync staging --watch --filter "app/views"
```

## Deployment Lifecycle

### Pre-Deployment Phase

Runs automatically:

```bash
platformos-check
```

Validates:
- Liquid syntax
- Tag correctness
- Partial references
- Translation keys

### Sync Phase

Files synchronized:

```
app/views/
app/api_calls/
app/lib/
config/
```

### Migration Phase

Migrations execute in order:

```bash
pos-cli migrations list staging
# Shows migration execution order
```

### Schema Application

Schema changes applied:

```yaml
# app/schema/models/user.yml
properties:
  email:
    type: string
  name:
    type: string
```

### Asset Upload

Assets pushed to CDN:

```bash
# From app/assets/
# Images, stylesheets, javascripts deployed
```

## Environment-Specific Deployment

### Development Deployment

```bash
pos-cli deploy development
# Fast, minimal checks
```

### Staging Deployment

```bash
pos-cli deploy staging
# Full validation, runnable tests
```

### Production Deployment

```bash
pos-cli deploy production
# Full validation, mandatory tests
# No --skip-tests allowed
```

## Deployment Status and Monitoring

### Check Deployment Status

```bash
pos-cli env info production
```

### View Deployment Logs

```bash
pos-cli logs production
pos-cli logs production --filter "deployment"
```

### Monitor in Progress

```bash
pos-cli logs production --follow
```

## Rollback Procedures

### View Deployment History

```bash
pos-cli migrations list production
```

### Create Compensating Changes

For data changes, create new migrations:

```bash
pos-cli migrations generate production rollback_feature
```

## Pre-Deployment Testing

### Run Tests on Staging

Required before production:

```bash
pos-cli test run staging
```

### Verify Schema Changes

Test migrations on staging first:

```bash
pos-cli migrations run staging
# Verify data integrity
pos-cli data export staging users data/verify.csv
```

## Continuous Integration Deployment

### Automated Deployment Trigger

CI/CD pipeline integration:

```bash
# On successful tests
pos-cli deploy production
```

### Deployment Validation in CI

```bash
platformos-check
pos-cli test run staging
pos-cli deploy production
```

## See Also

- [Deployment Configuration](./configuration.md)
- [Deployment Patterns](./patterns.md)
- [CLI Commands](../cli/api.md)
