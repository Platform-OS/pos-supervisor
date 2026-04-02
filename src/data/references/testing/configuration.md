# Testing Configuration Reference

## Test Setup

platformOS uses `pos-module-tests` for automated testing framework.

## Test File Location and Structure

### Test Directory

Create tests in `app/lib/test/` directory:

```
app/lib/test/
├── user_test.liquid
├── product_test.liquid
├── helper_test.liquid
└── api_test.liquid
```

### Test File Naming

Follow naming convention: `*_test.liquid`

```bash
# Valid test files
user_test.liquid
api_calls_test.liquid
helpers_test.liquid
custom_logic_test.liquid
```

### Test File Structure

```liquid
---
# Front matter (optional)
---

<!-- Test case 1 -->
{% test 'user validation' %}
  {% assign user = 'John' %}
  {% assert user != blank %}
{% endtest %}

<!-- Test case 2 -->
{% test 'email format' %}
  {% assign email = 'test@example.com' %}
  {% assert email contains '@' %}
{% endtest %}
```

## Assertions Available

### valid_object

Check if object exists and is valid:

```liquid
{% assert context.current_user valid_object %}
```

### equal

Compare for equality:

```liquid
{% assert user.name == 'John' %}
```

### not_equal

Check inequality:

```liquid
{% assert user.status != 'inactive' %}
```

### truthy

Check truthy values:

```liquid
{% assert user.is_active %}
```

### falsy

Check falsy values:

```liquid
{% assert user.deleted_at == blank %}
```

### contains

Check string containment:

```liquid
{% assert email contains '@' %}
```

## Test Execution Methods

### Browser Testing

Run tests in browser at test endpoint:

```
http://localhost:3000/_tests/run
```

Tests execute and display results interactively.

### CLI Testing

Run tests via command line:

```bash
pos-cli test run staging
pos-cli test run dev --verbose
```

## Test Environments

### Supported Environments

Tests can only run on:
- Development (`dev`)
- Staging (`staging`)

### Why Not Production

- Tests are for validation only
- Production should never run tests
- Testing requires test data isolation

## Test Output and Results

### Contract Compliance

Tests return contract compliance results:

```json
{
  "passed": 45,
  "failed": 2,
  "skipped": 0,
  "coverage": 92
}
```

### Test Report Structure

- Test name
- Assertion details
- Pass/fail status
- Execution time

### Verbose Output

Get detailed information:

```bash
pos-cli test run staging --verbose
```

Shows:
- Each assertion result
- Stack traces on failure
- Performance metrics
- Coverage information

## Test Configuration File

### pos-test.yml (Optional)

Configure test behavior:

```yaml
test:
  environment: staging
  timeout: 30000
  verbose: true
  include_patterns:
    - '**/*_test.liquid'
  exclude_patterns:
    - '**/skip_*'
```

## Assertions in Detail

### Basic Pattern

```liquid
{% test 'test description' %}
  {% assign value = 'result' %}
  {% assert value == 'expected' %}
{% endtest %}
```

### Multiple Assertions

```liquid
{% test 'complex validation' %}
  {% assign user = context.current_user %}
  {% assert user valid_object %}
  {% assert user.email contains '@' %}
  {% assert user.status != blank %}
{% endtest %}
```

## Test Isolation

### Data Cleanup

Tests should be isolated:

```liquid
{% test 'create user' %}
  <!-- Create test user -->
  {% assign user = 'test_user' %}
  <!-- Cleanup after test -->
  {% assign user = blank %}
{% endtest %}
```

### Environment Variables

Use test-specific constants:

```liquid
{% assign test_api_key = context.constants.TEST_API_KEY %}
```

## See Also

- [Testing API Reference](./api.md)
- [Testing Patterns](./patterns.md)
- [Testing Gotchas](./gotchas.md)
