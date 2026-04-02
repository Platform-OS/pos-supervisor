# Events-Consumers Advanced Topics

## Event-Driven Architecture Principles

### Overview

Events provide the foundation for a loosely coupled, scalable architecture where components communicate asynchronously.

### Key Principles

**1. Separation of Concerns**

Keep event publication separate from consumer logic:

```liquid
{%- comment -%}Page/action handler: Only publishes{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_registered',
    object: new_user
-%}

{%- comment -%}Consumer: Only consumes and acts{%- endcomment -%}
{%- comment -%}File: app/lib/consumers/user_registered/send_email.liquid{%- endcomment -%}
{%- include 'modules/core/commands/mail/send',
    to: event.object.email,
    template: 'welcome'
-%}
```

**2. Single Responsibility**

Each consumer handles one action:

```
consumers/
└── order_created/
    ├── send_order_confirmation.liquid      ← Email only
    ├── update_inventory.liquid              ← Inventory only
    ├── trigger_fulfillment.liquid           ← Fulfillment only
    └── log_event.liquid                     ← Logging only
```

**3. Event Immutability**

Events represent immutable facts about what happened:

```liquid
{%- comment -%}Event: Historical record of state at publication time{%- endcomment -%}
{%- assign event_snapshot = {
  id: order.id,
  total: order.total,
  items_count: order.items.size,
  created_at: 'now' | date: '%Y-%m-%dT%H:%M:%SZ'
} -%}

{%- include 'modules/core/commands/events/publish',
    type: 'order_created',
    object: event_snapshot
-%}
```

### Benefits

- **Scalability:** Add consumers without modifying publishers
- **Testability:** Each consumer can be tested independently
- **Maintainability:** Changes to one consumer don't affect others
- **Flexibility:** Easy to add new features via new consumers

## Consumer Ordering and Sequencing

### Default Behavior

By design, consumer execution order is **not guaranteed**:

```liquid
{%- comment -%}These three may execute in ANY order{%- endcomment -%}
consumers/order_created/
├── send_confirmation.liquid      ← May run 3rd
├── update_inventory.liquid        ← May run 1st
└── trigger_fulfillment.liquid     ← May run 2nd
```

### When Order Matters

Use a **coordinating consumer** to handle dependent actions:

```liquid
{%- comment -%}
File: app/lib/consumers/order_created/orchestrate.liquid
This consumer coordinates all dependent operations
{%- endcomment -%}

{%- comment -%}Step 1: Update inventory{%- endcomment -%}
{%- graphql -%}
  mutation {
    inventory_decrement(input: {
      items: {{ event.object.items | json }}
      order_id: {{ event.object.id | json }}
    }) {
      inventory {
        id
        available
      }
    }
  }
{%- endgraphql -%}

{%- if g.inventory_decrement -%}
  {%- comment -%}Step 2: Send confirmation email{%- endcomment -%}
  {%- include 'modules/core/commands/mail/send',
      to: event.object.customer_email,
      template: 'order_confirmed'
  -%}

  {%- comment -%}Step 3: Trigger fulfillment{%- endcomment -%}
  {%- include 'modules/core/commands/events/publish',
      type: 'order_ready_for_fulfillment',
      object: event.object
  -%}
{%- endif -%}
```

### Using Job Queues for Sequencing

For complex workflows with strict ordering, use job queues:

```liquid
{%- comment -%}
Publisher: Queue a job instead of publishing event
Job handler: Executes steps sequentially
{%- endcomment -%}

{%- include 'modules/core/commands/jobs/enqueue',
    job: 'process_order',
    args: {
      order_id: order.id,
      priority: 'high',
      steps: [
        'decrement_inventory',
        'process_payment',
        'send_confirmation',
        'start_fulfillment'
      ]
    }
-%}
```

## Error Recovery Patterns

### Pattern 1: Dead Letter Consumer

Capture failures for manual review:

```liquid
{%- comment -%}
File: app/lib/consumers/any_event/dead_letter.liquid
Executes when other consumers fail
{%- endcomment -%}

{%- graphql -%}
  mutation {
    dead_letter_create(input: {
      event_type: {{ event.type | json }}
      event_data: {{ event.object | json }}
      timestamp: "{{ 'now' | date: '%Y-%m-%dT%H:%M:%SZ' }}",
      status: 'pending_review'
    }) {
      dead_letter {
        id
      }
    }
  }
{%- endgraphql -%}

{%- comment -%}Alert admin{%- endcomment -%}
{%- include 'modules/core/commands/mail/send',
    to: settings.admin_email,
    template: 'dead_letter_alert',
    variables: {
      event_type: event.type,
      event_id: g.dead_letter_create.dead_letter.id
    }
-%}
```

