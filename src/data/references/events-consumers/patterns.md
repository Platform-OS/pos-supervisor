# Events-Consumers Patterns

## Common Use Case Patterns

This guide covers proven patterns for using events and consumers effectively in platformOS applications.

## Pattern 1: Post-Action Email Sending

Send emails asynchronously after important actions without blocking the user request.

### Setup

**Event Publication** (in action handler or GraphQL mutation):

```liquid
{%- graphql -%}
  mutation {
    user_create(input: {
      email: {{ new_email | json }}
      first_name: {{ first_name | json }}
    }) {
      user {
        id
        email
        first_name
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

**Consumer Handler** (`app/lib/consumers/user_created/send_welcome_email.liquid`):

```liquid
{%- assign user_email = event.object.email -%}
{%- assign user_name = event.object.first_name -%}

{%- include 'modules/core/commands/mail/send',
    to: user_email,
    template: 'welcome_email',
    variables: {
      user_name: user_name,
      user_id: event.object.id
    }
-%}
```

### Benefits

- User doesn't wait for email delivery
- Email failures don't break user-facing request
- Can retry email sending independently
- Scales well with high user volume

## Pattern 2: Audit Logging

Record significant events for compliance and debugging.

### Consumer Handler** (`app/lib/consumers/any_event/audit_log.liquid`):

```liquid
{%- comment -%}
Generic audit logging consumer
Responds to: all events
{%- endcomment -%}

{%- assign log_entry = {
  event_type: event.type,
  event_timestamp: 'now' | date: '%Y-%m-%d %H:%M:%S',
  object_id: event.object.id,
  object_type: event.object.type,
  user_id: event.object.user_id,
  ip_address: event.object.ip_address,
  changes: event.object
} -%}

{%- graphql -%}
  mutation {
    audit_log_create(input: {
      event_type: {{ event.event_type | json }}
      event_data: {{ log_entry | json }}
      created_at: "{{ 'now' | date: '%Y-%m-%dT%H:%M:%SZ' }}"
    }) {
      audit_log {
        id
      }
    }
  }
{%- endgraphql -%}
```

### Benefits

- Centralized event logging
- No impact on primary operation
- Easy to query event history
- Compliant audit trail

## Pattern 3: Inventory Updates

Synchronize inventory asynchronously when orders are created or cancelled.

### Event Publication** (after order creation):

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'order_created',
    object: {
      id: order.id,
      items: order.items,
      status: 'confirmed'
    }
-%}
```

### Consumer Handler** (`app/lib/consumers/order_created/update_inventory.liquid`):

```liquid
{%- comment -%}
Update inventory when order is created
Decrements available stock for ordered items
{%- endcomment -%}

{%- assign order_items = event.object.items -%}

{%- for item in order_items -%}
  {%- graphql -%}
    mutation {
      inventory_update(input: {
        product_id: {{ item.product_id | json }}
        quantity_change: -{{ item.quantity }}
        reason: "order_created"
        order_id: {{ event.object.id | json }}
      }) {
        inventory {
          id
          available_quantity
        }
      }
    }
  {%- endgraphql -%}
{%- endfor -%}
```

### Pattern 4: Chaining Events

Consumers can publish new events to create event chains.

### Scenario: Order → Payment → Fulfillment Chain

**Consumer 1** (`app/lib/consumers/order_created/request_payment.liquid`):

```liquid
{%- comment -%}
Process payment for new order
On success, publish payment_succeeded event
{%- endcomment -%}

{%- graphql -%}
  mutation {
    payment_process(input: {
      order_id: {{ event.object.id | json }}
      amount: {{ event.object.total | json }}
    }) {
      payment {
        id
        status
      }
    }
  }
{%- endgraphql -%}

{%- if g.payment_process.payment.status == 'succeeded' -%}
  {%- include 'modules/core/commands/events/publish',
      type: 'payment_succeeded',
      object: g.payment_process.payment
  -%}
{%- endif -%}
```

**Consumer 2** (`app/lib/consumers/payment_succeeded/start_fulfillment.liquid`):

