# Migrations Gotchas

## Duplicate Timestamp Collisions

### Two Migrations Same Timestamp

```bash
# WRONG: Same timestamp creates conflict
app/migrations/20240101120000_migration1.liquid
app/migrations/20240101120000_migration2.liquid

# RIGHT: Different timestamps ensure order
app/migrations/20240101120000_migration1.liquid
app/migrations/20240101120001_migration2.liquid
```

System executes only one migration per timestamp.

## Non-Idempotent Migrations

### Migration Fails on Second Run

```liquid
<!-- WRONG: Creates data without checking -->
{% graphql create = 'create_product', name: 'Test' %}
<!-- If migration reruns, creates duplicate -->

<!-- RIGHT: Check before creating -->
{% graphql existing = 'get_product_by_name', name: 'Test' %}
{% unless existing.product %}
  {% graphql create = 'create_product', name: 'Test' %}
{% endunless %}
```

Always make migrations safe to run multiple times.

## Migration Order Dependencies

### Later Migration Uses Earlier Migration's Data

```bash
# WRONG: Order not guaranteed by name
20240102_seed_data.liquid        (depends on schema)
20240101_create_schema.liquid    (not run first!)

# RIGHT: Timestamps ensure order
20240101_create_schema.liquid    (runs first)
20240102_seed_data.liquid        (runs second)
```

Timestamps control execution order. Use ascending timestamps.

## Accessing Configuration in Migrations

### context.config Not Available in Migrations

```liquid
<!-- WRONG: Config not accessible during migration -->
{% assign setting = context.config.features.enable_thing %}

<!-- RIGHT: Use constants or hardcode -->
{% assign setting = true %}

<!-- Or use GraphQL to fetch configuration -->
{% graphql config = 'get_configuration', key: 'feature_flag' %}
```

Configuration is loaded after migrations run.

## Long-Running Migrations

### Migration Timeout (5 minutes)

```liquid
<!-- WRONG: Very large data processing -->
{% graphql all = 'get_all_records' %}  <!-- Millions of records -->
{% for item in all.records %}
  {% graphql update = 'update_record', id: item.id %}
  <!-- Timeout after 300 seconds -->
{% endfor %}

<!-- RIGHT: Break into multiple migrations -->
<!-- Migration 1: Process records 0-10000 -->
<!-- Migration 2: Process records 10000-20000 -->
```

Split large operations into multiple migrations.

## Transaction Rollback Not Supported

### Migration Partially Completes Then Fails

```liquid
<!-- WRONG: Assumes atomic transactions -->
{% graphql step1 = 'operation_1' %}
{% graphql step2 = 'operation_2' %}  <!-- Fails -->
<!-- step1 already committed, can't rollback -->

<!-- RIGHT: Make operations independent -->
{% graphql step1 = 'operation_1' %}
{% unless step1.error %}
  {% graphql step2 = 'operation_2' %}
{% endunless %}
```

No automatic rollback on error. Design fail-safe.

## Accessing Request Context in Migrations

### params and context Variables Different

```liquid
<!-- WRONG: params not available in migrations -->
{{ params.user_id }}  <!-- Returns nil -->

<!-- RIGHT: Use context or constants -->
{{ context.environment }}
{{ context.first_deployment }}
```

Migrations have limited context. No params or request data.

## Production Data Loss in Migrations

### Accidentally Deleting Production Data

```liquid
<!-- WRONG: Delete without backup in production -->
{% graphql delete = 'delete_all_orders' %}

<!-- RIGHT: Check environment and backup first -->
{% if context.environment == 'production' %}
  DANGEROUS OPERATION SKIPPED
  {% break %}
{% endif %}

<!-- Backup before destructive operation -->
{% graphql backup = 'backup_database' %}
{% graphql delete = 'delete_old_data', before_date: '2020-01-01' %}
```

Never run destructive operations without environment checks.

## Silent Migration Failures

### Migration Error Not Reported

```liquid
<!-- WRONG: Error silently ignored -->
{% graphql result = 'some_operation' %}
<!-- If result has error, migration continues silently -->

<!-- RIGHT: Check and report errors -->
{% graphql result = 'some_operation' %}
{% if result.error %}
  MIGRATION ERROR: {{ result.error }}
  {% break %}  <!-- Stop migration -->
{% endif %}
```

Check error responses explicitly. Use `{% break %}` to stop.

## Migrations with External API Calls

### External Service Timeout or Failure

```liquid
<!-- WRONG: Assumes external service always available -->
{% graphql result = 'call_external_api' %}
<!-- Migration fails if API unreachable -->

<!-- RIGHT: Handle failures gracefully -->
{% graphql result = 'call_external_api' %}
{% if result.error %}
  {% graphql result = 'retry_with_exponential_backoff' %}
  {% if result.error %}
    Skipping external API call - will retry on next deployment
  {% endif %}
{% endif %}
```

Design migrations resilient to external failures.

## Circular Dependencies Between Migrations

### Migration A Needs Migration B, B Needs A

```bash
# WRONG: Circular dependency
20240101_setup_feature_a.liquid  (needs feature_b data)
20240102_setup_feature_b.liquid  (needs feature_a data)

# RIGHT: Merge into single migration or reorder
20240101_setup_feature_a.liquid
20240102_setup_feature_b.liquid  (doesn't depend on feature_a)
```

Plan migration dependencies carefully. Avoid circular logic.

## Migration Size and Complexity

### Mega-Migration Doing Too Much

```liquid
<!-- WRONG: One migration with thousands of operations -->
<!-- 20240101_everything.liquid -->
<!-- Too large, hard to debug, slow -->

<!-- RIGHT: Split into focused migrations -->
<!-- 20240101_schema.liquid -->
<!-- 20240102_seed_categories.liquid -->
<!-- 20240103_seed_products.liquid -->
<!-- 20240104_create_indexes.liquid -->
```

Keep migrations focused and testable. One concern per migration.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