### Pattern 2: Retry with Exponential Backoff

Use job queue for automatic retries:

```liquid
{%- comment -%}
Publisher: Enqueue job with retry config
{%- endcomment -%}

{%- include 'modules/core/commands/jobs/enqueue',
    job: 'send_notification',
    args: {
      user_id: user.id,
      message: message
    },
    retry: {
      attempts: 3,
      backoff_strategy: 'exponential',
      backoff_seconds: 60
    }
-%}

{%- comment -%}
Consumer (running as job):
Automatic retries on failure
{%- endcomment -%}
```

### Pattern 3: Partial Failure Handling

Handle partial success in multi-step consumers:

```liquid
{%- comment -%}
File: app/lib/consumers/user_created/setup_profile.liquid
Handles partial failures gracefully
{%- endcomment -%}

{%- assign results = '' | split: '' -%}

{%- comment -%}Try to create profile{%- endcomment -%}
{%- graphql -%}
  mutation {
    user_profile_create(input: {
      user_id: {{ event.object.id | json }}
    }) {
      user_profile {
        id
      }
      errors {
        message
      }
    }
  }
{%- endgraphql -%}

{%- if g.user_profile_create.user_profile -%}
  {%- assign profile_created = true -%}
{%- else -%}
  {%- assign profile_created = false -%}
  {%- comment -%}Log but continue{%- endcomment -%}
{%- endif -%}

{%- comment -%}Try to send welcome email{%- endcomment -%}
{%- if event.object.email -%}
  {%- capture email_result -%}
    {%- include 'modules/core/commands/mail/send',
        to: event.object.email,
        template: 'welcome'
    -%}
  {%- endcapture -%}

  {%- if email_result -%}
    {%- assign email_sent = true -%}
  {%- else -%}
    {%- assign email_sent = false -%}
  {%- endif -%}
{%- endif -%}

{%- comment -%}Log results{%- endcomment -%}
{%- graphql -%}
  mutation {
    event_outcome_log_create(input: {
      event_type: {{ event.type | json }}
      user_id: {{ event.object.id | json }}
      profile_created: {{ profile_created }}
      email_sent: {{ email_sent }}
      timestamp: "{{ 'now' | date: '%Y-%m-%dT%H:%M:%SZ' }}"
    }) {
      event_outcome_log {
        id
      }
    }
  }
{%- endgraphql -%}
```

## Testing Consumers

### Unit Testing Pattern

Test consumers independently with mocked event data:

```liquid
{%- comment -%}
Test file: test/consumers/user_created/send_welcome_email_test.liquid
{%- endcomment -%}

{%- comment -%}Mock event data{%- endcomment -%}
{%- assign mock_event = {
  type: 'user_created',
  object: {
    id: '123',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User'
  }
} -%}

{%- comment -%}Include consumer with mock event{%- endcomment -%}
{%- assign event = mock_event -%}
{%- include 'app/lib/consumers/user_created/send_welcome_email' -%}

{%- comment -%}Verify expected behavior{%- endcomment -%}
{%- if g.mail_send -%}
  Test PASSED: Email sent to {{ mock_event.object.email }}
{%- else -%}
  Test FAILED: Email not sent
{%- endif -%}
```

### Integration Testing Pattern

Test events end-to-end in test environment:

```liquid
{%- comment -%}
Integration test: Publish event and verify consumer execution
{%- endcomment -%}

{%- graphql -%}
  mutation {
    test_user_create(input: {
      email: "test@example.com"
      first_name: "Test"
    }) {
      user {
        id
        email
      }
    }
  }
{%- endgraphql -%}

{%- assign test_user = g.test_user_create.user -%}

{%- comment -%}Publish event{%- endcomment -%}
{%- include 'modules/core/commands/events/publish',
    type: 'user_created',
    object: test_user
-%}

{%- comment -%}Wait for async processing{%- endcomment -%}
{%- comment -%}Note: Timing depends on platform{%- endcomment -%}

{%- comment -%}Verify consumer results{%- endcomment -%}
{%- graphql -%}
  query {
    email_logs(first: 1, filter: { recipient: {{ test_user.email | json }} }) {
      edges {
        node {
          id
          template
          status
        }
      }
    }
  }
{%- endgraphql -%}

{%- if g.email_logs.edges -%}
  Test PASSED: Consumer executed and sent email
{%- else -%}
  Test FAILED: No email sent
{%- endif -%}
```

