# Emails and SMS Patterns

## Overview

Common patterns and best practices for implementing emails and SMS in platformOS applications.

## Asynchronous Email Delivery via Events

The recommended pattern uses events and consumers for non-blocking email delivery:

```liquid
{% if user.email %}
  {% include 'modules/core/helpers/send_event',
    event: 'user/welcome',
    payload: user.id
  %}
{% endif %}
```

Create an event consumer in `app/events/user_welcome_event_consumer.liquid`:

```liquid
---
handle: user_welcome_event_consumer
events: ['user/welcome']
---

{% graphql result = 'send_welcome_email'
  user_id: event.payload
%}
```

GraphQL query in `app/graphql/send_welcome_email.graphql`:

```graphql
mutation SendWelcomeEmail($user_id: ID!) {
  user(id: $user_id) {
    id
    email
    name
    email_send(template: "welcome") {
      success
    }
  }
}
```

## Conditional Email Sending

Send different emails based on user context:

```liquid
{% if user.type == 'premium' %}
  {% include 'modules/core/helpers/send_event',
    event: 'premium_user/notification',
    payload: user.id
  %}
{% else %}
  {% include 'modules/core/helpers/send_event',
    event: 'user/notification',
    payload: user.id
  %}
{% endif %}
```

## Flash Messages with Redirect

Send flash message while redirecting:

```liquid
{% include 'modules/core/helpers/redirect_to',
  url: '/dashboard',
  notice: 'user.welcome_sent'
%}
```

Renders localized flash message on next request.

## Transactional SMS Pattern

Send verification codes via SMS:

```liquid
{% assign code = '' | random_string: 6, 'numeric' %}
{% assign ttl = 'now' | date: '%s' | plus: 600 %}

{% graphql result = 'create_verification'
  code: code,
  ttl: ttl,
  phone: user.phone
%}

{% graphql sms = 'send_sms'
  phone: user.phone,
  code: code
%}
```

## Scheduled Email Dispatch

Schedule emails with delay parameter:

```graphql
mutation ScheduleEmail {
  email_send(
    template: "reminder"
    to: "user@example.com"
    data: { action_required: true }
    delay: 86400
  ) {
    success
  }
}
```

Delays email by 24 hours (86400 seconds).

## Multi-Language Emails

Support multiple language templates:

```liquid
{% assign lang = user.preferred_language | default: 'en' %}
{% assign template_name = 'welcome_' | append: lang %}

{% graphql result = 'send_email'
  template: template_name,
  to: user.email
%}
```

Create separate templates: `welcome_en.liquid`, `welcome_es.liquid`, etc.

## Email Queuing Pattern

Queue emails for batch processing:

```graphql
mutation QueueEmail($user_id: ID!) {
  model_create(
    model: {
      model_name: "email_queue"
      properties: {
        user_id: $user_id
        template: "batch_notification"
        status: "pending"
        created_at: "now"
      }
    }
  ) {
    success
  }
}
```

Process queue with scheduled event consumer.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Known Gotchas](./gotchas.md)
- [Advanced Techniques](./advanced.md)
