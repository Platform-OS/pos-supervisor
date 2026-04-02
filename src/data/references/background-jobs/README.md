# Background Jobs

Background jobs execute code asynchronously using the `{% background %}` tag.

## Syntax

```liquid
{% background source_name: 'job_label', delay: 0, priority: 'default', max_attempts: 1 %}
  {% comment %} Code to run in background {% endcomment %}
  {% graphql _ = 'emails/send', email: email %}
{% endbackground %}
```

## As a Partial Call

```liquid
{% background job = 'lib/jobs/process_order', order_id: order.id, delay: 1, priority: 'high' %}
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `delay` | Float | 0 | Minutes to delay execution |
| `priority` | String | `default` | `low`, `default`, or `high` |
| `max_attempts` | Integer | 1 | Retry count (1-5) |
| `source_name` | String | — | Job identifier for logging |

## Use Cases

- Sending emails/SMS after an action
- Processing payments
- Calling external APIs
- Heavy computations
- Report generation
- Data synchronization

## Example: Delayed Email

```liquid
{% background source_name: 'welcome_email', delay: 5, priority: 'low' %}
  {% graphql _ = 'emails/send_welcome', email: user.email, name: user.name %}
{% endbackground %}
```

## Example: API Call with Retry

```liquid
{% background source_name: 'sync_inventory', priority: 'high', max_attempts: 3 %}
  {% graphql result = 'api/sync_inventory', product_id: product.id %}
  {% if result.errors %}
    {% log result.errors, type: 'error' %}
  {% endif %}
{% endbackground %}
```

## Important Notes

- Background jobs have limited scope access
- Variables must be passed explicitly
- Use `source_name` for identification in logs
- Monitor via `pos-cli logs`
- Events + consumers are the preferred pattern for post-action side effects
