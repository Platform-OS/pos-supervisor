# Testing Gotchas and Troubleshooting

## Environment Restrictions

### Test Only on Dev and Staging

**Issue**: Cannot run tests on production

```bash
# WRONG - This fails
pos-cli test run production
```

**Why**: Tests require isolated test data and should never affect live systems.

### Correct Environments

```bash
# CORRECT - Development
pos-cli test run dev

# CORRECT - Staging
pos-cli test run staging
```

## Test File Organization Issues

### Test File Not Found

**Issue**: `pos-cli test run` finds no tests

**Causes**:
- File not in `app/lib/test/` directory
- Wrong file naming (must end with `_test.liquid`)
- File not saved or syntax error

**Solution**:
```bash
# Verify file location
ls -la app/lib/test/

# Check naming convention
# Correct: user_test.liquid
# Wrong: user_tests.liquid or usertest.liquid
```

### Wrong Directory Structure

**Issue**: Tests not discovered

**Correct Structure**:
```
app/
└── lib/
    └── test/
        ├── user_test.liquid
        ├── product_test.liquid
        └── order_test.liquid
```

## Assertion Issues

### Assertion Syntax Error

**Issue**: Test fails with "Invalid assertion"

```liquid
# WRONG
{% assert user %}        # Missing comparison

# CORRECT
{% assert user != blank %}
{% assert user == 'John' %}
```

### Unknown Assertion Type

**Issue**: "Unknown assertion method"

**Valid Assertions**:
- `valid_object`
- `==` (equal)
- `!=` (not_equal)
- Truthy (blank check)
- `contains`

```liquid
# WRONG
{% assert user.email is_valid %}

# CORRECT
{% assert user.email contains '@' %}
```

### Type Mismatch in Assertions

**Issue**: Comparing incompatible types

```liquid
# WRONG
{% assign count = '10' %}
{% assert count == 10 %}  # String vs number

# CORRECT
{% assign count = 10 | to_s %}
{% assert count == '10' %}
```

## Data and Context Issues

### Current User Not Available

**Issue**: `context.current_user` is nil in tests

**Reason**: Tests run in isolation without user session

**Solution**:
```liquid
{% test 'user properties' %}
  {% assign test_user = 'John' %}
  {% assert test_user != blank %}
{% endtest %}
```

### Graphql Variable Issues

**Issue**: GraphQL query variables undefined

```liquid
# WRONG
{% graphql 'get_user' %}
  query {
    user(id: $id) {  <!-- $id undefined -->
      name
    }
  }
{% endgraphql %}

# CORRECT
{% graphql 'get_user' %}
  query GetUser($id: ID!) {
    user(id: $id) {
      name
    }
  }
{% endgraphql %}
```

### API Call in Tests

**Issue**: API call times out or fails

**Solution**:
```liquid
{% test 'api availability' %}
  {% api_call 'health_check' %}
    to: 'https://api.example.com/health'
    format: 'json'
    request_type: 'GET'
  {% endapi_call %}

  {% if health_check.status == 200 %}
    {% assert true %}
  {% else %}
    {% assert false %}
  {% endif %}
{% endtest %}
```

## Performance and Timeout Issues

### Test Execution Timeout

**Issue**: Test runs forever or times out

**Common Causes**:
- Infinite loop in test
- API call hanging
- Large data processing

**Solution**:
```liquid
# Add timeout guard
{% assign timeout_count = 0 %}

{% for i in (1..10000) %}
  {% assign timeout_count = timeout_count | plus: 1 %}
  {% if timeout_count > 1000 %}
    {% break %}
  {% endif %}
{% endfor %}

{% assert timeout_count <= 1000 %}
```

### Slow Tests

**Issue**: Test execution takes too long

**Optimization**:
- Minimize data processing
- Avoid large loops
- Use realistic dataset sizes

```liquid
# Inefficient
{% for i in (1..100000) %}
  <!-- slow operation -->
{% endfor %}

# Better
{% for i in (1..100) %}
  <!-- fast operation -->
{% endfor %}
```

## Variable Scope Issues

### Variables Not Persisting Between Assertions

**Issue**: Variable value changes between assertions

```liquid
{% test 'variable scope' %}
  {% assign value = 10 %}
  {% assert value == 10 %}

  {% assign value = 20 %}  <!-- Reassignment -->
  {% assert value == 20 %}
{% endtest %}
```

### Filter Application

**Issue**: Filters not working as expected

```liquid
# WRONG
{% assign price = 100 %}
{% assert price * 0.1 == 10 %}  <!-- * not valid in liquid -->

# CORRECT
{% assign price = 100 %}
{% assign discount = price | times: 0.1 %}
{% assert discount == 10 %}
```

## Test Result Issues

### Tests Pass Locally but Fail in CI

**Issue**: Environment-dependent tests

**Causes**:
- Different platformOS version
- Missing constants in CI environment
- Different data state

**Solution**:
```bash
# Test on staging first
pos-cli test run staging

# Then CI environment
```

### False Positive Tests

**Issue**: Tests pass but functionality broken

**Solution**:
```liquid
# Better assertions
{% test 'user email' %}
  {% assign user = context.current_user %}

  <!-- More comprehensive -->
  {% assert user valid_object %}
  {% assert user.email != blank %}
  {% assert user.email contains '@' %}
  {% assert user.email | size > 5 %}
{% endtest %}
```

## Contract Compliance Issues

### Contract Not Returned

**Issue**: `pos-cli test run` doesn't show contract

**Solution**:
- Ensure all assertions are valid
- Check test file syntax
- Run with verbose flag: `pos-cli test run staging --verbose`

### Coverage Metrics Missing

**Issue**: Contract doesn't include coverage percentage

**Note**: Coverage depends on how extensively tests validate code paths.

## Common Test Failures

### Email Validation Fails

**Issue**: Email format assertion fails

```liquid
# WRONG - Only checks presence
{% assign email = 'test' %}
{% assert email != blank %}

# CORRECT - Validates format
{% assign email = 'test@example.com' %}
{% assert email contains '@' %}
```

### Number Comparison Fails

**Issue**: String vs number comparison

```liquid
# WRONG
{% assign count = '5' %}
{% assert count == 5 %}

# CORRECT - Convert to same type
{% assign count = 5 | to_s %}
{% assert count == '5' %}
```

## See Also

- [Testing Configuration](./configuration.md)
- [Testing Patterns](./patterns.md)
- [CLI Troubleshooting](../cli/gotchas.md)
