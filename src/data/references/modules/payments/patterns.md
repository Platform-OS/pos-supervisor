# modules/payments - Common Patterns

## Basic Payment Flow

### Create Transaction and Redirect
```liquid
{% graphql %}
  mutation CreatePayment($amount: Int!) {
    transaction_create(data: {
      amount: $amount
      currency: "USD"
      description: "Product purchase"
    }) {
      transaction {
        id
        payment_url
        status
      }
    }
  }
{% endgraphql %}

{% if transaction.payment_url %}
  <script>
    window.location.href = "{{ transaction.payment_url }}";
  </script>
{% endif %}
```

### Handle Payment Success
```liquid
{% graphql transaction = 'modules/payments/queries/transactions/get', id: transaction_id %}

{% if transaction.status == 'succeeded' %}
  <div class="pos-alert pos-alert-success">
    <h3>Payment Successful!</h3>
    <p>Transaction ID: {{ transaction.id }}</p>
    <p>Amount: ${{ transaction.amount | divided_by: 100 }}.00</p>
  </div>
{% endif %}
```

## E-Commerce Patterns

### Product Purchase with Payment
```liquid
{% assign amount_cents = product.price | times: 100 | round %}

{% graphql %}
  mutation PurchaseProduct($amount: Int!) {
    transaction_create(data: {
      amount: $amount
      currency: "USD"
      description: "{{ product.name }}"
      metadata: {
        product_id: "{{ product.id }}"
        quantity: 1
      }
    }) {
      transaction { payment_url }
    }
  }
{% endgraphql %}

<form method="post" action="{{ transaction.payment_url }}">
  <h2>{{ product.name }}</h2>
  <p>Price: ${{ product.price }}</p>
  <button type="submit" class="pos-btn pos-btn-primary">
    Buy Now
  </button>
</form>
```

### Order Total Calculation
```liquid
{% assign subtotal = 0 %}
{% for item in cart.items %}
  {% assign subtotal = subtotal | plus: item.total %}
{% endfor %}

{% assign tax = subtotal | times: 0.08 %}
{% assign total = subtotal | plus: tax %}
{% assign total_cents = total | times: 100 | round %}

<div class="pos-card">
  <div class="pos-card-body">
    <p>Subtotal: ${{ subtotal }}</p>
    <p>Tax (8%): ${{ tax }}</p>
    <h3>Total: ${{ total }}</h3>
  </div>
</div>
```

## Subscription Patterns

### Recurring Payment Setup
```liquid
{% graphql %}
  mutation CreateSubscription($plan_id: String!, $amount: Int!) {
    subscription_create(data: {
      plan_id: $plan_id
      amount: $amount
      interval: "month"
      description: "Monthly subscription"
    }) {
      subscription {
        id
        status
        next_payment_date
      }
    }
  }
{% endgraphql %}
```

### Cancel Subscription
```liquid
{% graphql %}
  mutation CancelSubscription($subscription_id: ID!) {
    subscription_cancel(id: $subscription_id) {
      subscription { status }
    }
  }
{% endgraphql %}
```

## Refund Patterns

### Process Refund
```liquid
{% graphql %}
  mutation RefundPayment($transaction_id: ID!, $amount: Int!) {
    transaction_refund(id: $transaction_id, data: {
      amount: $amount
      reason: "customer_request"
    }) {
      transaction { id, status }
    }
  }
{% endgraphql %}
```

### List Transactions with Status
```liquid
{% graphql transactions = 'modules/payments/queries/transactions/list', status: 'succeeded' %}

<table class="pos-table">
  <thead>
    <tr>
      <th>ID</th>
      <th>Amount</th>
      <th>Date</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    {% for trans in transactions %}
      <tr>
        <td>{{ trans.id }}</td>
        <td>${{ trans.amount | divided_by: 100 }}</td>
        <td>{{ trans.created_at | date: '%Y-%m-%d' }}</td>
        <td>{{ trans.status }}</td>
      </tr>
    {% endfor %}
  </tbody>
</table>
```

## Error Handling

### Graceful Failure Handling
```liquid
{% graphql %}
  mutation SafeTransaction($amount: Int!) {
    transaction_create(data: { amount: $amount }) {
      transaction { id, payment_url }
      errors { message }
    }
  }
{% endgraphql %}

{% if transaction.errors %}
  <div class="pos-alert pos-alert-danger">
    Payment failed: {{ transaction.errors.first.message }}
  </div>
{% elsif transaction.payment_url %}
  <a href="{{ transaction.payment_url }}" class="pos-btn pos-btn-primary">
    Proceed to Payment
  </a>
{% endif %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- gotchas.md - Common mistakes
- advanced.md - Advanced patterns
