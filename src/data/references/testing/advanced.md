# Advanced Testing Techniques

## Test-Driven Development Pattern

### Write Tests First

```liquid
{% test 'user registration workflow' %}
  {% graphql 'register_user' %}
    mutation RegisterUser($email: String!, $password: String!) {
      userRegister(email: $email, password: $password) {
        user {
          id
          email
          createdAt
        }
      }
    }
  {% endgraphql %}

  {% assert register_user.user valid_object %}
  {% assert register_user.user.email == 'new@example.com' %}
{% endtest %}
```

### Verify Test Fails First

Ensure test fails before implementing feature:

```bash
pos-cli test run dev
# Should show failure
```

## Mocking and Stubbing

### Mock External API Responses

```liquid
{% test 'payment with mock api' %}
  {% if context.constants.MOCK_PAYMENTS == 'true' %}
    <!-- Use mock response -->
    {% assign payment_response = 'success' %}
  {% else %}
    <!-- Call real API -->
    {% api_call 'process_payment' %}
      to: 'https://api.payment.com/process'
      format: 'json'
      request_type: 'POST'
    {% endapi_call %}
    {% assign payment_response = payment_response.status %}
  {% endif %}

  {% assert payment_response == 'success' %}
{% endtest %}
```

### Conditional Test Data

```liquid
{% test 'order processing with test data' %}
  {% if context.environment == 'testing' %}
    <!-- Use test data -->
    {% assign test_order = 'test_order_123' %}
  {% else %}
    <!-- Use real data -->
    {% graphql 'fetch_order' %}
      query { lastOrder { id } }
    {% endgraphql %}
    {% assign test_order = lastOrder.id %}
  {% endif %}

  {% assert test_order != blank %}
{% endtest %}
```

## Property-Based Testing

### Generate Test Cases

```liquid
{% test 'email validation with multiple formats' %}
  {% assign test_emails = 'user@example.com,test+tag@domain.co.uk,name.last@company.org' | split: ',' %}

  {% for email in test_emails %}
    {% assert email contains '@' %}
  {% endfor %}
{% endtest %}
```

### Boundary Testing

```liquid
{% test 'price boundaries' %}
  {% assign prices = '-10,0,1,999999.99' | split: ',' %}

  {% for price in prices %}
    {% assign price_num = price | plus: 0 %}

    {% if price_num > 0 %}
      {% assert true %}
    {% else %}
      {% assert false %}
    {% endif %}
  {% endfor %}
{% endtest %}
```

## Integration Testing Advanced

### Full User Journey Testing

```liquid
{% test 'complete purchase flow' %}
  <!-- Step 1: Create user -->
  {% graphql 'create_user' %}
    mutation { userCreate(email: "test@example.com") { user { id } } }
  {% endgraphql %}
  {% assign user_id = create_user.user.id %}
  {% assert user_id != blank %}

  <!-- Step 2: Add to cart -->
  {% graphql 'add_cart' %}
    mutation { cartAdd(userId: {{ user_id }}, productId: 1) { success } }
  {% endgraphql %}
  {% assert add_cart.success %}

  <!-- Step 3: Process payment -->
  {% api_call 'process_payment' %}
    to: 'https://api.payment.com/charge'
    format: 'json'
    request_type: 'POST'
  {% endapi_call %}
  {% assert process_payment.status == 200 %}

  <!-- Step 4: Verify order -->
  {% graphql 'get_order' %}
    query { userOrder(userId: {{ user_id }}) { status } }
  {% endgraphql %}
  {% assert get_order.userOrder.status == 'completed' %}
{% endtest %}
```

### Multi-Step Workflows

