# Events-Consumers Gotchas

## Common Errors and Solutions

This guide covers frequent issues when working with events and consumers, with causes and solutions.

## Error 1: Consumer Not Firing

### Symptom
You published an event but the consumer handler never executed.

### Common Causes

| Cause | Solution |
|-------|----------|
| **Wrong directory path** | Verify consumer is in `app/lib/consumers/<event_type>/<handler>.liquid` |
| **Typo in event type** | Event type in publish must exactly match directory name |
| **Missing handler file** | Create the `.liquid` file in the correct consumer directory |
| **File encoding issues** | Ensure file is UTF-8 encoded |
| **Consumer syntax error** | Check for Liquid syntax errors - they may prevent execution |

### Checklist

```
□ Event type matches consumer directory name exactly
  Publish: 'user_created'
  Directory: app/lib/consumers/user_created/

□ Consumer file exists and is named correctly
  Path: app/lib/consumers/user_created/send_email.liquid

□ File is in UTF-8 encoding with Unix line endings

□ Liquid syntax is valid (no unclosed tags)

□ Consumer directory structure is correct
  Parent directory: app/lib/consumers/
  Event type subdirectory: <event_type>/
  Handler file: <handler>.liquid
```

## Error 2: Wrong Directory Structure

### Symptom
"Consumer not found" or consumers don't execute.

### Incorrect Structure

```
WRONG:
app/lib/events/user_created/send_email.liquid
         ↑ consumers should not be here

WRONG:
app/consumers/user_created/send_email.liquid
     ↑ must be lib/consumers, not consumers

WRONG:
app/lib/consumers/user-created/send_email.liquid
                     ↑ use snake_case, not kebab-case
```

### Correct Structure

```
CORRECT:
app/lib/consumers/user_created/send_email.liquid
├── app/           ← application root
├── lib/           ← library directory
├── consumers/     ← exact directory name
├── user_created/  ← snake_case event type
└── send_email.liquid ← handler file
```

### Solution

1. Navigate to your application root
2. Verify directory path: `app/lib/consumers/<event_type>/`
3. Use **snake_case** for event types and handler names
4. No hyphens or camelCase in directory names

## Error 3: Accessing Stale Data

### Symptom
Consumer reads old data or data changes between publish and execution.

### Example Problem

```liquid
{%- comment -%}Handler publishes event with ID only{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: { id: user.id }
-%}

{%- comment -%}Consumer tries to fetch - data might have changed{%- endcomment -%}
{%- graphql -%}
  query {
    user(id: {{ event.object.id | json }}) {
      id
      email
      status
    }
  }
{%- endgraphql -%}

{%- comment -%}What if user was deleted or modified?{%- endcomment -%}
```

### Solution

**Include all needed data in event object:**

```liquid
{%- comment -%}Publish with complete snapshot{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      status: user.status,
      created_at: user.created_at
    }
-%}

{%- comment -%}Consumer uses published data, not fetched{%- endcomment -%}
{%- assign user_email = event.object.email -%}
{%- assign user_status = event.object.status -%}
```

### Rule of Thumb

- **Publish:** Include all data the consumer needs
- **Consume:** Use `event.object` data, avoid refetching

## Error 4: Unhandled Consumer Errors

### Symptom
One consumer fails silently; other consumers affected or don't execute.

### Problem

```liquid
{%- comment -%}Unhandled error in consumer{%- endcomment -%}
{%- graphql -%}
  mutation {
    send_email(input: {
      to: event.object.email
    }) {
      result {
        success
      }
    }
  }
{%- endgraphql -%}

{%- comment -%}If email service is down, this fails and consumer stops{%- endcomment -%}
```

### Solution

**Implement error handling:**

```liquid
{%- assign email_result = '' -%}

{%- capture email_result -%}
  {%- graphql -%}
    mutation {
      send_email(input: {
        to: {{ event.object.email | json }}
      }) {
        result {
          success
          message
        }
      }
    }
  {%- endgraphql -%}
{%- endcapture -%}

{%- if g.send_email.result.success -%}
  {%- comment -%}Success: continue{%- endcomment -%}
{%- else -%}
  {%- comment -%}Failure: log it but don't break consumer{%- endcomment -%}
  {%- graphql -%}
    mutation {
      error_log_create(input: {
        message: "Failed to send email"
        consumer: "user_created/send_welcome_email"
        reason: {{ g.send_email.result.message | json }}
      }) {
        error_log { id }
      }
    }
  {%- endgraphql -%}
{%- endif -%}
```

