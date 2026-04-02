# Events-Consumers Configuration

## Overview

Events-Consumers in platformOS provide an asynchronous messaging system for handling side effects and decoupling business logic. This guide covers the directory structure, naming conventions, and configuration patterns.

## Directory Structure

```
app/
├── lib/
│   ├── events/
│   │   ├── user_created.liquid
│   │   ├── order_created.liquid
│   │   ├── payment_succeeded.liquid
│   │   └── [event_type].liquid
│   │
│   └── consumers/
│       ├── user_created/
│       │   ├── send_welcome_email.liquid
│       │   ├── create_user_profile.liquid
│       │   └── [handler].liquid
│       │
│       ├── order_created/
│       │   ├── send_order_confirmation.liquid
│       │   ├── update_inventory.liquid
│       │   └── [handler].liquid
│       │
│       └── [event_type]/
│           └── [handler].liquid
```

## Naming Conventions

### Event Type Naming

- Use **snake_case** for event type names
- Use **past tense** verbs to indicate completed actions
- Be **specific** about the resource and action

**Examples:**
- `user_created` (not: user_create, user_new, UserCreated)
- `order_cancelled` (not: order_cancel, cancel_order)
- `payment_succeeded` (not: payment_success, payment_complete)
- `inventory_low` (not: inventory_warning, low_stock)

### Consumer Handler Naming

- Use **snake_case** for handler names
- Name handlers by **their purpose**, not their type
- Use descriptive action verbs

**Examples:**
- `send_welcome_email.liquid` (not: email_handler.liquid, mail.liquid)
- `update_inventory.liquid` (not: inventory_sync.liquid, stock.liquid)
- `log_order_event.liquid` (not: logger.liquid, audit.liquid)
- `notify_admin.liquid` (not: notification.liquid)

## File Locations

### Event Definition Files

Location: `app/lib/events/`

Optional files that document or configure event schemas. Consumers automatically trigger when events are published with matching types.

### Consumer Handler Files

Location: `app/lib/consumers/<event_type>/<handler_name>.liquid`

Each consumer file:
- Processes one specific event type
- Handles one specific side effect or action
- Runs asynchronously after event publication
- Has access to `event.type` and `event.object`

## Consumer File Template

```liquid
{%- comment -%}
Consumer Handler Template
Location: app/lib/consumers/[event_type]/[handler].liquid
Triggered by: events.publish(type: '[event_type]', object: {...})
{%- endcomment -%}

{%- assign event_type = event.type -%}
{%- assign event_object = event.object -%}

{%- comment -%}
Handler logic here:
- Access event data via event.type and event.object
- Perform side effects (send emails, update records, log)
- Use try/catch for error handling
{%- endcomment -%}
```

## Multiple Consumers Per Event

Multiple consumer files can handle the same event type:

```
consumers/
└── user_created/
    ├── send_welcome_email.liquid      # Send email
    ├── create_user_profile.liquid     # Create profile record
    ├── trigger_onboarding.liquid      # Start onboarding sequence
    └── sync_crm.liquid                # Sync with external CRM
```

All handlers execute **asynchronously** and **independently**:
- Failure in one handler does not affect others
- Order of execution is not guaranteed
- Each handler should be self-contained

## Configuration Best Practices

### 1. Keep Consumers Focused

Each consumer should handle **one responsibility**:

```liquid
{%- comment -%}GOOD: Single responsibility{%- endcomment -%}
{%- comment -%}File: send_welcome_email.liquid{%- endcomment -%}
{%- include 'modules/core/commands/mail/send',
    to: event.object.email,
    template: 'welcome_email'
-%}
```

### 2. Use Descriptive Event Objects

Pass structured data when publishing events:

```liquid
{%- comment -%}Event publication with rich object{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: user -%}
```

### 3. Document Event Contracts

Use comments to specify expected event structure:

```liquid
{%- comment -%}
Expects event.object with properties:
- id: User ID (required)
- email: Email address (required)
- first_name: First name (optional)
- last_name: Last name (optional)
{%- endcomment -%}
```

## Performance Considerations

- Consumers run **asynchronously** - they don't block the original request
- **Execution time limit**: Check platform limits for async handlers
- Heavy operations (batch processing) should be queued to jobs, not consumers
- Consider batching multiple updates into single queries

## See Also

- [Events-Consumers API](/references/events-consumers/api.md)
- [Events-Consumers Patterns](/references/events-consumers/patterns.md)
- [Events-Consumers Gotchas](/references/events-consumers/gotchas.md)
- Core Module Events: `modules/core/commands/events/publish`
