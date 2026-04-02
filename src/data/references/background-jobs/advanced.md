# Background Jobs - Advanced Techniques

## Retry Strategies

### Exponential Backoff

platformOS automatically implements exponential backoff between retries. The wait time increases with each attempt:

```liquid
{% background max_attempts: 5, source_name: 'unreliable_api' %}
  {% include 'integrations/flaky-service', endpoint: 'https://api.example.com' %}
{% endbackground %}
```

**Backoff Schedule** (approximate):
- Attempt 1: Initial execution
- Attempt 2: ~5 second wait
- Attempt 3: ~30 second wait
- Attempt 4: ~2 minute wait
- Attempt 5: ~10 minute wait

**When to Use**:
- External API integrations
- Database operations
- Network-dependent tasks

### Strategic Retry Configuration

```liquid
{% comment %} Critical operation - maximum retries {% endcomment %}
{% background max_attempts: 5, priority: 'high', source_name: 'payment_gateway' %}
  {% include 'payments/process-charge', order_id: order.id %}
{% endbackground %}

{% comment %} Standard operation - moderate retries {% endcomment %}
{% background max_attempts: 3, priority: 'default', source_name: 'send_email' %}
  {% include 'emails/transactional', user_id: user.id %}
{% endbackground %}

{% comment %} Non-critical - single attempt {% endcomment %}
{% background max_attempts: 1, priority: 'low', source_name: 'analytics_log' %}
  {% include 'analytics/track-event', event: 'page_view' %}
{% endbackground %}
```

### Detecting and Handling Failures

Monitor retry attempts in logs:

```bash
pos-cli logs | grep 'attempt'
```

Example output:
```
[attempt 1/3] - processing_order - FAILED
[attempt 2/3] - processing_order - FAILED
[attempt 3/3] - processing_order - SUCCESS
```

---

## Delayed Scheduling Patterns

### Staggered Job Execution

Execute jobs at intervals to prevent queue overload:

```liquid
{% for user in users_to_notify %}
  {% background delay: forloop.index, source_name: 'send_batch_email' %}
    {% assign delay_seconds = forloop.index | times: 60 %}
    {% include 'emails/bulk-notification', user_id: user.id %}
  {% endbackground %}
{% endfor %}
```

**Result**: Jobs spread across multiple minutes (1 minute per user).

### Time-Based Scheduling

Schedule jobs for specific times:

```liquid
{% assign now = 'now' | date: '%s' | plus: 0 %}
{% assign scheduled_time = scheduled_at | date: '%s' | plus: 0 %}
{% assign delay_seconds = scheduled_time | minus: now %}
{% assign delay_minutes = delay_seconds | divided_by: 60.0 %}

{% if delay_minutes > 0 %}
  {% background delay: delay_minutes, source_name: 'scheduled_notification' %}
    {% include 'notifications/send', message: message %}
  {% endbackground %}
{% endif %}
```

### Delayed Action Chains

Sequence operations with delays:

```liquid
{% comment %} Step 1: Process order immediately {% endcomment %}
{% background source_name: 'process_order' %}
  {% include 'orders/process', order_id: order.id %}
{% endbackground %}

{% comment %} Step 2: Send confirmation after 1 minute {% endcomment %}
{% background delay: 1, source_name: 'send_confirmation' %}
  {% include 'emails/order-confirmation', order_id: order.id %}
{% endbackground %}

{% comment %} Step 3: Follow-up after 24 hours {% endcomment %}
{% background delay: 1440, source_name: 'send_followup' %}
  {% include 'emails/order-followup', order_id: order.id %}
{% endbackground %}
```

(Note: For precise scheduling, consider external cron-based systems)

---

## Combining Background Jobs + Events

### Complementary Approaches

Use background jobs for fire-and-forget async tasks, events for event-driven workflows:

```liquid
{% comment %} Trigger event for all registered consumers {% endcomment %}
{% trigger_event 'order.created', order_id: order.id %}

{% comment %} Queue background job for specific async task {% endcomment %}
{% background delay: 5, source_name: 'send_order_confirmation' %}
  {% include 'emails/confirmation', order_id: order.id %}
{% endbackground %}
```

**Advantages**:
- Events notify all consumers
- Background job runs independently
- Decoupled architecture
- Full request context available in event handlers

### Complex Workflow Pattern

```liquid
{% comment %} Event triggers inventory sync (via consumer) {% endcomment %}
{% trigger_event 'order.created', order_id: order.id %}

{% comment %} Background job handles email (fire-and-forget) {% endcomment %}
{% background priority: 'default', source_name: 'send_email' %}
  {% include 'emails/order-notification', order_id: order.id %}
{% endbackground %}

{% comment %} Background job handles analytics (non-urgent) {% endcomment %}
{% background priority: 'low', source_name: 'track_conversion' %}
  {% include 'analytics/log-conversion', order_id: order.id %}
{% endbackground %}
```

---

## Monitoring and Debugging

### Structured Logging in Background Jobs

```liquid
{% background source_name: 'monitored_job' %}
  {% assign start_time = 'now' | date: '%s' %}

  Processing...

  {% assign end_time = 'now' | date: '%s' %}
  {% assign duration = end_time | minus: start_time %}

  {% log "Job completed in " | append: duration | append: " seconds" %}
{% endbackground %}
```

### Filtering Logs by Status

View only failed jobs:

```bash
pos-cli logs | grep 'FAILED'
```

View only successful jobs:

