# Emails and SMS Advanced Techniques

## Overview

Advanced patterns and techniques for sophisticated email and SMS workflows in platformOS.

## Webhook Integration for Delivery Status

Track email opens, clicks, and bounces using webhooks:

```liquid
---
handle: email_webhook_receiver
method: post
path: /webhooks/email-status
---

{% case request.body.event_type %}
  {% when 'email.opened' %}
    {% graphql update = 'update_email_opened'
      email_id: request.body.email_id,
      opened_at: request.body.timestamp
    %}
  {% when 'email.bounced' %}
    {% graphql mark_bounced = 'update_email_bounced'
      email_id: request.body.email_id,
      bounce_type: request.body.bounce_type
    %}
{% endcase %}
```

## Dynamic Template Selection

Choose templates based on user attributes:

```liquid
{% assign template_map = 'welcome_standard|welcome_premium|welcome_vip' | split: '|' %}
{% assign user_tier_index = user.tier_level | default: 0 %}
{% assign template_name = template_map[user_tier_index] %}

{% graphql result = 'send_email'
  template: template_name,
  to: user.email,
  data: user
%}
```

## Liquid Filters for Email Content

Create custom filters for email formatting:

```liquid
{% capture email_footer %}
  {% if user.locale == 'en' %}
    Best regards, The Team
  {% elsif user.locale == 'es' %}
    Saludos cordiales, El Equipo
  {% endif %}
{% endcapture %}

{{ email_footer }}
```

## Email Template Inheritance

Use Liquid includes for shared email sections:

```liquid
---
layout: 'mailer'
---

{% include 'emails/partials/header' %}

<h1>Welcome {{ data.user.name }}!</h1>

{% include 'emails/partials/footer' %}
```

## Complex Data Structures in Emails

Pass nested objects to templates:

```graphql
mutation SendOrderEmail($order_id: ID!) {
  email_send(
    template: "order_confirmation"
    to: "user@example.com"
    data: {
      order: {
        id: $order_id
        items: [
          { name: "Product A", price: 29.99, qty: 2 }
          { name: "Product B", price: 49.99, qty: 1 }
        ]
        total: 109.97
      }
    }
  ) {
    success
  }
}
```

Access in template:

```liquid
{% for item in data.order.items %}
  <tr>
    <td>{{ item.name }}</td>
    <td>{{ item.qty }}</td>
    <td>{{ item.price | pricify }}</td>
  </tr>
{% endfor %}
```

## Batch Email Processing

Process emails in bulk with event consumers:

```liquid
---
handle: batch_email_processor
source: scheduled
cron: '0 2 * * *'
---

{% graphql pending_users = 'get_pending_email_users' %}

{% for user in pending_users.users %}
  {% include 'modules/core/helpers/send_event',
    event: 'email/batch_send',
    payload: user.id
  %}
{% endfor %}
```

## A/B Testing Email Content

Create variants and track performance:

```graphql
mutation SendABTestEmail(
  $user_id: ID!
  $variant: String!
) {
  email_send(
    template: "newsletter_{{ variant }}"
    to: "user@example.com"
    data: {
      user_id: $user_id
      variant: $variant
      test_id: "nl_2024_01"
    }
  ) {
    success
  }
}
```

## SMS with Conversation Context

Maintain SMS conversation history:

```graphql
mutation SendContextualSMS(
  $phone: String!
  $conversation_id: ID!
) {
  sms_send(
    template: "contextual_reply"
    to: $phone
    data: {
      conversation_id: $conversation_id
      previous_context: "user_requested_support"
    }
  ) {
    success
  }
}
```

## Email Retry Logic

Implement retry mechanism for failed sends:

```liquid
---
handle: email_retry_consumer
events: ['email/send_failed']
---

{% assign retry_count = event.metadata.retry_count | default: 0 %}
{% if retry_count < 3 %}
  {% assign delay = 300 | times: retry_count %}
  {% graphql retry = 'retry_email_send'
    email_id: event.payload,
    delay: delay,
    retry_count: retry_count | plus: 1
  %}
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Common Patterns](./patterns.md)
- [Known Gotchas](./gotchas.md)
