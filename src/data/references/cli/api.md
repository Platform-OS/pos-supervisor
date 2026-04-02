# CLI Commands Reference

## Deploy Command

Deploy your application to an environment:

```bash
pos-cli deploy [environment]
pos-cli deploy dev
pos-cli deploy production
```

Deployment flow:
1. Runs platformos-check validation
2. Syncs files
3. Executes migrations
4. Applies schema changes
5. Uploads assets to CDN

## Sync Command

Synchronize local changes without full deployment:

```bash
pos-cli sync [environment]
pos-cli sync dev
pos-cli sync --watch staging
```

Watch mode for continuous sync:

```bash
pos-cli sync dev --watch
```

## GUI Serve Command

Local development server with hot reload:

```bash
pos-cli gui serve
pos-cli gui serve --port 3000
```

Access at `http://localhost:3000`

## Logs Command

View instance logs with filtering:

```bash
pos-cli logs [environment]
pos-cli logs dev
pos-cli logs dev --filter "error"
pos-cli logs staging --filter "background_job" --follow
```

Filter options:
- `error`: Error messages only
- `background_job`: Background job logs
- `api_call`: API call logs
- Custom patterns using regex

## Liquid and GraphQL Execution

Execute Liquid templates and GraphQL queries directly:

```bash
pos-cli exec [environment] [query_type] [query]
pos-cli exec dev liquid "{{ 'Hello' }}"
pos-cli exec dev graphql "{ users { id name } }"
```

## Modules Management

### Install Module

Install modules from marketplace or custom repository:

```bash
pos-cli modules install @platform-os/blog dev
pos-cli modules install my-module staging
```

### Download Module

Download module code locally:

```bash
pos-cli modules download @platform-os/blog ./modules
```

### List Modules

View installed modules:

```bash
pos-cli modules list
pos-cli modules list dev
```

## Constants Management

### Set Constants

Configure global constants:

```bash
pos-cli constants set dev MY_API_KEY "secret123"
pos-cli constants set staging SENDGRID_TOKEN "token_xyz"
```

### List Constants

View all constants:

```bash
pos-cli constants list dev
pos-cli constants list production
```

## Migrations Management

### Generate Migration

Create new migration:

```bash
pos-cli migrations generate [environment] [migration_name]
pos-cli migrations generate dev create_users_table
```

### Run Migrations

Execute pending migrations:

```bash
pos-cli migrations run [environment]
pos-cli migrations run staging
```

### List Migrations

View migration history:

```bash
pos-cli migrations list [environment]
pos-cli migrations list production
```

## Data Management

### Export Data

Export database records:

```bash
pos-cli data export [environment] [type] [file]
pos-cli data export dev users data/users.csv
```

### Import Data

Import records:

```bash
pos-cli data import [environment] [type] [file]
pos-cli data import staging users data/users.csv
```

### Clean Data

Remove all records (use with caution):

```bash
pos-cli data clean [environment] [type]
pos-cli data clean dev users
```

## Testing Command

Run automated tests:

```bash
pos-cli test run [environment]
pos-cli test run staging
pos-cli test run dev --verbose
```

Returns contract compliance results.

## See Also

- [CLI Configuration](./configuration.md)
- [Advanced CLI Patterns](./advanced.md)
- [CLI Troubleshooting](./gotchas.md)
