# Testing Patterns

## Basic Test Pattern

### Simple Validation Test

```liquid
{% test 'user email validation' %}
  {% assign email = 'user@example.com' %}
  {% assert email contains '@' %}
{% endtest %}
```

## Unit Testing Pattern

### Testing Business Logic

```liquid
{% test 'calculate discount' %}
  {% assign price = 100 %}
  {% assign discount_rate = 0.1 %}
  {% assign discount = price | times: discount_rate %}

  {% assert discount == 10 %}
{% endtest %}
```

### Testing String Manipulation

```liquid
{% test 'format phone number' %}
  {% assign phone = '1234567890' %}
  {% assign formatted = phone | slice: 0, 3 | append: '-' | append: phone | slice: 3, 3 | append: '-' | append: phone | slice: 6, 4 %}

  {% assert formatted == '123-456-7890' %}
{% endtest %}
```

## Integration Testing Pattern

### Testing Data Retrieval

```liquid
{% test 'fetch user data' %}
  {% graphql 'fetch_user' %}
    query GetUser($id: ID!) {
      user(id: $id) {
        id
        name
        email
      }
    }
  {% endgraphql %}

  {% assert fetch_user.user valid_object %}
  {% assert fetch_user.user.email contains '@' %}
{% endtest %}
```

## API Call Testing Pattern

### External Service Integration

```liquid
{% test 'payment gateway integration' %}
  {% api_call 'payment_check' %}
    to: 'https://api.payment.com/status'
    format: 'json'
    request_type: 'GET'
    request_headers: '{ "Authorization": "Bearer token" }'
  {% endapi_call %}

  {% assert payment_check.status == 200 %}
  {% assert payment_check.response.success %}
{% endtest %}
```

## Error Handling Testing Pattern

### Negative Test Cases

```liquid
{% test 'invalid email rejected' %}
  {% assign invalid_email = 'not-an-email' %}

  {% if invalid_email contains '@' %}
    {% assign valid = true %}
  {% else %}
    {% assign valid = false %}
  {% endif %}

  {% assert valid == false %}
{% endtest %}
```

### Exception Testing

```liquid
{% test 'division by zero handling' %}
  {% assign numerator = 10 %}
  {% assign denominator = 0 %}

  {% if denominator == 0 %}
    {% assign result = 'error' %}
  {% else %}
    {% assign result = numerator | divided_by: denominator %}
  {% endif %}

  {% assert result == 'error' %}
{% endtest %}
```

## Data Validation Pattern

### Schema Validation

```liquid
{% test 'user object structure' %}
  {% assign user = context.current_user %}

  {% assert user valid_object %}
  {% assert user.id != blank %}
  {% assert user.email contains '@' %}
  {% assert user.created_at != blank %}
{% endtest %}
```

### Type Checking

```liquid
{% test 'price is numeric' %}
  {% assign price = '19.99' | plus: 0 %}

  {% assert price == 19.99 %}
{% endtest %}
```

## Comprehensive Test Suite Pattern

### Testing File Example

```liquid
---
# Header with metadata (optional)
---

<!-- User Model Tests -->
{% test 'user creation' %}
  {% assign user_name = 'John Doe' %}
  {% assert user_name != blank %}
{% endtest %}

{% test 'user email validation' %}
  {% assign email = 'john@example.com' %}
  {% assert email contains '@' %}
{% endtest %}

<!-- Product Tests -->
{% test 'product price validation' %}
  {% assign price = 29.99 %}
  {% assert price > 0 %}
{% endtest %}

{% test 'product inventory check' %}
  {% assign inventory = 10 %}
  {% assert inventory >= 0 %}
{% endtest %}

<!-- Order Tests -->
{% test 'order total calculation' %}
  {% assign item_price = 50 %}
  {% assign quantity = 2 %}
  {% assign total = item_price | times: quantity %}

  {% assert total == 100 %}
{% endtest %}
```

## Continuous Testing Pattern

### Pre-Deployment Testing Workflow

```bash
# 1. Development testing
pos-cli test run dev

# 2. Staging testing (comprehensive)
pos-cli test run staging --verbose

# 3. Review results
pos-cli logs staging --filter test

# 4. If all pass, deploy
pos-cli deploy production
```

### Automated Testing in CI/CD

```yaml
# GitHub Actions
- name: Run Tests
  run: |
    pos-cli test run staging
    if [ $? -ne 0 ]; then
      echo "Tests failed"
      exit 1
    fi
```

## Performance Testing Pattern

### Load Simulation

```liquid
{% test 'handle bulk operations' %}
  {% assign items = '' %}

  {% for i in (1..1000) %}
    {% assign items = items | append: i | append: ',' %}
  {% endfor %}

  {% assign item_count = items | split: ',' | size %}
  {% assert item_count == 1000 %}
{% endtest %}
```

## Contract Testing Pattern

### Expected Response Structure

```liquid
{% test 'api contract compliance' %}
  {% api_call 'user_service' %}
    to: 'https://api.example.com/users/1'
    format: 'json'
    request_type: 'GET'
  {% endapi_call %}

  <!-- Verify contract -->
  {% assert user_service.response.user valid_object %}
  {% assert user_service.response.user.id != blank %}
  {% assert user_service.response.user.name != blank %}
  {% assert user_service.response.user.email != blank %}
{% endtest %}
```

## See Also

- [Testing Configuration](./configuration.md)
- [Testing API Reference](./api.md)
- [Testing Troubleshooting](./gotchas.md)