```liquid
{% test 'order to shipment workflow' %}
  <!-- Create order -->
  {% graphql 'order_create' %}
    mutation { orderCreate(items: [{productId: 1, qty: 2}]) { orderId } }
  {% endgraphql %}

  <!-- Confirm order -->
  {% graphql 'order_confirm' %}
    mutation { orderConfirm(orderId: {{ order_create.orderId }}) { confirmed } }
  {% endgraphql %}

  <!-- Process shipment -->
  {% graphql 'shipment_create' %}
    mutation { shipmentCreate(orderId: {{ order_create.orderId }}) { trackingId } }
  {% endgraphql %}

  {% assert shipment_create.trackingId != blank %}
{% endtest %}
```

## Performance Testing

### Benchmarking Code Paths

```liquid
{% test 'query performance' %}
  {% assign start_time = 'now' | date: '%s.%N' %}

  {% graphql 'large_query' %}
    query {
      products(limit: 1000) {
        id
        name
        price
      }
    }
  {% endgraphql %}

  {% assign end_time = 'now' | date: '%s.%N' %}
  {% assign duration = end_time | minus: start_time %}

  <!-- Assert query completes within timeout -->
  {% assign max_duration = 5 %}
  {% assert duration < max_duration %}
{% endtest %}
```

## Data Integrity Testing

### Complex Object Validation

```liquid
{% test 'order data integrity' %}
  {% graphql 'fetch_order' %}
    query GetOrder($id: ID!) {
      order(id: $id) {
        id
        user { id email }
        items { id productId qty price }
        total
        status
        createdAt
      }
    }
  {% endgraphql %}

  {% assign order = fetch_order.order %}

  <!-- Validate structure -->
  {% assert order valid_object %}
  {% assert order.id != blank %}
  {% assert order.user valid_object %}

  <!-- Validate relationships -->
  {% assert order.items != blank %}
  {% assign item_count = order.items | size %}
  {% assert item_count > 0 %}

  <!-- Validate calculations -->
  {% assign calculated_total = 0 %}
  {% for item in order.items %}
    {% assign item_total = item.price | times: item.qty %}
    {% assign calculated_total = calculated_total | plus: item_total %}
  {% endfor %}
  {% assert calculated_total == order.total %}
{% endtest %}
```

## Concurrent Testing Pattern

### Parallel Test Execution

```bash
#!/bin/bash
# Run multiple test suites in parallel

(pos-cli test run dev --filter "user" &) &
(pos-cli test run dev --filter "product" &) &
(pos-cli test run dev --filter "order" &) &

wait

echo "All test suites completed"
```

## Regression Testing

### Maintain Test Registry

```liquid
{% test 'regression: critical features' %}
  <!-- Login functionality -->
  {% graphql 'auth_test' %}
    mutation { userLogin(email: "test@example.com", password: "pass") { success } }
  {% endgraphql %}
  {% assert auth_test.success %}

  <!-- Payment processing -->
  {% api_call 'payment_test' %}
    to: 'https://api.payment.com/test'
    format: 'json'
    request_type: 'POST'
  {% endapi_call %}
  {% assert payment_test.status == 200 %}

  <!-- Data export -->
  {% graphql 'export_test' %}
    query { exportData(type: "users") { success } }
  {% endgraphql %}
  {% assert export_test.success %}
{% endtest %}
```

## Test Organization at Scale

### Suites by Domain

```
app/lib/test/
├── auth_test.liquid
├── users_test.liquid
├── products_test.liquid
├── orders_test.liquid
├── payments_test.liquid
├── shipping_test.liquid
└── admin_test.liquid
```

### Master Test File

```liquid
<!-- app/lib/test/master_test.liquid -->
{% test 'master contract validation' %}
  <!-- Import and validate all domains -->
  {% include 'test/auth' %}
  {% include 'test/users' %}
  {% include 'test/products' %}
  {% include 'test/orders' %}

  {% assert all_tests_passed %}
{% endtest %}
```

## See Also

- [Testing Patterns](./patterns.md)
- [Testing API Reference](./api.md)
- [Deployment Advanced](../deployment/advanced.md)
