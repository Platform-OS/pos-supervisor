# pos-module-payments (Stripe)

Provides payment processing via Stripe.

**Optional module** — install when you need payment functionality.

## Install

```bash
pos-cli modules install payments
pos-cli modules install payments_stripe
```

## Documentation

- Payments: https://github.com/Platform-OS/pos-module-payments
- Stripe: https://github.com/Platform-OS/pos-module-payments-stripe

## Setup

Set Stripe secret key as a constant:

```bash
pos-cli constants set --name stripe_sk_key --value "sk_test_..." dev
```

## Creating a Payment

```liquid
{% function transaction = 'modules/payments/commands/transactions/create',
  gateway: 'stripe',
  email: email,
  line_items: items,
  success_url: '/thank-you',
  cancel_url: '/cart'
%}

{% function url = 'modules/payments/queries/pay_url', transaction: transaction %}
{% redirect_to url, status: 303 %}
```

## Line Items Format

```liquid
{% assign items = [
  { "name": "Product A", "quantity": 2, "unit_price": 1999, "currency": "usd" },
  { "name": "Product B", "quantity": 1, "unit_price": 3500, "currency": "usd" }
] %}
```

Prices are in fractional units (cents for USD).

## Handling Payment Events

Create consumers for payment events:

```
app/lib/consumers/
├── payments_transaction_succeeded/
│   ├── fulfill_order.liquid
│   └── send_receipt.liquid
└── payments_transaction_failed/
    └── notify_user.liquid
```

## Test Card

| Card Number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | Success |
| Any future expiry date | Valid |
| Any 3-digit CVC | Valid |