```bash
pos-cli logs | grep 'SUCCESS'
```

### Performance Analysis

Track job execution times:

```bash
pos-cli logs | grep 'send_email' | tail -20
```

Identify slow jobs:

```bash
pos-cli logs | grep 'attempt' | grep -E '[5-9]\d{2}ms|[1-9]\d{3}ms'
```

### Debugging Failed Jobs

When a job fails:

1. Check logs for error message:
   ```bash
   pos-cli logs --source-name='failing_job'
   ```

2. Review the included partial for syntax errors

3. Verify all parameters are passed correctly:
   ```liquid
   {% include 'email', user_id: user.id, email: user.email %}
   ```

4. Test the partial outside background context first

5. Increase `max_attempts` if failure is intermittent:
   ```liquid
   {% background max_attempts: 3, source_name: 'retry_job' %}
   ```

---

## Performance Tuning

### Queue Management

Balance priority distribution to prevent queue starvation:

```liquid
{% comment %} Don't create too many high-priority jobs {% endcomment %}
{% assign high_priority_count = 0 %}
{% for job in jobs %}
  {% if job.critical %}
    {% background priority: 'high', source_name: 'critical_' | append: job.id %}
      {% include 'processors/critical', job_id: job.id %}
    {% endbackground %}
    {% assign high_priority_count = high_priority_count | plus: 1 %}
  {% else %}
    {% background priority: 'default', source_name: 'standard_' | append: job.id %}
      {% include 'processors/standard', job_id: job.id %}
    {% endbackground %}
  {% endif %}
{% endfor %}
```

### Batch Processing Efficiency

Process multiple items efficiently:

```liquid
{% comment %} Batch 100 items into one job {% endcomment %}
{% assign batch_size = 100 %}
{% assign item_index = 0 %}

{% for item in large_collection %}
  {% assign item_index = item_index | plus: 1 %}

  {% if item_index == 1 %}
    {% capture batch_items %}[{{ item.id }}{% endcomment %}
  {% else %}
    {% capture batch_items %}{{ batch_items }},{{ item.id }}{% endcapture %}
  {% endif %}

  {% if item_index == batch_size or forloop.last %}
    {% background source_name: 'process_batch' %}
      {% include 'processors/batch-handler', item_ids: batch_items %}
    {% endbackground %}
    {% assign item_index = 0 %}
  {% endif %}
{% endfor %}
```

**Benefit**: Reduces job queue size and improves throughput.

### Delayed Batch Aggregation

Aggregate requests and process them together:

```liquid
{% comment %} Queue job 1 second in future (allows other jobs to be added) {% endcomment %}
{% background delay: 0.016, source_name: 'aggregated_batch' %}
  {% include 'processors/batch-all-pending-items' %}
{% endbackground %}
```

Allows requests in the next second to batch together before processing.

---

## Idempotency and Safety

### Idempotent Job Design

Design jobs to safely execute multiple times:

```liquid
{% background max_attempts: 3, source_name: 'idempotent_charge' %}
  {% include 'payments/charge-with-idempotency',
    order_id: order.id,
    idempotency_key: order.id | append: '-' | append: order.created_at %}
{% endbackground %}
```

**Pattern**: Use unique identifiers to prevent duplicate operations.

### State Verification

Check state before executing:

```liquid
{% background source_name: 'safe_state_change' %}
  {% include 'state-manager/update-if-needed',
    entity_id: entity.id,
    expected_state: 'pending',
    new_state: 'processing' %}
{% endbackground %}
```

The included partial verifies state hasn't changed before updating.

### Cleanup on Failure

Define cleanup actions:

```liquid
{% background max_attempts: 1, source_name: 'operation_with_cleanup' %}
  {% include 'operations/risky-operation',
    operation_id: operation.id,
    with_cleanup: true %}
{% endbackground %}
```

The partial includes cleanup logic in error handlers.

---

## Production Best Practices

### Source Name Convention

Use descriptive, hierarchical names:

```liquid
{% comment %} Good {% endcomment %}
{% background source_name: 'email_send_welcome' %}...{% endbackground %}
{% background source_name: 'payment_process_charge' %}...{% endbackground %}
{% background source_name: 'analytics_track_event' %}...{% endbackground %}

{% comment %} Avoid single words or auto-generated names {% endcomment %}
{% background source_name: 'job' %}...{% endcomment %} {% comment %} NOT DESCRIPTIVE {% endcomment %}
```

### Testing Jobs

Test partials in isolation before wrapping in background:

```liquid
{% comment %} Test in normal context first {% endcomment %}
{% include 'emails/welcome', user_id: 123, email: 'user@example.com' %}

{% comment %} Then wrap in background {% endcomment %}
{% background source_name: 'test_email' %}
  {% include 'emails/welcome', user_id: 123, email: 'user@example.com' %}
{% endbackground %}
```

### Monitoring Alerts

Set up alerts for failed jobs:

```bash
{% comment %} Monitor for consistent failures {% endcomment %}
pos-cli logs | grep 'FAILED' | grep 'send_email'
```

If pattern detected, investigate and fix.

---

## See Also

- [Background Jobs - Configuration](./configuration.md)
- [Background Jobs - API](./api.md)
- [Background Jobs - Patterns](./patterns.md)
- [Background Jobs - Gotchas](./gotchas.md)
- [pos-cli Reference](../../commands/pos-cli.md)
- [Events & Consumers](../../events-consumers/index.md)
- [Liquid Filters](../../liquid/filters/index.md)
