# Events & Consumers

Events decouple actions from side effects. A command publishes an event; consumers handle it asynchronously.

## Locations

- Events: `app/lib/events/`
- Consumers: `app/lib/consumers/`

## Publishing Events

```liquid
{% function _ = 'modules/core/commands/events/publish',
  type: 'order_created',
  object: order
%}
```

## Consumer Structure

Consumers are partials named after the event type, placed in a subdirectory matching the event name:

```
app/lib/consumers/
├── order_created/
│   ├── send_confirmation_email.liquid
│   └── update_inventory.liquid
├── user_session_created/
│   └── log_login.liquid
└── payment_succeeded/
    └── fulfill_order.liquid
```

## Consumer Example

```liquid
{% comment %} app/lib/consumers/order_created/send_confirmation_email.liquid {% endcomment %}
{% graphql _ = 'emails/send_order_confirmation',
  email: event.object.email,
  order_id: event.object.id
%}
```

## Event Object

Inside a consumer, `event` contains:
- `event.type` — the event type string
- `event.object` — the data object passed when publishing

## Common Event Patterns

| Event | Triggered When | Consumer Actions |
|-------|---------------|------------------|
| `user_created` | New user signs up | Send welcome email, create profile |
| `user_session_created` | User logs in | Log activity, update last_login |
| `order_created` | Order placed | Send confirmation, update stock |
| `payment_succeeded` | Payment confirmed | Fulfill order, send receipt |
| `payment_failed` | Payment failed | Notify user, log failure |

## Rules

- Events are asynchronous — consumers run in the background
- One event can have multiple consumers
- Use events for side effects (emails, logging, notifications)
- Keep consumer logic focused and small
