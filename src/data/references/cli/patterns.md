# CLI Usage Patterns

## Development Workflow

### Local Development Setup

1. Configure development environment in `.pos` file
2. Start GUI server for hot reload:

```bash
pos-cli gui serve
```

3. In another terminal, watch file synchronization:

```bash
pos-cli sync dev --watch
```

4. View real-time logs:

```bash
pos-cli logs dev --follow
```

## Pre-Deployment Validation

### Linting and Checks

Always run platformos-check before deployment:

```bash
platformos-check
```

Checks performed:
- Liquid syntax validation
- Tag usage correctness
- Translation file completeness
- Partial naming conventions
- Asset references

### Staging Tests

Execute tests on staging:

```bash
pos-cli test run staging
pos-cli logs staging --filter error
```

## Environment Promotion Pipeline

### Dev → Staging → Production

1. Deploy to development and test:

```bash
pos-cli deploy dev
pos-cli test run dev
```

2. Deploy to staging for QA:

```bash
pos-cli deploy staging
pos-cli test run staging
```

3. Deploy to production:

```bash
pos-cli deploy production
```

## Module Management Pattern

### Installing Dependencies

```bash
pos-cli modules install @platform-os/core dev
pos-cli modules install @platform-os/blog dev
pos-cli modules install my-custom-module dev
```

### Updating Modules

Check current versions:

```bash
pos-cli modules list dev
```

## Secrets and Configuration Pattern

### Managing API Keys

Store all secrets as constants:

```bash
pos-cli constants set dev API_KEY "key_xyz"
pos-cli constants set staging WEBHOOK_SECRET "secret_abc"
```

Reference in code:

```liquid
{% assign api_key = context.constants.API_KEY %}
```

## Migration Workflow

### Creating and Running Migrations

```bash
pos-cli migrations generate dev add_user_status
# Edit generated migration file
pos-cli migrations run dev
pos-cli migrations list dev
```

## Data Operations Pattern

### Backup Before Operations

```bash
pos-cli data export dev users data/backup_users.csv
```

### Bulk Operations

```bash
pos-cli data import staging users data/import_users.csv
```

### Data Cleanup

```bash
pos-cli data clean staging test_records
```

## Batch Command Execution

### Shell Scripts for Deployments

```bash
#!/bin/bash
ENV=$1
pos-cli platformos-check
pos-cli deploy $ENV
pos-cli test run $ENV
pos-cli logs $ENV --filter error
```

## See Also

- [CLI Commands](./api.md)
- [Advanced Patterns](./advanced.md)
- [Deployment Patterns](../deployment/patterns.md)
