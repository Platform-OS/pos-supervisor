# Migrations Advanced Techniques

## Migration Validation Framework

Validate migration success:

```liquid
<!-- app/migrations/20240111000000_validate_data.liquid -->
{% comment %}
Migration: Validate Data Integrity
Checks that all migrations completed successfully
{% endcomment %}

{% graphql products = 'count_products' %}
{% if products.count == 0 %}
  WARNING: No products found
{% endif %}

{% graphql categories = 'count_categories' %}
{% if categories.count == 0 %}
  ERROR: No categories found - schema incomplete
  {% break %}
{% endif %}

Data validation complete: {{ products.count }} products, {{ categories.count }} categories
```

## Blue-Green Migration Pattern

Safe migration with instant rollback:

```liquid
<!-- Create "new" version of data -->
{% graphql new_schema = 'create_schema_v2' %}

<!-- Copy and transform data -->
{% graphql all = 'get_all_data_v1' %}
{% for item in all.items %}
  {% graphql copy = 'migrate_to_v2', data: item %}
{% endfor %}

<!-- After validation, switch names -->
{% graphql switch = 'swap_schema_v1_v2' %}

<!-- Old schema still exists for rollback if needed -->
```

## Migration State Machine

Track complex multi-step migrations:

```liquid
<!-- app/migrations/20240112000000_complex_migration.liquid -->
{% assign state_key = 'migration_20240112_state' %}
{% graphql state = 'get_state', key: state_key %}

{% case state.value %}
  {% when 'initial' %}
    Step 1: Create new tables
    {% graphql create = 'create_tables' %}
    {% graphql save = 'set_state', key: state_key, value: 'tables_created' %}

  {% when 'tables_created' %}
    Step 2: Copy existing data
    {% graphql copy = 'copy_data' %}
    {% graphql save = 'set_state', key: state_key, value: 'data_copied' %}

  {% when 'data_copied' %}
    Step 3: Validate data
    {% graphql validate = 'validate_data' %}
    {% graphql save = 'set_state', key: state_key, value: 'complete' %}

  {% when 'complete' %}
    Migration already complete
{% endcase %}
```

## Incremental Migration Pattern

Migrate large datasets incrementally:

```liquid
<!-- app/migrations/20240113000000_migrate_large_dataset.liquid -->
{% assign batch_size = 1000 %}
{% assign offset = 0 %}
{% assign total = 0 %}

{% loop %}
  {% graphql batch = 'get_records', offset: offset, limit: batch_size %}

  {% if batch.records.size == 0 %}
    {% break %}
  {% endif %}

  {% for record in batch.records %}
    {% graphql migrate = 'migrate_record', id: record.id %}
    {% assign total = total | plus: 1 %}
  {% endfor %}

  {% assign offset = offset | plus: batch_size %}
{% endloop %}

Migrated {{ total }} records in batches
```

## Conditional Environment Migrations

Different setup per environment:

```liquid
<!-- app/migrations/20240114000000_environment_config.liquid -->
{% if context.environment == 'production' %}
  {% graphql enable = 'enable_audit_logging' %}
  {% graphql enable = 'enable_backups' %}
  {% graphql enable = 'enable_ssl' %}

{% elsif context.environment == 'staging' %}
  {% graphql enable = 'enable_test_mode' %}
  {% graphql enable = 'enable_debug_logging' %}

{% else %}
  {% graphql enable = 'enable_development_mode' %}
  {% graphql enable = 'enable_mock_services' %}
{% endif %}

Configured for {{ context.environment }}
```

## Scheduled Future Migrations

Mark migration for future execution:

```liquid
<!-- app/migrations/20240115000000_scheduled_future.liquid -->
{% assign scheduled_date = '2024-02-01' %}
{% assign current_date = 'now' | date: '%Y-%m-%d' %}

{% if current_date >= scheduled_date %}
  {% graphql execute = 'run_deferred_operation' %}
{% else %}
  Scheduled for {{ scheduled_date }}, skipping for now
{% endif %}
```

## Migration Dry Run Pattern

Test migrations without permanent changes:

```liquid
<!-- app/migrations/20240116000000_test_migration.liquid -->
{% if context.params.dry_run %}
  <!-- Simulate without committing -->
  {% graphql test = 'dry_run_operation' %}
  Dry run results: {{ test.changes }}
{% else %}
  <!-- Actually execute -->
  {% graphql execute = 'real_operation' %}
  Executed successfully
{% endif %}
```

## Migration Dependencies Tracking

Track and verify dependencies:

```liquid
<!-- app/migrations/20240117000000_with_dependencies.liquid -->
{% comment %}
Depends on:
- 20240101_schema_creation
- 20240102_initial_seed

Provides:
- User account creation
{% endcomment %}

{% graphql schema_check = 'verify_migration_done', migration: '20240101_schema_creation' %}
{% unless schema_check.done %}
  FATAL: Schema creation migration not completed
  {% break %}
{% endunless %}

<!-- Safe to proceed -->
```

## Database Integrity Checks

Verify database health during migrations:

```liquid
<!-- app/migrations/20240118000000_integrity_check.liquid -->
{% graphql integrity = 'check_database_integrity' %}

{% if integrity.errors.size > 0 %}
  Database integrity issues found:
  {% for error in integrity.errors %}
    - {{ error }}
  {% endfor %}
  {% break %}
{% endif %}

Database integrity: OK
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Gotchas & Issues](./gotchas.md)
