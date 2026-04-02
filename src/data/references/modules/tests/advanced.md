# modules/tests - Advanced Testing

## Test Fixtures and Factories

### Create Test Factory
```liquid
<!-- app/lib/test/factories/user_factory.liquid -->

{% liquid
  assign email = include.email | default: 'test@example.com'
  assign role = include.role | default: 'user'
%}

{% graphql %}
  mutation CreateUser($email: String!, $role: String!) {
    user_create(data: {
      email: $email
      role: $role
    }) {
      user { id, email, role }
    }
  }
{% endgraphql %}
```

### Use Factory in Tests
```liquid
{% include 'test/factories/user_factory'
  email: 'testuser@example.com'
  role: 'admin'
%}

{% assign test_user = user %}
```

## Parameterized Tests

### Test Multiple Scenarios
```liquid
# app/lib/test/email_validation_test.liquid

{% assign test_cases = 'valid@example.com,invalid@,test@domain' | split: ',' %}

{% for email in test_cases %}
  {% graphql %}
    mutation ValidateEmail($email: String!) {
      email_validate(data: { email: $email }) {
        valid
      }
    }
  {% endgraphql %}

  <!-- Assert each case -->
  {% if email contains '@example' %}
    {% include 'modules/tests/assertions/truthy' value: valid %}
  {% else %}
    {% include 'modules/tests/assertions/falsy' value: valid %}
  {% endif %}
{% endfor %}
```

## Integration Testing

### Test Complete Workflows
```liquid
# app/lib/test/checkout_workflow_test.liquid

{% comment %} Setup: Create user and product {% endcomment %}
{% graphql %}
  mutation SetupCheckout {
    user: user_create(data: { email: "test@example.com" }) {
      user { id }
    }
    product: product_create(data: {
      name: "Test Product"
      price: 99.99
    }) {
      product { id, price }
    }
  }
{% endgraphql %}

{% comment %} Test: Create order {% endcomment %}
{% graphql %}
  mutation CreateOrder($user_id: ID!, $product_id: ID!) {
    order_create(data: {
      user_id: $user_id
      product_id: $product_id
    }) {
      order { id, status, total }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/equal'
  actual: order.status
  expected: 'pending'
%}

{% comment %} Test: Process payment {% endcomment %}
{% graphql %}
  mutation ProcessPayment($order_id: ID!) {
    payment_process(id: $order_id) {
      order { status }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/equal'
  actual: order.status
  expected: 'paid'
%}

{% comment %} Cleanup {% endcomment %}
{% graphql %}
  mutation Cleanup($user_id: ID!, $product_id: ID!, $order_id: ID!) {
    user_delete(id: $user_id) { user { id } }
    product_delete(id: $product_id) { product { id } }
    order_delete(id: $order_id) { order { id } }
  }
{% endgraphql %}
```

## Mock Data Helpers

### Create Mock GraphQL Responses
```liquid
<!-- app/lib/test/mocks/user_mock.liquid -->

{% assign mock_user = { "id": "mock-123", "email": "mock@example.com", "role": "user", "created_at": "2024-01-01T00:00:00Z" } %}
```

### Reuse Mock Data
```liquid
{% include 'test/mocks/user_mock' %}
{% include 'modules/tests/assertions/equal'
  actual: mock_user.email
  expected: 'mock@example.com'
%}
```

## Performance Testing

### Measure Query Performance
```liquid
{% assign start_time = 'now' | date: '%s' | times: 1000 %}

{% graphql result = 'queries/products/list', limit: 100 %}

{% assign end_time = 'now' | date: '%s' | times: 1000 %}
{% assign duration = end_time | minus: start_time %}

{% comment %} Assert query completes within threshold {% endcomment %}
{% if duration < 1000 %}
  {% include 'modules/tests/assertions/truthy' value: true %}
{% endif %}
```

## Edge Case Testing

### Test Boundary Conditions
```liquid
# app/lib/test/edge_cases_test.liquid

{% comment %} Test: Empty array {% endcomment %}
{% graphql result = 'queries/products/empty_list' %}
{% include 'modules/tests/assertions/count' array: result.products expected: 0 %}

{% comment %} Test: Large numbers {% endcomment %}
{% graphql %}
  mutation CreateLargeOrder {
    order_create(data: {
      amount: 999999999
    }) {
      order { amount }
    }
  }
{% endgraphql %}

{% comment %} Test: Special characters {% endcomment %}
{% graphql %}
  mutation CreateWithSpecialChars($name: String!) {
    product_create(data: { name: $name }) {
      product { name }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/equal'
  actual: product.name
  expected: '@#$%^&*()'
%}
```

## Custom Assertions

### Create Custom Assertion Helper
```liquid
<!-- app/lib/test/assertions/email_valid.liquid -->

{% assign email = include.email %}
{% if email contains '@' and email contains '.' %}
  {% assign result = true %}
{% else %}
  {% assign result = false %}
{% endif %}

{% include 'modules/tests/assertions/truthy' value: result %}
```

## Continuous Integration

### Test in CI/CD Pipeline
```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install pos-cli
        run: npm install -g @platformos/pos-cli
      - name: Run tests
        run: pos-cli test run staging
```

## See Also
- configuration.md - Setup and structure
- api.md - Assertions reference
- patterns.md - Common patterns
- gotchas.md - Common mistakes