## Error 5: Consumer Order Dependency

### Symptom
Consumers depend on each other executing in a specific order.

### Problem

```liquid
{%- comment -%}Consumer 1: send_email.liquid
Runs before inventory update finishes{%- endcomment -%}

{%- comment -%}Consumer 2: update_inventory.liquid
Hasn't run yet, inventory not updated{%- endcomment -%}

{%- comment -%}
Result: Email says "Order confirmed"
but inventory hasn't been decremented yet
{%- endcomment -%}
```

### Solution

**Include all necessary data in the event:**

```liquid
{%- comment -%}Single consumer for coordinated actions{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'order_created',
    object: {
      id: order.id,
      items: order.items,
      customer_email: customer.email,
      total: order.total
    }
-%}

{%- comment -%}One consumer handles email + inventory{%- endcomment -%}
{%- comment -%}File: app/lib/consumers/order_created/complete_order.liquid{%- endcomment -%}

{%- comment -%}Send email{%- endcomment -%}
{%- include 'modules/core/commands/mail/send',
    to: event.object.customer_email,
    template: 'order_confirmation'
-%}

{%- comment -%}Update inventory{%- endcomment -%}
{%- for item in event.object.items -%}
  {%- comment -%}Decrement inventory{%- endcomment -%}
{%- endfor -%}
```

**OR use job queues for sequential operations.**

## Platform Limits

Consumer behavior and limits vary by platform deployment:

| Aspect | Typical Limit | Notes |
|--------|---------------|-------|
| **Consumer timeout** | 30-60 seconds | Long operations may fail |
| **Max event object size** | 1-10 MB | Large payloads may be rejected |
| **Concurrent consumers** | Platform dependent | High volume may queue |
| **Event retention** | 24-48 hours | Old events may be purged |
| **Payload nesting depth** | No hard limit | Avoid excessive nesting |
| **Consumer file size** | No hard limit | Keep handlers focused |

**Action:** Check your platform documentation for specific limits.

## Troubleshooting Flowchart

```
Is consumer not executing?
│
├─ YES → Is the event published?
│        │
│        ├─ NO → Publish event first
│        │
│        └─ YES → Does consumer file exist?
│                 │
│                 ├─ NO → Create file at:
│                 │      app/lib/consumers/<event_type>/<handler>.liquid
│                 │
│                 └─ YES → Is directory structure correct?
│                          │
│                          ├─ NO → Fix path structure
│                          │      (check for typos, case sensitivity)
│                          │
│                          └─ YES → Is event type exact match?
│                                   │
│                                   ├─ NO → Fix event type name
│                                   │      Publish: 'user_created'
│                                   │      Directory: user_created/
│                                   │
│                                   └─ YES → Check consumer syntax
│                                            Run: liquid --check <file>
│
└─ Consumer is executing but producing wrong results?
   │
   ├─ Is event.object data complete?
   │  └─ Include full data snapshot in event
   │
   ├─ Is there unhandled error?
   │  └─ Add error handling/logging
   │
   ├─ Are multiple consumers conflicting?
   │  └─ Combine or use job queue
   │
   └─ Is data being fetched instead of used?
      └─ Use event.object, avoid refetching
```

## Debug Checklist

When consumers aren't working:

```
□ Verify event is being published
  Add logging: {%- comment -%}Event published: <event_type>{%- endcomment -%}

□ Check directory path is correct
  Expected: app/lib/consumers/<event_type>/<handler>.liquid

□ Verify event type matches directory name (exact case)
  Publish: 'user_created'
  Directory: consumer/user_created/

□ Check for Liquid syntax errors in consumer file
  Look for: unclosed tags, invalid filters, missing endcomments

□ Verify event.object contains required data
  Log in consumer: {%- assign data = event.object | json -%}

□ Check platform logs for consumer execution errors

□ Verify consumer has permission to execute GraphQL mutations

□ Test with simple consumer first (just logging)
```

## See Also

- [Events-Consumers Configuration](/references/events-consumers/configuration.md)
- [Events-Consumers API Reference](/references/events-consumers/api.md)
- [Events-Consumers Patterns](/references/events-consumers/patterns.md)
- [Events-Consumers Advanced](/references/events-consumers/advanced.md)
