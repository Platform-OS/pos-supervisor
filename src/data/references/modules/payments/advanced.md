# modules/payments - Advanced Configuration

## Custom Payment Flow

### Tokenization for Recurring Charges
Create a payment token for future charges:

```graphql
mutation TokenizeCard($card_token: String!) {
  payment_token_create(data: {
    card_token: $card_token
    save_for_later: true
  }) {
    payment_token {
      id
      last_four
      expires_at
    }
  }
}
```

### Charge Saved Card
```graphql
mutation ChargeToken($token_id: ID!, $amount: Int!) {
  transaction_create(data: {
    payment_token_id: $token_id
    amount: $amount
    currency: "USD"
  }) {
    transaction {
      id
      status
    }
  }
}
```

## Advanced Error Handling

### Retry Logic
Implement smart retry for failed transactions:

```liquid
{% assign max_retries = 3 %}
{% assign retry_count = transaction.retry_count | default: 0 %}

{% if transaction.status == 'failed' and retry_count < max_retries %}
  <!-- Retry after exponential backoff -->
  {% assign delay_seconds = 60 | times: retry_count %}
  <!-- Schedule retry -->
{% endif %}
```

### Error Logging and Monitoring
```graphql
mutation LogPaymentError($error_code: String!, $message: String!) {
  payment_error_log_create(data: {
    error_code: $error_code
    message: $message
    timestamp: "now"
  }) {
    error_log { id }
  }
}
```

## Webhook Processing

### Asynchronous Webhook Handling
Process webhooks safely without blocking:

```liquid
{% graphql %}
  mutation EnqueueWebhookProcess($webhook_data: JSON!) {
    webhook_queue_add(data: {
      event_type: "{{ event_type }}"
      payload: $webhook_data
      status: "pending"
    }) {
      queue_item { id }
    }
  }
{% endgraphql %}

<!-- Process asynchronously -->
{% graphql pending_webhooks = 'queries/webhooks/pending' %}
```

### Idempotent Webhook Processing
```liquid
{% graphql existing_transaction = 'queries/transactions/by_stripe_id', stripe_id: stripe_event_id %}

{% if transaction_exists %}
  <!-- Already processed this webhook -->
{% else %}
  <!-- First time seeing this event, process it -->
{% endif %}
```

## Multi-Currency Support

### Currency Conversion
```liquid
{% assign usd_amount = 100 %}
{% assign exchange_rate = 0.92 %}
{% assign eur_amount = usd_amount | times: exchange_rate %}

{% graphql %}
  mutation CreateTransaction($amount: Int!, $currency: String!) {
    transaction_create(data: {
      amount: $amount
      currency: $currency
    }) {
      transaction { id }
    }
  }
{% endgraphql %}
```

### Get Exchange Rates
```graphql
query GetExchangeRates($from: String!, $to: String!) {
  exchange_rate(from: $from, to: $to) {
    rate
    updated_at
  }
}
```

## Fraud Prevention

### Velocity Checks
Prevent rapid repeat transactions:

```liquid
{% graphql recent_transactions = 'queries/transactions/recent', customer_id: customer_id, limit: 10, minutes: 30 %}

{% if recent_transactions.size > 5 %}
  <!-- Suspicious activity detected -->
  {% assign requires_verification = true %}
{% endif %}
```

### Geolocation Verification
```graphql
query GetTransaction($id: ID!) {
  transaction(id: $id) {
    id
    customer_ip
    geoip_country
  }
}
```

### Amount Limits
```liquid
{% assign daily_limit = 10000 %}
{% graphql daily_total = 'queries/transactions/daily_total' %}

{% if daily_total > daily_limit %}
  <!-- Exceeded daily limit -->
{% endif %}
```

## Analytics and Reporting

### Transaction Analytics
```graphql
query GetTransactionStats($date_from: String!, $date_to: String!) {
  transaction_stats(date_from: $date_from, date_to: $date_to) {
    total_count
    total_amount
    average_amount
    success_rate
  }
}
```

### Revenue Dashboard
```liquid
{% graphql analytics = 'queries/analytics/revenue', period: 'month', group_by: 'day' %}

<div class="pos-card">
  <h3>Monthly Revenue</h3>
  <p>Total: ${{ analytics.total | divided_by: 100 }}</p>
  <p>Transactions: {{ analytics.count }}</p>
  <p>Average: ${{ analytics.average | divided_by: 100 }}</p>
</div>
```

## PCI Compliance

### Never Store Raw Card Data
Always use tokenization:

```liquid
<!-- WRONG - PCI violation -->
{% assign card_number = form.card_number %}

<!-- CORRECT - use Stripe token -->
{% assign stripe_token = form.stripeToken %}
```

### Audit Trail
```graphql
query GetPaymentAudit($transaction_id: ID!) {
  transaction_audit(transaction_id: $transaction_id) {
    id
    action
    user_id
    timestamp
  }
}
```

## See Also
- configuration.md - Basic setup
- api.md - API reference
- patterns.md - Common patterns
- gotchas.md - Common mistakes
