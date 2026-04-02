# modules/tests - API Reference

## Assertions

### valid_object
Assert that a GraphQL object is valid and not null:

```liquid
{% graphql result = 'queries/user/get', id: 123 %}
{% include 'modules/tests/assertions/valid_object' object: result.user %}
```

### equal
Assert two values are equal:

```liquid
{% include 'modules/tests/assertions/equal'
  actual: user.role
  expected: 'admin'
%}
```

### not_equal
Assert two values are different:

```liquid
{% include 'modules/tests/assertions/not_equal'
  actual: payment.status
  expected: 'failed'
%}
```

### truthy
Assert a value is truthy:

```liquid
{% if user.is_active %}
  {% include 'modules/tests/assertions/truthy' value: user.is_active %}
{% endif %}
```

### falsy
Assert a value is falsy:

```liquid
{% if user.deleted_at %}
  {% include 'modules/tests/assertions/falsy' value: user.is_active %}
{% endif %}
```

### contains
Assert an array contains an element:

```liquid
{% include 'modules/tests/assertions/contains'
  array: user.roles
  element: 'admin'
%}
```

### count
Assert array count:

```liquid
{% include 'modules/tests/assertions/count'
  array: products
  expected: 5
%}
```

### error_contains
Assert error message contains text:

```liquid
{% include 'modules/tests/assertions/error_contains'
  errors: response.errors
  text: 'Email already exists'
%}
```

## Test Contract

### Return Contract Structure
Each test returns a contract:

```liquid
{% assign contract = '' | split: '|' %}
{% assign contract[0] = 'test_name' %}
{% assign contract[1] = 'passed' %}
{% assign contract[2] = 'duration_ms' %}
{% assign contract[3] = 'assertions' %}
{% assign contract[4] = 'failures' %}
```

### Contract Example
```json
{
  "test_name": "test_user_creation",
  "passed": true,
  "duration_ms": 245,
  "assertions": 5,
  "failures": []
}
```

## Test Utilities

### Setup Fixtures
Create test data:

```liquid
{% graphql %}
  mutation CreateTestUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id, email }
    }
  }
{% endgraphql %}

{% assign test_user_id = user.id %}
```

### Cleanup Data
Remove test data after test:

```liquid
{% graphql %}
  mutation DeleteTestUser($id: ID!) {
    user_delete(id: $id) {
      user { id }
    }
  }
{% endgraphql %}
```

### Query Builders
Create reusable query wrappers:

```liquid
<!-- app/lib/test/helpers/create_test_user.liquid -->
{% graphql %}
  mutation CreateUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id, email }
    }
  }
{% endgraphql %}
```

## Assertion Output

### Successful Assertion
```
✓ Assert user.role equals 'admin'
```

### Failed Assertion
```
✗ Assert user.role equals 'admin'
  Expected: admin
  Actual: moderator
```

### Test Summary
```
Assertions: 15
Passed: 14
Failed: 1
Duration: 1,234 ms
```

## See Also
- configuration.md - Setup and structure
- patterns.md - Common test patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced techniques
