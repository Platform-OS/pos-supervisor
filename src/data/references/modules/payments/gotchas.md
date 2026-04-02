# modules/payments - Common Gotchas

## Amount Format Error

Always use cents, not dollars:

```liquid
<!-- WRONG - dollars -->
{% assign amount = 99.99 %}
<!-- Creates 99 cents transaction -->

<!-- CORRECT - cents -->
{% assign amount = 9999 %}
<!-- Creates $99.99 transaction -->

<!-- Even better - calculate from dollars -->
{% assign dollars = 99.99 %}
{% assign amount = dollars | times: 100 | round %}
```

## Missing Stripe Configuration

Forgetting to set the API key causes silent failures:

```bash
# WRONG - module loads but transactions fail
# STRIPE_SK_KEY not set

# CORRECT - set before using
pos-cli env set STRIPE_SK_KEY sk_test_xxxxx
```

Always verify in your logs:
```liquid
{% graphql stripe_status = 'modules/payments/queries/stripe/status' %}
```

## Test Mode with Live Keys

Never use test cards with live keys:

```liquid
<!-- WRONG - test card with live key -->
<!-- Card: 4242 4242 4242 4242 -->
<!-- With STRIPE_SK_KEY=sk_live_xxx -->

<!-- CORRECT -->
<!-- Test card with test key -->
<!-- Card: 4242 4242 4242 4242 -->
<!-- With STRIPE_SK_KEY=sk_test_xxx -->
```

## Hardcoding Amounts

Never hardcode prices in your code:

```liquid
<!-- WRONG -->
{% assign amount = 1999 %}
<!-- If price changes, need code update -->

<!-- CORRECT -->
{% graphql product = 'products/get', id: product_id %}
{% assign amount = product.price | times: 100 | round %}
```

## Missing Error Handling

Always handle payment failures:

```liquid
<!-- WRONG -->
{% graphql %}
  mutation Pay($amount: Int!) {
    transaction_create(data: { amount: $amount }) {
      transaction { payment_url }
    }
  }
{% endgraphql %}

<a href="{{ transaction.payment_url }}">Pay Now</a>

<!-- CORRECT -->
{% graphql %}
  mutation Pay($amount: Int!) {
    transaction_create(data: { amount: $amount }) {
      transaction { payment_url }
      errors { message }
    }
  }
{% endgraphql %}

{% if transaction.errors %}
  <p class="pos-alert pos-alert-danger">
    Error: {{ transaction.errors.first.message }}
  </p>
{% else %}
  <a href="{{ transaction.payment_url }}" class="pos-btn">Pay Now</a>
{% endif %}
```

## Not Verifying Webhook Signature

Never trust webhooks without verification:

```liquid
<!-- WRONG - just process the webhook -->
{% if event.type == 'charge.succeeded' %}
  Mark order as paid
{% endif %}

<!-- CORRECT - verify signature first -->
{% if webhook_verified %}
  {% if event.type == 'charge.succeeded' %}
    Mark order as paid
  {% endif %}
{% endif %}
```

## Race Conditions on Payment Success

Avoid double-processing payments:

```liquid
<!-- WRONG -->
{% if transaction.status == 'succeeded' %}
  Mark order complete
  Send confirmation email
  Grant access
{% endif %}
<!-- Called multiple times, causes issues -->

<!-- CORRECT -->
{% if transaction.status == 'succeeded' AND order.processed == false %}
  Mark order complete
  Send confirmation email
  Grant access
  Set order.processed = true
{% endif %}
```

## Exposing Sensitive Data

Never log or display full card numbers:

```liquid
<!-- WRONG -->
{{ transaction.card_number }}

<!-- CORRECT -->
<!-- Use card last 4 only -->
Card ending in {{ transaction.card_last_4 }}
```

## Forgetting Currency

Always specify currency explicitly:

```liquid
<!-- WRONG - assumes currency -->
{% assign amount = 9999 %}

<!-- CORRECT - explicit currency -->
{% graphql %}
  mutation CreateTransaction($amount: Int!) {
    transaction_create(data: {
      amount: $amount
      currency: "USD"
    }) {
      transaction { id }
    }
  }
{% endgraphql %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Common patterns
- advanced.md - Advanced features
