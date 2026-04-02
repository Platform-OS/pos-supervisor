# Background Jobs - API Reference

## Complete Tag Syntax

```liquid
{% background [delay: value] [priority: 'level'] [max_attempts: count] [source_name: 'name'] %}
  [job content]
{% endbackground %}
```

## Parameter Reference

### delay
```liquid
{% background delay: 0 %}...{% endbackground %}
```
- **Type**: Float
- **Unit**: Minutes
- **Default**: 0
- **Range**: 0 to 65535
- **Precision**: Supports fractional minutes (e.g., 0.5 = 30 seconds)

### priority
```liquid
{% background priority: 'default' %}...{% endbackground %}
```
- **Type**: String (quoted)
- **Values**: `'low'`, `'default'`, `'high'`
- **Default**: `'default'`
- **Behavior**: Affects job queue ordering; does not affect performance within a priority level

### max_attempts
```liquid
{% background max_attempts: 1 %}...{% endbackground %}
```
- **Type**: Integer
- **Range**: 1–5
- **Default**: 1
- **Behavior**: Total attempts = 1 (initial) + (max_attempts - 1) retries

| max_attempts | Initial | Retries | Total Runs |
|---|---|---|---|
| 1 | 1 | 0 | 1 |
| 2 | 1 | 1 | 2 |
| 3 | 1 | 2 | 3 |
| 5 | 1 | 4 | 5 |

### source_name
```liquid
{% background source_name: 'my_job_name' %}...{% endbackground %}
```
- **Type**: String (quoted)
- **Default**: Auto-generated (not recommended for production)
- **Format**: Alphanumeric, hyphens, underscores
- **Visibility**: Appears in `pos-cli logs` output for filtering and debugging

## Full API Example

```liquid
{% background delay: 2.5, priority: 'high', max_attempts: 3, source_name: 'process_payment' %}
  {% assign customer_id = order.customer_id %}
  {% assign amount = order.total %}

  Processing payment for customer {{ customer_id }}: ${{ amount }}
{% endbackground %}
```

## Calling Partials from Background

### Basic Partial Call

```liquid
{% background source_name: 'email_job' %}
  {% include 'emails/transactional', user_id: user.id, email: user.email %}
{% endbackground %}
```

### Partial with Multiple Parameters

```liquid
{% background max_attempts: 2, source_name: 'generate_invoice' %}
  {% include 'invoicing/create',
    order_id: order.id,
    customer_id: customer.id,
    amount: order.total,
    currency: 'USD' %}
{% endbackground %}
```

### Nested Includes

Partials called from background jobs can themselves include other partials:

```liquid
{% background source_name: 'complex_workflow' %}
  {% include 'workflows/multi-step',
    entity_id: entity.id,
    context: 'background_job' %}
{% endbackground %}
```

**Note**: All nested includes operate in the same limited background job scope.

## Accessing Variables in Background Jobs

### Direct Assignment

```liquid
{% background source_name: 'use_variables' %}
  {% assign username = user.name %}
  {% assign created_at = user.created_at %}

  User: {{ username }}
  Joined: {{ created_at }}
{% endbackground %}
```

### From Passed Parameters

```liquid
{% background source_name: 'param_job' %}
  {% include 'processor',
    data: my_collection,
    config: job_config %}
{% endbackground %}
```

### Available Context

Background jobs have access to:
- Model data passed explicitly via parameters
- Liquid variables assigned within the background block
- Filters and tags (standard Liquid)

Background jobs do **not** have access to:
- Request parameters (`params`)
- Session data (`context.current_user`)
- Cookies or headers
- Parent page variables (must be reassigned)

## Monitoring with pos-cli logs

### View All Job Logs

```bash
pos-cli logs
```

### Filter by Source Name

```bash
pos-cli logs | grep 'send_email'
```

### View Specific Job

```bash
pos-cli logs --source-name='process_payment'
```

### Monitor in Real-Time

```bash
pos-cli logs --tail
```

### Log Output Format

```
[2024-01-15 14:32:45] background job: send_email (attempt 1/2) - SUCCESS
[2024-01-15 14:32:50] background job: process_payment (attempt 1/3) - FAILED
[2024-01-15 14:32:55] background job: process_payment (attempt 2/3) - SUCCESS
```

## Error Scenarios

### Job Failure and Retry

```liquid
{% background max_attempts: 3, source_name: 'api_call' %}
  {% include 'integrations/external-api', endpoint: 'https://api.example.com' %}
{% endbackground %}
```

If the included partial fails:
1. Logs: "api_call (attempt 1/3) - FAILED"
2. Wait: Exponential backoff
3. Retry: Attempt 2/3 begins
4. If all attempts fail: Final failure logged

### Job Success

```liquid
{% background source_name: 'completed_job' %}
  Job execution completes successfully
{% endbackground %}
```

Logs: "completed_job (attempt 1/1) - SUCCESS"

## Constraints

| Constraint | Value |
|---|---|
| Max Parameters | 20 |
| Max Delay | 65535 minutes (~45 days) |
| Max Attempts | 5 |
| Max Job Duration | 5 minutes |
| Priority Levels | 3 (low, default, high) |
| Parameter Name Length | 255 characters |

## Return Value

The `{% background %}` tag returns immediately and does not block execution:

```liquid
{% background source_name: 'async_task' %}
  This executes asynchronously
{% endbackground %}

Response sent to user immediately (doesn't wait for background job)
```

## See Also

- [Background Jobs - Configuration](./configuration.md)
- [Background Jobs - Patterns](./patterns.md)
- [Background Jobs - Gotchas](./gotchas.md)
- [Background Jobs - Advanced](./advanced.md)
- [pos-cli Reference](../../commands/pos-cli.md)
- [Liquid Filters & Tags](../../liquid/index.md)
