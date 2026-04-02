# Deployment Gotchas and Troubleshooting

## Never Sync to Production

### Critical Rule

Never synchronize directly to production:

```bash
# WRONG - Never do this!
pos-cli sync production
pos-cli sync production --watch
```

### Why This Is Dangerous

- No validation occurs with sync
- No platformos-check
- Changes applied immediately
- No rollback point
- Breaks production for users

### Correct Approach

Always use deploy for production:

```bash
# CORRECT
platformos-check
pos-cli deploy production
```

Deployment includes:
1. Full validation
2. Staging tests
3. Atomic changes
4. Audit trail

## Deployment Validation Failures

### platformos-check Failure

**Issue**: Deployment blocked by validation errors

**Solution**:
```bash
platformos-check
# Fix reported issues
pos-cli deploy staging
```

### Common Validation Errors

**Syntax Error**:
```liquid
# WRONG
{% if user %}{{ user.name }}

# CORRECT
{% if user %}
  {{ user.name }}
{% endif %}
```

**Missing Partial**:
```bash
# Error: Partial 'header' not found
# Solution: Create file at:
# app/views/partials/header.html.liquid
```

**Translation Missing**:
```yaml
# Add to config/translations.yml
en:
  errors:
    not_found: "Page not found"
```

## Migration Issues

### Failed Migration

**Issue**: Migration fails during deployment

**Problem**: Database inconsistency

**Solution**:
1. Investigate error: `pos-cli logs staging --filter migration`
2. Fix migration file
3. Create compensating migration
4. Rerun deployment

### Migration Conflicts

**Issue**: "Cannot run migration, previous migration incomplete"

**Solution**:
```bash
# Check migration status
pos-cli migrations list staging

# If stuck, may need manual intervention
# Contact platformOS support if persistent
```

### Data Type Mismatch

**Issue**: Migration applies, but queries fail

**Solution**:
```graphql
# Verify schema after migration
{
  users {
    id
    email
  }
}
```

## File Sync Issues

### Changes Not Syncing

**Issue**: `pos-cli sync` shows no changes

**Causes**:
- Correct files not in `app/` directory
- Files ignored by platformOS
- Syntax errors preventing sync
- Network connectivity

**Solutions**:
```bash
# Verify file structure
ls -la app/views/

# Explicit sync with verbose output
pos-cli sync dev --verbose

# Clear cache if persistent
pos-cli env clear-cache
```

### Partial Sync Failures

**Issue**: Some files sync, others fail

**Solution**:
```bash
# Deploy all at once instead
pos-cli deploy staging

# Or debug individual files
pos-cli sync dev --verbose --include "app/views/pages"
```

## Asset Deployment

### Assets Not Appearing on CDN

**Issue**: Static files missing after deployment

**Causes**:
- Files not in `app/assets/`
- CDN not configured
- Asset references using wrong paths

**Solution**:
```bash
# Verify asset structure
ls -la app/assets/

# Check asset references
grep -r "asset_path" app/views/

# Redeploy assets
pos-cli deploy staging
```

### Asset Cache Issues

**Issue**: Old assets served from CDN cache

**Solution**:
- Purge CDN cache in platformOS dashboard
- Use versioned asset filenames: `app-v2.js`
- Clear browser cache (Ctrl+Shift+Delete)

## Schema Application Failures

### Schema Not Applying

**Issue**: New model properties not available

**Causes**:
- Schema syntax error
- Conflicting property definitions
- Missing required fields

**Solution**:
```yaml
# Verify schema syntax
# app/schema/models/user.yml
properties:
  email:
    type: string
    required: true
  name:
    type: string
```

## Test Failures During Deployment

### Tests Fail on Staging

**Issue**: `pos-cli test run staging` fails

**Impact**: Production deployment blocked

**Solution**:
```bash
# Run tests locally first
pos-cli test run dev

# Check test file syntax
cat app/lib/test/user_test.liquid

# Fix failing tests before deploy
# Rerun tests
pos-cli test run staging
```

## Deployment Rollback

### Cannot Rollback Automatically

**Issue**: No automatic rollback mechanism

**Mitigation**:
1. Always test on staging first
2. Create backup migrations
3. Version schema changes
4. Keep previous code branch ready

### Manual Rollback

```bash
# Checkout previous code version
git checkout HEAD~1

# Redeploy previous version
pos-cli deploy production

# Create compensating migrations if needed
```

## Environment Configuration Errors

### Wrong Credentials

**Issue**: Deployment fails with "Invalid token"

**Solution**:
- Verify `.pos` file: `cat .pos | head -5`
- Check token in dashboard
- Regenerate if expired
- Use environment variables: `export POS_TOKEN=`

### Mismatched Environment

**Issue**: Deploying to wrong environment

**Prevention**:
```bash
# Always verify environment
pos-cli env current

# Use explicit environment
pos-cli deploy production  # Not "pos-cli deploy"
```

## See Also

- [CLI Gotchas](../cli/gotchas.md)
- [Testing Troubleshooting](../testing/gotchas.md)
- [Deployment Patterns](./patterns.md)