```liquid
{%- comment -%}
Start fulfillment when payment succeeds
{%- endcomment -%}

{%- graphql -%}
  mutation {
    fulfillment_create(input: {
      order_id: {{ event.object.order_id | json }}
      status: 'pending'
    }) {
      fulfillment {
        id
      }
    }
  }
{%- endgraphql -%}

{%- include 'modules/core/commands/events/publish',
    type: 'fulfillment_started',
    object: g.fulfillment_create.fulfillment
-%}
```

### Caution

- Event chains can become difficult to debug
- Keep chains to 2-3 levels maximum
- Consider using jobs for complex workflows
- Always handle error scenarios in chains

## Pattern 5: Error Handling in Consumers

Gracefully handle errors without breaking other consumers.

### Try-Catch Pattern** (`app/lib/consumers/user_created/notify_admin.liquid`):

```liquid
{%- comment -%}
Notify admin of user creation
Includes error handling to prevent consumer failure
{%- endcomment -%}

{%- assign admin_email = settings.admin_email -%}

{%- if admin_email -%}
  {%- capture result -%}
    {%- include 'modules/core/commands/mail/send',
        to: admin_email,
        template: 'new_user_notification',
        variables: event.object
    -%}
  {%- endcapture -%}

  {%- if result contains 'error' -%}
    {%- comment -%}
    Log the error but don't fail the consumer
    {%- endcomment -%}
    {%- graphql -%}
      mutation {
        error_log_create(input: {
          message: "Failed to notify admin of user creation"
          consumer: "user_created/notify_admin"
          user_id: {{ event.object.id | json }}
          error: {{ result | json }}
        }) {
          error_log {
            id
          }
        }
      }
    {%- endgraphql -%}
  {%- endif -%}
{%- endif -%}
```

### Benefits

- Prevents one failure from affecting entire event chain
- Enables logging and monitoring of consumer errors
- Allows graceful degradation
- Supports error recovery strategies

## Common Event Naming Conventions

### Resource Creation Events

```
[resource]_created
├── user_created
├── order_created
├── product_created
└── subscription_created
```

### Resource Modification Events

```
[resource]_updated
├── user_updated (profile changes)
├── order_updated (status changes)
└── settings_updated
```

### State Transition Events

```
[resource]_[past_state]_to_[new_state]
├── order_pending_to_confirmed
├── payment_pending_to_succeeded
├── order_confirmed_to_shipped
└── subscription_active_to_cancelled
```

### Action Events

```
[verb]_[resource]
├── send_email
├── process_refund
├── trigger_notification
└── archive_record
```

### Status Events

```
[resource]_[status]
├── payment_succeeded
├── inventory_low
├── order_cancelled
└── user_verified
```

## Best Practices

### 1. Keep Events Immutable

Once published, event data should not change:

```liquid
{%- comment -%}GOOD: Snapshot of state at publish time{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'order_created',
    object: {
      id: order.id,
      total: order.total,
      customer_name: customer.name
    }
-%}
```

### 2. Document Event Contracts

Specify what data consumers expect:

```liquid
{%- comment -%}
Event: order_created
Required fields in event.object:
  - id (String): Order ID
  - total (Decimal): Order total
  - customer_id (String): Customer ID
  - items (Array): Order items with product_id and quantity

Optional fields:
  - notes (String): Order notes
  - shipping_address (Hash): Shipping details
{%- endcomment -%}
```

### 3. Use Descriptive Event Objects

Include all data consumers need:

```liquid
{%- comment -%}GOOD: Rich event object{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name
    }
-%}
```

### 4. Avoid Stale References

Don't rely on references to objects that might change:

```liquid
{%- comment -%}AVOID: Relying on re-fetching{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: { id: user.id }
-%}

{%- comment -%}GOOD: Include data snapshot{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: user
-%}
```

## See Also

- [Events-Consumers Configuration](/references/events-consumers/configuration.md)
- [Events-Consumers API Reference](/references/events-consumers/api.md)
- [Events-Consumers Gotchas](/references/events-consumers/gotchas.md)
- [Events-Consumers Advanced](/references/events-consumers/advanced.md)
