# Advanced Deployment Techniques

## Blue-Green Deployment Pattern

### Two Production Environments

Maintain two identical production instances:

```yaml
production_blue:
  url: https://blue.instance.platformos.com
  token: ${BLUE_TOKEN}

production_green:
  url: https://green.instance.platformos.com
  token: ${GREEN_TOKEN}
```

### Deployment Strategy

```bash
# 1. Deploy to inactive environment (green)
pos-cli deploy production_green

# 2. Run tests
pos-cli test run production_green

# 3. Switch traffic to green
# Update load balancer / DNS

# 4. Keep blue as instant rollback
```

## Canary Deployments

### Feature Flags for Gradual Rollout

```liquid
{% if context.constants.CANARY_NEW_FEATURE == 'true' %}
  {% include 'pages/new_feature_layout' %}
{% else %}
  {% include 'pages/old_feature_layout' %}
{% endif %}
```

### Deployment Steps

```bash
# 1. Deploy with feature disabled
pos-cli deploy production
pos-cli constants set production CANARY_NEW_FEATURE "false"

# 2. Enable for small percentage
pos-cli constants set production CANARY_PERCENTAGE "10"

# 3. Monitor metrics
pos-cli logs production --filter error --follow

# 4. Gradually increase
pos-cli constants set production CANARY_PERCENTAGE "50"
pos-cli constants set production CANARY_PERCENTAGE "100"
```

## Database Migration Strategies

### Zero-Downtime Migrations

```bash
# 1. Deploy backward-compatible schema changes
pos-cli deploy staging

# 2. Add new column without removing old
pos-cli migrations generate staging add_new_user_field

# 3. Deploy gradually using dual-write pattern
pos-cli deploy production

# 4. After all services updated, deploy removal
pos-cli migrations generate production remove_old_user_field
```

### Complex Schema Changes

```bash
# 1. Add new table/property
pos-cli migrations generate prod add_user_profile

# 2. Backfill data
pos-cli data import prod user_profiles data/profiles.csv

# 3. Switch code to new schema
git checkout new-schema-branch

# 4. Deploy
pos-cli deploy production
```

## Performance Optimization During Deployment

### Parallel Deployments

Deploy multiple environments concurrently:

```bash
#!/bin/bash
# Deploy in background
(pos-cli deploy staging &) && \
(pos-cli deploy production_canary &) && \
wait
```

### Incremental Asset Deployment

```bash
# Only deploy changed assets
pos-cli sync production --include "app/assets/stylesheets"
```

## Deployment Verification

### Health Check Pattern

```bash
#!/bin/bash
verify_deployment() {
  ENV=$1

  # Check logs for critical errors
  ERRORS=$(pos-cli logs $ENV --filter "critical_error" | wc -l)
  if [ $ERRORS -gt 0 ]; then
    return 1
  fi

  # Run health check endpoint
  RESPONSE=$(curl -s https://$ENV.instance.platformos.com/health)
  if [ $RESPONSE != "OK" ]; then
    return 1
  fi

  return 0
}

pos-cli deploy production
verify_deployment production
```

## Automated Deployment Pipeline

### Full CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Full Deployment Pipeline

on:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install -g @platformos/pos-cli
      - run: platformos-check

  test:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install -g @platformos/pos-cli
      - run: pos-cli test run staging
        env:
          POS_TOKEN: ${{ secrets.POS_STAGING_TOKEN }}

  deploy_staging:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install -g @platformos/pos-cli
      - run: pos-cli deploy staging
        env:
          POS_TOKEN: ${{ secrets.POS_STAGING_TOKEN }}

  deploy_production:
    needs: deploy_staging
    runs-on: ubuntu-latest
    if: success()
    steps:
      - uses: actions/checkout@v2
      - run: npm install -g @platformos/pos-cli
      - run: pos-cli deploy production
        env:
          POS_TOKEN: ${{ secrets.POS_PROD_TOKEN }}
```

## Disaster Recovery

### Backup Before Critical Deployments

```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Backup all data
pos-cli data export production users data/backup_${TIMESTAMP}_users.csv
pos-cli data export production products data/backup_${TIMESTAMP}_products.csv

# Save current state
pos-cli migrations list production > data/backup_${TIMESTAMP}_migrations.txt

# Proceed with deployment
pos-cli deploy production
```

### Rollback Procedures

```bash
#!/bin/bash
BACKUP_TIMESTAMP=$1

# Restore from backup if needed
pos-cli data clean production users
pos-cli data import production users data/backup_${BACKUP_TIMESTAMP}_users.csv

# Revert code
git checkout production/stable

# Redeploy previous version
pos-cli deploy production
```

## Monitoring and Observability

### Deployment Metrics

```bash
# Monitor deployment completion
watch -n 5 'pos-cli logs production --filter deployment'

# Check error rates post-deployment
pos-cli logs production --filter error | tail -20

# Verify performance
pos-cli logs production --filter slow_query
```

### Custom Monitoring

```liquid
<!-- Add monitoring endpoint -->
<script>
  fetch('/api/deployment-status')
    .then(r => r.json())
    .then(data => {
      if (data.errors > 0) {
        console.warn('Deployment errors detected');
      }
    });
</script>
```

## See Also

- [CLI Advanced Techniques](../cli/advanced.md)
- [Deployment Patterns](./patterns.md)
- [Testing Advanced](../testing/advanced.md)
