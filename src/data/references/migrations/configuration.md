# Migrations Configuration

## Overview

Migrations in platformOS are Liquid templates that execute once during deployment to initialize data, seed databases, or configure constants. Located in `app/migrations/`, migrations are named with timestamp prefixes (YYYYMMDDHHMMSS_name.liquid) and auto-run on `pos-cli deploy`. State tracking (pending/done/error) prevents duplicate execution. Use migrations for one-time setup tasks, data seeding, and environment-specific initialization.

## Migration File Structure

### File Naming Convention

```
app/migrations/
├── 20240101000000_create_initial_schema.liquid
├── 20240102120000_seed_categories.liquid
├── 20240103150000_initialize_constants.liquid
└── 20240104090000_create_admin_user.liquid
```

Format: `YYYYMMDDhhmmss_description.liquid`

Timestamp ensures execution order. No two migrations can have same timestamp.

## Migration Lifecycle

### States

- **pending**: Migration file exists but hasn't run
- **done**: Migration completed successfully
- **error**: Migration failed, requires manual intervention

### Automatic Execution

Migrations run automatically during `pos-cli deploy`:

```bash
pos-cli deploy staging
# Auto-runs any pending migrations in order
```

### Manual Execution

Run specific migration:

```bash
pos-cli migrations run 20240101000000 staging
```

## Generating Migrations

### Create New Migration

```bash
pos-cli migrations generate staging my_migration_name
# Creates app/migrations/YYYYMMDDHHMMSS_my_migration_name.liquid
```

### Generated Template Structure

```liquid
<!-- app/migrations/20240110120000_my_migration.liquid -->
{% comment %}
Migration: my_migration
Description: Brief description of changes
Created: 2024-01-10
{% endcomment %}

<!-- Your migration code here -->
```

## Migration Execution Context

Migrations have access to special context:

```liquid
<!-- Detect environment -->
{% if context.environment == 'production' %}
  <!-- Production-specific migrations -->
{% endif %}

<!-- Detect first-run -->
{% if context.first_deployment %}
  <!-- Run only on first deployment -->
{% endif %}

<!-- Current timestamp -->
Executed at: {{ 'now' | date: '%Y-%m-%d %H:%M:%S' }}
```

## Rollback Handling

Migrations don't support automatic rollback. Design for idempotency:

```liquid
<!-- Check if data already exists before creating -->
{% graphql existing = 'get_data_by_id', id: '123' %}

{% unless existing.data %}
  <!-- Only create if not exists -->
  {% graphql created = 'create_data', id: '123', name: 'Initial' %}
{% endunless %}
```

## Error Handling

Migrations with errors are marked as failed:

```liquid
{% graphql result = 'create_something', name: context.params.name %}

{% if result.error %}
  <h1 class="error">Migration failed: {{ result.error }}</h1>
  {% break %}  <!-- Stop migration -->
{% endif %}
```

Manual intervention required to recover from errors.

## Configuration in .pos

### Migration Settings

```yaml
migrations:
  enabled: true
  auto_run: true
  timeout_seconds: 300
  # Migrations run for max 5 minutes
```

## Migration Best Practices

### Keep Migrations Focused

Each migration should do one thing:

```liquid
<!-- Good: Single responsibility -->
<!-- 20240101_create_categories.liquid -->
<!-- Creates product categories table -->

<!-- Good: Separate migration -->
<!-- 20240102_seed_default_categories.liquid -->
<!-- Seeds initial category data -->
```

### Make Migrations Idempotent

```liquid
<!-- Safe to run multiple times -->
{% graphql existing = 'check_if_exists', key: 'default_config' %}
{% unless existing.exists %}
  {% graphql create = 'create_config', key: 'default_config', value: 'value' %}
{% endunless %}
```

### Keep Data Safe

Never delete data in migrations without backup:

```liquid
<!-- Backup before modifying -->
{% graphql backup = 'export_data' %}
<!-- Then safe to modify -->
```

## Dependencies Between Migrations

Migrations execute in timestamp order:

```
20240101_first.liquid       (runs first)
20240102_second.liquid      (runs second, can use first's changes)
20240103_third.liquid       (runs third)
```

Ensure migrations depend only on earlier migrations.

## See Also

- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
