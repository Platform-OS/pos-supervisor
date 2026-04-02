# CLI Configuration Reference

## Overview

The platformOS CLI (pos-cli) requires configuration through `.pos` environment files to manage deployments across different environments (development, staging, production).

## Environment Configuration (.pos File)

### File Location and Structure

Create `.pos` file in your project root to define environment credentials:

```yaml
development:
  url: https://your-dev-instance.platformos.com
  token: your-dev-token
  email: dev@example.com

staging:
  url: https://your-staging-instance.platformos.com
  token: your-staging-token
  email: staging@example.com

production:
  url: https://your-prod-instance.platformos.com
  token: your-prod-token
  email: prod@example.com
```

### Required Fields

- `url`: Instance URL (obtained from platformOS dashboard)
- `token`: API authentication token
- `email`: Associated account email

### Security Best Practices

- Never commit `.pos` file to version control
- Use environment variables for sensitive data
- Rotate tokens regularly
- Restrict token permissions to necessary scopes

## CLI Installation

Install platformOS CLI via npm:

```bash
npm install -g @platformos/pos-cli
```

Verify installation:

```bash
pos-cli --version
```

## Configuration Verification

Test your configuration:

```bash
pos-cli env list
pos-cli env current
```

## Environment Selection

Specify environment for commands:

```bash
pos-cli deploy production
pos-cli sync staging
```

Default environment is typically `development`.

## Advanced Configuration

### Custom Configuration Paths

Set custom `.pos` file location:

```bash
pos-cli deploy development --config /path/to/.pos
```

### Multiple Projects

Maintain separate `.pos` files per project:

```bash
pos-cli sync staging --config ./config/.pos
```

## Common Issues

- **Token Expired**: Regenerate in platformOS dashboard
- **Invalid URL**: Ensure HTTPS format without trailing slash
- **Credentials Not Found**: Verify `.pos` file exists and is readable

## See Also

- [CLI Commands Reference](./api.md)
- [Deployment Patterns](../deployment/patterns.md)
- [Testing Setup](../testing/configuration.md)
