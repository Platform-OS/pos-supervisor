# pos-cli & platformos-check

Command-line tools for platformOS development.

## pos-cli Commands

### Deployment
```bash
pos-cli deploy dev                          # Deploy to environment
pos-cli deploy production                   # Deploy to production
```

### Development
```bash
pos-cli sync dev                            # Watch and sync file changes
pos-cli gui serve dev                       # Start GraphQL GUI explorer
```

### Debugging
```bash
pos-cli logs dev                            # Watch real-time logs
pos-cli logs dev --filter type:error        # Filter error logs
pos-cli exec liquid dev '<code>'            # Execute Liquid snippet
pos-cli exec graphql dev '<query>'          # Execute GraphQL query
```

### Modules
```bash
pos-cli modules install <name>              # Install a module
pos-cli modules download <name>             # Download module source
pos-cli modules list dev                    # List installed modules
```

### Constants
```bash
pos-cli constants set --name KEY --value "val" dev    # Set constant
pos-cli constants list dev                             # List constants
```

### Migrations
```bash
pos-cli migrations generate dev <name>      # Create migration file
pos-cli migrations run TIMESTAMP dev        # Run specific migration
pos-cli migrations list dev                 # List migration states
```

### Data
```bash
pos-cli data export dev --path=data.json    # Export data
pos-cli data import dev --path=data.json    # Import data
pos-cli data clean dev                      # Clean all data (DANGEROUS)
```

### Testing
```bash
pos-cli test run staging                    # Run all tests
```

## platformos-check (Linter)

**Must run after EVERY file change.**

```bash
platformos-check                            # Lint all files
platformos-check app/views/pages/           # Lint specific directory
```

### What it checks

- Liquid syntax errors
- Invalid tag/filter usage
- Missing translations
- Broken partial references
- Incorrect file naming
- Deprecated patterns

### Must pass with 0 errors before deployment.

## Environment Configuration

### .pos file
```yaml
dev:
  url: https://your-instance.staging.oregon.platform-os.com
production:
  url: https://your-instance.platform-os.com
```

## Debugging Workflow

```bash
# Terminal 1: Watch logs
pos-cli logs dev

# Terminal 2: Make changes and observe
pos-cli sync dev

# Terminal 3: Test endpoints
curl -i https://your-instance.staging.oregon.platform-os.com/endpoint
```

Check logs when you get 5xx responses.
