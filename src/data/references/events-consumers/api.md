# Events-Consumers API Reference

## Overview

The Events-Consumers API provides methods for publishing events and handling them asynchronously through consumer handlers. Events are published via the core module and automatically routed to matching consumers.

## Publishing Events

### modules/core/commands/events/publish

Publishes an event that triggers all matching consumer handlers asynchronously.

#### Syntax

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'event_type_string',
    object: object_or_hash
-%}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | String | Yes | Event type identifier (snake_case). Must match consumer directory names. |
| `object` | Object/Hash | Yes | Event data payload. Available to consumers via `event.object`. |

#### Examples

**Basic event publishing:**

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: new_user
-%}
```

**With inline object:**

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'order_created',
    object: {
      id: order.id,
      total: order.total,
      customer_id: customer.id,
      items: order.items
    }
-%}
```

**After model operation:**

```liquid
{%- graphql -%}
  mutation {
    user_create(input: {
      email: {{ user.email | json }}
      first_name: {{ user.first_name | json }}
    }) {
      user {
        id
        email
      }
    }
  }
{%- endgraphql -%}

{%- if g.user_create.user -%}
  {%- include 'modules/core/commands/events/publish',
      type: 'user_created',
      object: g.user_create.user
  -%}
{%- endif -%}
```

## Event Object Structure

### Event Data Access

Inside consumer handlers, two variables are available:

| Variable | Type | Description |
|----------|------|-------------|
| `event.type` | String | The event type that triggered this consumer |
| `event.object` | Object/Hash | The payload data published with the event |

### Example Event Object

When publishing:

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'order_created',
    object: {
      id: 12345,
      status: 'pending',
      total: '99.99',
      currency: 'USD',
      customer: {
        id: 456,
        email: 'customer@example.com'
      }
    }
-%}
```

Available in consumer:

```liquid
{%- comment -%}
event.type = 'order_created'
event.object.id = 12345
event.object.status = 'pending'
event.object.total = '99.99'
event.object.customer.email = 'customer@example.com'
{%- endcomment -%}
```

## Consumer Interface

### Consumer Handler Location

```
app/lib/consumers/<event_type>/<handler_name>.liquid
```

### Consumer Handler Context

When a consumer is executed, the following is available:

```liquid
{%- comment -%}
Available in consumer context:
- event.type (String): The event type
- event.object (Hash): The event payload
- All standard Liquid variables and filters
- All custom tags and includes from your app
- Context from the application at event time
{%- endcomment -%}
```

### Consumer Handler Template

```liquid
{%- comment -%}
Location: app/lib/consumers/order_created/send_order_confirmation.liquid
Triggered by: Publishing 'order_created' event
{%- endcomment -%}

{%- assign order_id = event.object.id -%}
{%- assign customer_email = event.object.customer.email -%}

{%- comment -%}
Handler logic:
- Perform side effects
- Send notifications
- Update secondary systems
- Log events
{%- endcomment -%}

{%- include 'modules/core/commands/mail/send',
    to: customer_email,
    template: 'order_confirmation',
    variables: event.object
-%}
```

### Multiple Handlers Per Event Type

All matching consumers execute asynchronously:

```
consumers/
└── payment_succeeded/
    ├── send_payment_receipt.liquid
    ├── update_order_status.liquid
    ├── trigger_fulfillment.liquid
    └── sync_accounting.liquid
```

All files execute when `payment_succeeded` event is published:

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'payment_succeeded',
    object: payment_record
-%}
```

## Context Available in Consumers

### User Context

Context variables depend on when the event was published:

```liquid
{%- comment -%}
If event published during user request:
- User context may be available
- Session variables may be accessible

If event published in background job:
- User context is NOT available
- Only event.object data is reliable
{%- endcomment -%}
```

### Accessing GraphQL

Consumers can execute GraphQL queries/mutations:

```liquid
{%- graphql -%}
  query {
    users(first: 1, filter: { id: {{ event.object.user_id | json }} }) {
      edges {
        node {
          id
          email
          first_name
        }
      }
    }
  }
{%- endgraphql -%}

{%- assign user = g.users.edges.first.node -%}
```

### Accessing Liquid Filters and Tags

All standard platformOS tags and filters are available:

```liquid
{%- assign formatted_date = event.object.created_at | date: '%Y-%m-%d' -%}
{%- assign email_valid = event.object.email | matches: '^.+@.+\..+$' -%}
```

## Event Processing Guarantees

### Asynchronous Execution

- Events are published **immediately**
- Consumer handlers execute **asynchronously**
- Original request **does not wait** for consumers
- Consumers **cannot block** the requesting operation

### Consumer Independence

- Each consumer handler is **independent**
- Failure in one handler **does not affect** others
- Order of execution is **not guaranteed**
- No built-in ordering between consumers

### Retry Behavior

Check platform documentation for:
- Consumer timeout limits
- Retry policies for failed consumers
- Dead letter queue behavior
- Event delivery guarantees

## See Also

- [Events-Consumers Configuration](/references/events-consumers/configuration.md)
- [Events-Consumers Patterns](/references/events-consumers/patterns.md)
- [Events-Consumers Gotchas](/references/events-consumers/gotchas.md)
- [Events-Consumers Advanced](/references/events-consumers/advanced.md)
- Core Module: `modules/core/commands/events/publish`
- Core Module: `modules/core/commands/mail/send`