## Complex Event Chains

### Scenario: Multi-Step Workflow

```
user_registered
    ↓
[create_profile consumer]
    ↓
profile_created
    ↓
[send_onboarding consumer]
    ↓
onboarding_started
    ↓
[create_trial_subscription consumer]
    ↓
subscription_created
```

### Implementation

**Step 1: Initial event**

```liquid
{%- include 'modules/core/commands/events/publish',
    type: 'user_registered',
    object: new_user
-%}
```

**Step 2: First consumer publishes next event**

```liquid
{%- comment -%}
File: app/lib/consumers/user_registered/create_profile.liquid
{%- endcomment -%}

{%- graphql -%}
  mutation {
    user_profile_create(input: {
      user_id: {{ event.object.id | json }}
    }) {
      user_profile {
        id
        user_id
      }
    }
  }
{%- endgraphql -%}

{%- if g.user_profile_create.user_profile -%}
  {%- include 'modules/core/commands/events/publish',
      type: 'profile_created',
      object: g.user_profile_create.user_profile
  -%}
{%- endif -%}
```

**Caution:** Chain depth impacts:
- Debugging complexity increases exponentially
- Error tracking becomes harder
- Total execution time accumulates
- Cascading failures possible

**Recommendation:** Limit chains to 2-3 levels; use jobs for longer workflows.

## Performance Optimization

### 1. Batch Operations in Consumers

Instead of looping with individual mutations:

```liquid
{%- comment -%}AVOID: Loop with individual mutations{%- endcomment -%}
{%- for item in event.object.items -%}
  {%- graphql -%}
    mutation {
      inventory_update(input: {
        product_id: {{ item.product_id | json }}
        quantity: -{{ item.quantity }}
      }) {
        inventory { id }
      }
    }
  {%- endgraphql -%}
{%- endfor -%}

{%- comment -%}GOOD: Batch update in single mutation{%- endcomment -%}
{%- graphql -%}
  mutation {
    inventory_batch_update(input: {
      updates: {{ event.object.items | json }}
    }) {
      inventories {
        id
        available
      }
    }
  }
{%- endgraphql -%}
```

### 2. Minimize External API Calls

Reduce outbound requests:

```liquid
{%- comment -%}AVOID: Multiple external calls{%- endcomment -%}
{%- for notification in notifications -%}
  Call external API for each notification
{%- endfor -%}

{%- comment -%}GOOD: Batch external requests{%- endcomment -%}
{%- include 'services/notification_service/batch_notify',
    notifications: notifications
-%}
```

### 3. Use Event Object Data First

Avoid unnecessary queries:

```liquid
{%- comment -%}Event object has all needed data{%- endcomment -%}
{%- assign user_email = event.object.email -%}
{%- assign user_name = event.object.first_name -%}

{%- comment -%}No refetch needed{%- endcomment -%}
{%- comment -%}Only fetch if you need data NOT in event{%- endcomment -%}
```

## Monitoring and Observability

### Event Tracking Pattern

```liquid
{%- comment -%}
Log all events for monitoring/debugging
{%- endcomment -%}

{%- graphql -%}
  mutation {
    event_tracking_create(input: {
      event_type: {{ event.type | json }}
      timestamp: "{{ 'now' | date: '%Y-%m-%dT%H:%M:%SZ' }}",
      object_id: {{ event.object.id | json }}
      object_type: {{ event.object.type | json }}
    }) {
      event_tracking {
        id
      }
    }
  }
{%- endgraphql -%}
```

### Metrics to Track

```
- Event publication rate (events/minute)
- Consumer success rate (%)
- Consumer average execution time (ms)
- Consumer failure rate (%)
- Consumer timeout rate (%)
- Event queue depth (pending events)
- Dead letter queue size
```

## See Also

- [Events-Consumers Configuration](/references/events-consumers/configuration.md)
- [Events-Consumers API Reference](/references/events-consumers/api.md)
- [Events-Consumers Patterns](/references/events-consumers/patterns.md)
- [Events-Consumers Gotchas](/references/events-consumers/gotchas.md)
