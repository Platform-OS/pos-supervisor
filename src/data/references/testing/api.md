# Testing API Reference

## Test Execution

### Browser-Based Testing

Run tests through web interface:

```
GET http://localhost:3000/_tests/run
```

Returns HTML with test results:
- Visual test status
- Pass/fail indicators
- Assertion details
- Execution time

### CLI Test Execution

Run tests from command line:

```bash
pos-cli test run [environment]
pos-cli test run staging
pos-cli test run dev
```

### Verbose Testing

Enable detailed output:

```bash
pos-cli test run staging --verbose
pos-cli test run dev --verbose --filter "user"
```

## Test Framework Syntax

### Test Block

Define a test:

```liquid
{% test 'test name' %}
  <!-- test code here -->
{% endtest %}
```

### Assertions

#### valid_object

Verify object existence:

```liquid
{% test 'user exists' %}
  {% assign user = context.current_user %}
  {% assert user valid_object %}
{% endtest %}
```

#### equal

Compare values for equality:

```liquid
{% test 'name matches' %}
  {% assign name = 'John' %}
  {% assert name == 'John' %}
{% endtest %}
```

#### not_equal

Verify inequality:

```liquid
{% test 'status changed' %}
  {% assign status = 'active' %}
  {% assert status != 'inactive' %}
{% endtest %}
```

#### truthy

Check truthy condition:

```liquid
{% test 'user active' %}
  {% assign is_active = true %}
  {% assert is_active %}
{% endtest %}
```

#### falsy

Check falsy condition:

```liquid
{% test 'no errors' %}
  {% assign errors = blank %}
  {% assert errors == blank %}
{% endtest %}
```

#### contains

Check string containment:

```liquid
{% test 'email valid' %}
  {% assign email = 'test@example.com' %}
  {% assert email contains '@' %}
{% endtest %}
```

## Test Organization

### Multiple Tests in File

```liquid
{% test 'validation 1' %}
  {% assert 1 == 1 %}
{% endtest %}

{% test 'validation 2' %}
  {% assert 'test' == 'test' %}
{% endtest %}

{% test 'validation 3' %}
  {% assign value = 'result'%}
  {% assert value != blank %}
{% endtest %}
```

### Test File Grouping

Organize by feature:

```
app/lib/test/
├── user_test.liquid        # User-related tests
├── product_test.liquid     # Product tests
├── order_test.liquid       # Order tests
└── payment_test.liquid     # Payment tests
```

## Test Results

### Return Value Format

Tests return contract compliance:

```json
{
  "total": 45,
  "passed": 43,
  "failed": 2,
  "skipped": 0,
  "coverage": 89,
  "failures": [
    {
      "test": "user validation",
      "assertion": "user.email contains '@'",
      "error": "assertion failed"
    }
  ]
}
```

### Browser Results

Visual display:
- Green checkmark for passed
- Red X for failed
- Test name and description
- Assertion that failed (if any)
- Time taken to execute

### CLI Results

Console output:
```
Testing staging environment...

✓ user validation (2ms)
✓ email format (1ms)
✗ password strength (3ms)
  Assertion failed: password.length >= 8

Test Results: 2 passed, 1 failed out of 3 tests
```

## Filtering and Selection

### Filter by Pattern

Run specific tests:

```bash
pos-cli test run staging --filter "user"
```

Runs all tests with "user" in name.

### Selective Test Execution

Only run tagged tests:

```liquid
{% test 'important validation' %}
  <!-- this test runs -->
{% endtest %}

{% test 'optional check' %}
  <!-- this test might skip -->
{% endtest %}
```

## Assertions in GraphQL

### Query Results

Test GraphQL query results:

```liquid
{% test 'graphql user query' %}
  {% graphql 'get_user' %}
    query {
      user(id: 1) {
        id
        name
      }
    }
  {% endgraphql %}

  {% assert 'get_user'.user.name == 'John' %}
{% endtest %}
```

## API Call Testing

### Test API Calls

Verify API integration:

```liquid
{% test 'external api response' %}
  {% api_call 'test_endpoint' %}
    to: 'https://api.example.com'
    format: 'json'
    request_type: 'GET'
  {% endapi_call %}

  {% assert test_endpoint.status == 200 %}
{% endtest %}
```

## Environment-Specific Testing

### Development Testing

```bash
pos-cli test run dev
```

Quick feedback for development.

### Staging Testing

```bash
pos-cli test run staging
```

Required before production deployment.

## See Also

- [Testing Configuration](./configuration.md)
- [Testing Patterns](./patterns.md)
- [Testing Troubleshooting](./gotchas.md)
