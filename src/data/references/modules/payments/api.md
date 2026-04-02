# modules/payments - API Reference

## Queries

### List Transactions
Fetch all transactions for current user:

```graphql
query ListTransactions($limit: Int, $offset: Int) {
  transactions(limit: $limit, offset: $offset) {
    id
    amount
    currency
    status
    created_at
    stripe_charge_id
  }
}
```

Usage:
```liquid
{% graphql transactions = 'modules/payments/queries/transactions/list' %}
{% for transaction in transactions %}
  <p>{{ transaction.amount }} - {{ transaction.status }}</p>
{% endfor %}
```

### Get Transaction Details
```graphql
query GetTransaction($id: ID!) {
  transaction(id: $id) {
    id
    amount
    currency
    status
    description
    customer_email
    created_at
    updated_at
  }
}
```

## Mutations

### Create Transaction
Create a new payment transaction:

```graphql
mutation CreateTransaction($amount: Int!, $currency: String, $description: String) {
  transaction_create(data: {
    amount: $amount
    currency: $currency
    description: $description
  }) {
    transaction {
      id
      amount
      status
      payment_url
    }
  }
}
```

Usage:
```liquid
{% graphql %}
  mutation CreatePayment($amount: Int!) {
    transaction_create(data: { amount: $amount }) {
      transaction {
        id
        payment_url
      }
    }
  }
{% endgraphql %}

{% if transaction.payment_url %}
  <a href="{{ transaction.payment_url }}">Complete Payment</a>
{% endif %}
```

### Refund Transaction
Refund a completed transaction:

```graphql
mutation RefundTransaction($transaction_id: ID!, $amount: Int) {
  transaction_refund(id: $transaction_id, data: {
    amount: $amount
  }) {
    transaction { id, status }
  }
}
```

### Update Transaction Status
```graphql
mutation UpdateTransaction($id: ID!, $status: String!) {
  transaction_update(id: $id, data: {
    status: $status
  }) {
    transaction { id, status }
  }
}
```

## Test Payment Methods

### Test Card Numbers
Use these in test mode:

```
Success:        4242 4242 4242 4242
Decline:        4000 0000 0000 0002
Expired:        4000 0000 0000 0069
CVC Failed:     4000 0000 0000 0127
```

### Test Expiry and CVC
For testing, use any future date and any 3-digit CVC:

```
Expiry:  12/26 (or any future date)
CVC:     123 (or any 3 digits)
```

## Webhook Events

### Payment Succeeded Event
```liquid
<!-- Event: payments_transaction_succeeded -->
{% if event_type == 'payments_transaction_succeeded' %}
  Transaction {{ event.transaction_id }} completed!
  Amount: {{ event.amount }}
{% endif %}
```

### Payment Failed Event
```liquid
<!-- Event: payments_transaction_failed -->
{% if event_type == 'payments_transaction_failed' %}
  Payment for {{ event.transaction_id }} failed
  Reason: {{ event.failure_reason }}
{% endif %}
```

## See Also
- configuration.md - Setup and configuration
- patterns.md - Common payment patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced features
