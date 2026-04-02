# Background Jobs - Gotchas and Troubleshooting

## Common Errors and Solutions

### Error 1: Variable Not Accessible in Background Job

**Symptom**: Job runs but can't access variables from parent scope.

```liquid
{% assign username = user.name %}

{% background source_name: 'use_name' %}
  {{ username }}  {% comment %} ERROR: undefined {% endcomment %}
{% endbackground %}
```

**Cause**: Background jobs run in isolated scope; parent variables aren't automatically inherited.

**Solution**: Reassign variables inside the background block:

```liquid
{% assign username = user.name %}

{% background source_name: 'use_name' %}
  {% assign username = user.name %}
  Hello {{ username }}
{% endbackground %}
```

Or pass through partial parameters:

```liquid
{% background source_name: 'send_email' %}
  {% render 'emails/template', username: user.name, email: user.email %}
{% endbackground %}
```

---

### Error 2: Job Not Executing

**Symptom**: Background job appears queued but never executes.

**Cause**: Job might be failing silently or infrastructure issue.

**Solution**: Check logs for execution status:

```bash
pos-cli logs --source-name='your_job_name'
```

Look for:
- Failed attempts (indicates execution, but with errors)
- No logs at all (indicates job not reached background processor)

If no logs appear, verify:
- Job source_name is spelled correctly
- Background tag syntax is valid (check for missing quotes/parameters)
- pos-cli logs connection is working

---

### Error 3: Priority Misuse

**Symptom**: High-priority jobs cause queue congestion.

**Cause**: Over-using `priority: 'high'` fills queue with non-urgent jobs.

```liquid
{% comment %} WRONG: Everything marked high priority {% endcomment %}
{% background priority: 'high', source_name: 'analytics_log' %}
  {% render 'analytics/log' %}
{% endbackground %}
```

**Solution**: Reserve high priority for critical tasks only:

```liquid
{% comment %} Correct: Use appropriate priorities {% endcomment %}

{% comment %} Critical - payment processing {% endcomment %}
{% background priority: 'high', source_name: 'payment' %}
  ...
{% endbackground %}

{% comment %} Standard - email notifications {% endcomment %}
{% background priority: 'default', source_name: 'email' %}
  ...
{% endbackground %}

{% comment %} Non-urgent - analytics {% endcomment %}
{% background priority: 'low', source_name: 'analytics' %}
  ...
{% endbackground %}
```

---

### Error 4: Scope Issues with Partials

**Symptom**: Partial included in background job can't find variables.

```liquid
{% background source_name: 'include_partial' %}
  {% render 'my/partial' %}
{% endbackground %}
```

Partial expects `user` variable but it's undefined.

**Cause**: Partials receive only explicitly passed parameters in background scope.

**Solution**: Pass all required parameters explicitly:

```liquid
{% background source_name: 'include_partial' %}
  {% render 'my/partial',
    user_id: user.id,
    user_email: user.email,
    user_name: user.name %}
{% endbackground %}
```

---

### Error 5: Job Exceeds Time Limit

**Symptom**: Complex operations fail in background job.

**Cause**: Background jobs have 5-minute execution limit.

**Solution**: Break into smaller jobs or use events for heavy operations:

```liquid
{% comment %} Instead of one long job {% endcomment %}
{% background source_name: 'heavy_computation' %}
  {% comment %} This might timeout after 5 minutes {% endcomment %}
  {% render 'reports/generate-100k-rows' %}
{% endbackground %}

{% comment %} Break into chunks {% endcomment %}
{% for batch in data_batches %}
  {% background source_name: 'process_batch' %}
    {% render 'processors/batch', data: batch %}
  {% endbackground %}
{% endfor %}
```

---

### Error 6: Infinite Retry Loop

**Symptom**: Job keeps retrying indefinitely.

**Cause**: Partial always fails due to bug.

**Solution**: Identify and fix the root cause:

