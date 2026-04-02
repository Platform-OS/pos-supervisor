# modules/payments - Configuration

## Overview
The `modules/payments` is an optional module for processing payments via Stripe. It handles transactions, payment processing, webhooks, and event handling.

## Installation

### Install Payment Modules
Install both the core and Stripe integration modules:

```bash
pos-cli modules install payments
pos-cli modules install payments_stripe
```

### Verify Installation
Confirm modules are installed:

```bash
pos-cli modules list
# Should show:
# - payments
# - payments_stripe
```

## Stripe Configuration

### Set Stripe API Key
Configure your Stripe secret key as a constant:

```bash
pos-cli env set STRIPE_SK_KEY sk_live_xxxxx
```

Or in development:
```bash
pos-cli env set STRIPE_SK_KEY sk_test_xxxxx
```

### Test Stripe Credentials
Always test in development with test keys first:

```bash
# Development
STRIPE_SK_KEY=sk_test_xxxxx

# Production (after testing)
STRIPE_SK_KEY=sk_live_xxxxx
```

### Verify Configuration
Test your Stripe connection:

```liquid
{% graphql connection = 'modules/payments/queries/stripe/test_connection' %}
{% if connection_ok %}
  Stripe is properly configured
{% endif %}
```

## Stripe API Keys

### Finding Your Keys
1. Log in to Stripe Dashboard
2. Go to Developers > API Keys
3. Copy Secret Key (starts with `sk_`)
4. Never share or commit these keys

### Test vs Live Keys
```bash
# Test mode (development)
STRIPE_SK_KEY=sk_test_xxxxx

# Live mode (production)
STRIPE_SK_KEY=sk_live_xxxxx
```

## Webhook Configuration

### Register Webhook Endpoint
In Stripe Dashboard:
1. Go to Developers > Webhooks
2. Add endpoint: `https://yourdomain.com/modules/payments/webhooks/stripe`
3. Subscribe to events:
   - `charge.succeeded`
   - `charge.failed`
   - `charge.refunded`

### Verify Webhook Secret
```bash
pos-cli env set STRIPE_WEBHOOK_SECRET whsec_xxxxx
```

## Environment Setup

### Required Variables
```bash
STRIPE_SK_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### Optional Variables
```bash
STRIPE_CURRENCY=USD
STRIPE_TAX_RATE=0.08
STRIPE_STATEMENT_DESCRIPTOR=MY_APP
```

## See Also
- api.md - API endpoints and queries
- patterns.md - Common payment patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced configuration
