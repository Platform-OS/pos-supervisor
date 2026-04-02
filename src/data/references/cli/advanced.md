# Advanced CLI Techniques

## Scripting and Automation

### Deployment Automation Script

Create reusable deployment script:

```bash
#!/bin/bash
set -e

ENV=${1:-staging}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "Starting deployment to $ENV at $TIMESTAMP"

# Run validation
platformos-check || exit 1

# Deploy
pos-cli deploy $ENV

# Run tests
echo "Testing deployment..."
pos-cli test run $ENV || exit 1

# Check for errors
echo "Checking logs for errors..."
ERRORS=$(pos-cli logs $ENV --filter "error" | wc -l)
if [ $ERRORS -gt 0 ]; then
  echo "Warning: Found error logs"
fi

echo "Deployment completed successfully"
```

Usage:

```bash
./deploy.sh production
```

### Batch Module Installation

```bash
#!/bin/bash
MODULES=("@platform-os/core" "@platform-os/blog" "my-module")
ENV=$1

for MODULE in "${MODULES[@]}"; do
  echo "Installing $MODULE..."
  pos-cli modules install $MODULE $ENV
done
```

## Advanced Logging

### Real-time Log Monitoring

```bash
pos-cli logs dev --follow --filter "error"
```

### Log Export to File

```bash
pos-cli logs staging > logs.txt 2>&1
```

### Pattern-based Filtering

```bash
pos-cli logs dev --filter "api_call.*timeout"
```

## Constants Management at Scale

### Bulk Constants from Environment

```bash
#!/bin/bash
ENV=$1

# Load from environment variables
pos-cli constants set $ENV DATABASE_URL "$DATABASE_URL"
pos-cli constants set $ENV API_KEY "$API_KEY"
pos-cli constants set $ENV WEBHOOK_SECRET "$WEBHOOK_SECRET"
```

### Constants Versioning

Track constants changes:

```bash
pos-cli constants list dev > constants_backup_$(date +%Y%m%d).txt
```

## Migration Strategies

### Complex Migrations

Create multiple migration files for clarity:

```bash
pos-cli migrations generate dev 001_create_users
pos-cli migrations generate dev 002_add_user_roles
pos-cli migrations generate dev 003_create_indices
pos-cli migrations run dev
```

### Rollback Pattern

Create compensating migrations:

```bash
# Forward migration: add_column
pos-cli migrations generate dev add_feature_flag

# Rollback migration: remove_column
pos-cli migrations generate dev remove_feature_flag
```

## Bulk Data Operations

### Data Migration Pattern

```bash
#!/bin/bash
# Export from staging
pos-cli data export staging users data/users.csv

# Transform if needed
# ... processing script ...

# Import to dev
pos-cli data import dev users data/users_processed.csv
```

### Cleanup Strategy

```bash
# Verify before cleanup
pos-cli data export dev test_records data/backup_test.csv

# Then cleanup
pos-cli data clean dev test_records
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy platformOS
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install -g @platformos/pos-cli
      - run: platformos-check
      - run: pos-cli deploy staging
        env:
          POS_TOKEN: ${{ secrets.POS_TOKEN }}
```

### GitLab CI Example

```yaml
deploy:
  image: node:16
  script:
    - npm install -g @platformos/pos-cli
    - platformos-check
    - pos-cli deploy $CI_ENVIRONMENT_NAME
  only:
    - main
```

## Performance Optimization

### Selective Sync

Sync only specific directories:

```bash
pos-cli sync dev --watch --include "app/views"
```

### Parallel Operations

Use multiple terminal sessions:

```bash
# Terminal 1: Watch and sync
pos-cli sync dev --watch

# Terminal 2: Monitor logs
pos-cli logs dev --follow

# Terminal 3: Local development
pos-cli gui serve
```

## Debugging Techniques

### Verbose Output

Enable detailed logging:

```bash
pos-cli deploy dev --verbose
pos-cli test run staging --verbose
```

### Dry Run Deployments

Preview changes without applying:

```bash
pos-cli deploy dev --dry-run
```

### Environment Inspection

View current environment:

```bash
pos-cli env current
pos-cli env info dev
```

## See Also

- [CLI Commands Reference](./api.md)
- [CLI Patterns](./patterns.md)
- [Deployment Advanced Patterns](../deployment/advanced.md)