```liquid
{% comment %} Check logs for error details {% endcomment %}
{% comment %} pos-cli logs --source-name='failing_job' {% endcomment %}

{% comment %} Fix the partial, then requeue {% endcomment %}
{% background max_attempts: 1, source_name: 'fixed_job' %}
  {% render 'fixed/partial' %}
{% endbackground %}
```

Always set reasonable `max_attempts` limit:

```liquid
{% background max_attempts: 3, source_name: 'safe_job' %}
  ...
{% endbackground %}
```

---

## Common Mistakes

### Mistake 1: Assuming Execution Order

```liquid
{% background source_name: 'job_1' %}...{% endbackground %}
{% background source_name: 'job_2' %}...{% endbackground %}

{% comment %} ERROR: job_2 might execute before job_1 {% endcomment %}
```

**Fix**: If order matters, use delay:

```liquid
{% background source_name: 'job_1' %}...{% endbackground %}
{% background delay: 1, source_name: 'job_2' %}...{% endbackground %}
```

---

### Mistake 2: Not Passing Required Data

```liquid
{% background source_name: 'send_email' %}
  {% render 'emails/template' %}
  {% comment %} Partial expects user data but receives nothing {% endcomment %}
{% endbackground %}
```

**Fix**: Explicitly pass all parameters:

```liquid
{% background source_name: 'send_email' %}
  {% render 'emails/template', user_id: user.id, email: user.email %}
{% endbackground %}
```

---

### Mistake 3: Using Request Context in Background

```liquid
{% background source_name: 'use_params' %}
  {{ params.foo }}  {% comment %} ERROR: params not available {% endcomment %}
  {{ context.current_user.name }}  {% comment %} ERROR: not available {% endcomment %}
{% endbackground %}
```

**Fix**: Pass required data explicitly:

```liquid
{% assign query_param = context.params.foo %}
{% assign user_name = context.current_user.name %}

{% background source_name: 'use_params' %}
  {% assign foo = query_param %}
  {% assign name = user_name %}
  {{ foo }} {{ name }}
{% endbackground %}
```

---

## Limits and Constraints

| Limit | Value | Impact |
|---|---|---|
| Max Job Duration | 5 minutes | Long operations timeout |
| Max Retry Attempts | 5 | Can't exceed 5 retries |
| Max Delay | 65535 minutes (~45 days) | Practical limit ~1 day |
| Parameter Count | ~20 | Too many params = complexity |
| Job Queue Size | Platform-dependent | High-priority queue might fill |
| Execution Latency | Seconds to minutes | Not real-time |

---

## Troubleshooting Flowchart

```
Is job executing?
├─ YES
│  └─ Check logs: pos-cli logs --source-name='name'
│     ├─ SUCCESS? → Job working correctly
│     └─ FAILED? → Check error message, fix partial, retry
│
└─ NO
   ├─ Is syntax correct?
   │  └─ NO → Fix {% background %} tag syntax
   │  └─ YES → Continue
   │
   ├─ Are parameters valid?
   │  └─ NO → Fix source_name, delay, priority values
   │  └─ YES → Continue
   │
   ├─ Is background job available in environment?
   │  └─ NO → Contact platform support
   │  └─ YES → Check pos-cli logs for system errors
   │
   └─ Enable debug logging in pos-cli logs
```

---

## Prevention Checklist

- [ ] Always assign variables inside background block
- [ ] Pass all required data to included partials
- [ ] Use descriptive `source_name` for debugging
- [ ] Set reasonable `max_attempts` (avoid infinite retries)
- [ ] Use appropriate `priority` levels
- [ ] Monitor with `pos-cli logs` regularly
- [ ] Test partials independently before background
- [ ] Don't rely on request context (params, session)
- [ ] Set realistic `delay` values
- [ ] Document expected parameters for partials

---

## See Also

- [Background Jobs - Configuration](./configuration.md)
- [Background Jobs - API](./api.md)
- [Background Jobs - Patterns](./patterns.md)
- [Background Jobs - Advanced](./advanced.md)
- [pos-cli Troubleshooting](../../commands/troubleshooting.md)
- [Liquid Scope and Variables](../../liquid/variables.md)
