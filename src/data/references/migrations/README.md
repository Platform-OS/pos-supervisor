# Migrations

Migrations execute code outside the regular application cycle — useful for seeding data, initializing constants, and database modifications.

## Location

`app/migrations/`

## File Naming

Files use UTC timestamp prefix for chronological execution:

```
app/migrations/
├── 20240115120000_seed_initial_data.liquid
├── 20240116093000_add_default_categories.liquid
└── 20240120150000_init_staging_constants.liquid
```

## Creating a Migration

```bash
pos-cli migrations generate dev init_staging_constants
# Creates: app/migrations/YYYYMMDDHHMMSS_init_staging_constants.liquid
```

## Example: Initialize Constants

```liquid
{% comment %} app/migrations/20240115120000_init_staging_constants.liquid {% endcomment %}
{% liquid
  if context.environment == 'staging'
    graphql _ = 'constants/set', name: 'STRIPE_SK_KEY', value: 'sk_test_example123'
    graphql _ = 'constants/set', name: 'API_BASE_URL', value: 'https://api-staging.example.com'
  endif
%}
```

## Example: Seed Data

```liquid
{% comment %} app/migrations/20240116093000_seed_categories.liquid {% endcomment %}
{% assign categories = ["Electronics", "Clothing", "Books", "Home & Garden"] %}

{% for category in categories %}
  {% graphql _ = 'categories/create', name: category %}
{% endfor %}
```

## Running Migrations

### Automatic
Pending migrations run on `pos-cli deploy`.

### Manual
```bash
pos-cli migrations run TIMESTAMP dev
# Example: pos-cli migrations run 20240115120000 dev
```

## Migration States

| State | Description |
|-------|-------------|
| `pending` | Not yet executed (runs on next deploy) |
| `done` | Successfully completed (won't run again) |
| `error` | Failed (can edit and retry) |

## Rules

- Use timestamp prefix for ordering
- Check `context.environment` to scope per-environment logic
- For large data imports, use Data Import/Export instead
- Migrations run once and are tracked by the platform
