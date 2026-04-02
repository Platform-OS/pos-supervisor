# Background Jobs - Configuration

## Overview

The `{% background %}` tag enables asynchronous job execution in platformOS. Jobs run outside the immediate request-response cycle, allowing you to defer expensive operations and improve application responsiveness.

## Basic Syntax

### Inline Code

```liquid
{% background delay: 0, priority: 'default', max_attempts: 1, source_name: 'job_name' %}
  {% assign username = user.name %}
  {% log "User: " | append: username %}
{% endbackground %}
```

### Calling a Partial

```liquid
{% background delay: 5, priority: 'high', max_attempts: 3, source_name: 'send_email' %}
  {% include 'emails/welcome', user: user, email: user.email %}
{% endbackground %}
```

## Parameters

### delay
- **Type**: Float
- **Unit**: Minutes
- **Default**: 0
- **Description**: Time to wait before executing the job
- **Example**: `delay: 2.5` schedules job 2.5 minutes from now

### priority
- **Type**: String
- **Allowed Values**: `low`, `default`, `high`
- **Default**: `default`
- **Description**: Job execution priority in queue
- **Behavior**: High-priority jobs execute before low-priority ones
- **Note**: Don't overuse high priority to avoid queue congestion

### max_attempts
- **Type**: Integer
- **Range**: 1–5
- **Default**: 1
- **Description**: Maximum retry attempts if job fails
- **Behavior**: Job runs once by default; retries on failure up to max_attempts times
- **Backoff**: Automatic exponential backoff between retries

### source_name
- **Type**: String
- **Default**: Generated automatically if omitted
- **Description**: Identifier for the job in logs and monitoring
- **Best Practice**: Use descriptive, snake_case names (e.g., `send_welcome_email`, `generate_report`)
- **Tip**: Helps with debugging and job tracking via `pos-cli logs`

## Scope Limitations

Background jobs execute in a **limited scope**. They cannot access:
- Request context (params, cookies, sessions)
- Current user session
- HTTP headers
- Browser state

### Passing Variables

Variables must be explicitly passed to background jobs:

```liquid
{% background source_name: 'process_order' %}
  {% assign order_id = order.id %}
  {% assign customer_email = order.customer.email %}

  Order ID: {{ order_id }}
  Email: {{ customer_email }}
{% endbackground %}
```

Assign variables inside the block before using them in included partials.

## Partial Inclusion

```liquid
{% background delay: 1, source_name: 'send_notification' %}
  {% include 'notifications/email',
    recipient_id: user.id,
    message: "Your order has shipped",
    order_id: order.id %}
{% endbackground %}
```

**Key Points**:
- Pass required data as partial parameters
- Partial executes with passed parameters, not parent scope
- Included partials inherit job configuration

## Error Handling

Jobs that encounter errors will retry based on `max_attempts`:

```liquid
{% background max_attempts: 3, source_name: 'risky_operation' %}
  {% include 'operations/external-api-call', endpoint: 'https://api.example.com' %}
{% endbackground %}
```

Failed jobs after max retries generate log entries visible in `pos-cli logs`.

## Performance Considerations

- Jobs are non-blocking; response returns immediately
- No guarantee of execution order for same-priority jobs
- Execution latency depends on queue load and delay value
- Use appropriate priority levels to manage queue efficiently

## Examples

### Send Email in Background

```liquid
{% background delay: 0, priority: 'default', max_attempts: 2, source_name: 'send_welcome_email' %}
  {% include 'emails/welcome', user_id: user.id, email: user.email %}
{% endbackground %}
```

### Delayed Report Generation

```liquid
{% background delay: 60, priority: 'low', max_attempts: 1, source_name: 'generate_monthly_report' %}
  {% include 'reports/monthly', account_id: account.id %}
{% endbackground %}
```

### High-Priority Task with Retries

```liquid
{% background priority: 'high', max_attempts: 5, source_name: 'critical_sync' %}
  {% include 'integrations/sync-data', tenant_id: context.tenant.id %}
{% endbackground %}
```

## See Also

- [Background Jobs - API](./api.md)
- [Background Jobs - Patterns](./patterns.md)
- [Background Jobs - Gotchas](./gotchas.md)
- [Background Jobs - Advanced](./advanced.md)
- [pos-cli logs Documentation](../../commands/logs.md)
- [Events & Consumers](../../events-consumers/index.md)
