# Sessions Advanced Techniques

## Session Encryption

Encrypt sensitive session data:

```liquid
{% capture encrypted_token %}
  {{ context.params.auth_token | encrypt: context.session_key }}
{% endcapture %}
{% session auth_token = encrypted_token %}

<!-- Decrypt when needed -->
{% assign token = context.session.auth_token | decrypt: context.session_key %}
```

Store encryption key in environment variables for security.

## Session Expiration Control

Implement custom expiration logic:

```liquid
<!-- Track session creation time -->
{% unless context.session.created_at %}
  {% session created_at = 'now' | date: '%s' %}
{% endunless %}

<!-- Check if session expired (1 hour = 3600 seconds) -->
{% assign current_time = 'now' | date: '%s' %}
{% assign session_age = current_time | minus: context.session.created_at %}
{% if session_age > 3600 %}
  <!-- Session expired, clear it -->
  {% session created_at = null %}
  {% session user_id = null %}
  <!-- Redirect to login -->
{% endif %}
```

## Session Compression

Store multiple values in a compressed format:

```liquid
<!-- Store as delimited string to save space -->
{% capture session_data %}
{{ context.session.user_id }}|{{ context.session.role }}|{{ context.session.permissions }}
{% endcapture %}
{% session compressed = session_data %}

<!-- Decompress when needed -->
{% assign parts = context.session.compressed | split: '|' %}
{% assign user_id = parts[0] %}
{% assign role = parts[1] %}
{% assign permissions = parts[2] %}
```

## Cross-Domain Session Sharing

Share sessions across subdomains:

```yaml
# .pos file configuration
sessions:
  domain: 'example.com'
  same_site: 'None'
  secure: true
```

Use consistent domain setting across all subdomains.

## Session State Machine

Implement strict state transitions:

```liquid
{% assign valid_states = 'initial,pending,approved,rejected' | split: ',' %}

{% if context.params.transition %}
  {% assign current = context.session.workflow_state | default: 'initial' %}

  <!-- Only allow valid transitions -->
  {% if current == 'initial' and context.params.transition == 'pending' %}
    {% session workflow_state = 'pending' %}
  {% elsif current == 'pending' and context.params.transition == 'approved' %}
    {% session workflow_state = 'approved' %}
  {% elsif current == 'pending' and context.params.transition == 'rejected' %}
    {% session workflow_state = 'rejected' %}
  {% else %}
    <!-- Invalid transition, reject -->
    Invalid state transition
  {% endif %}
{% endif %}
```

Enforce state machine rules to prevent invalid workflows.

## Session Analytics

Track session behavior and patterns:

```liquid
<!-- Record session event -->
{% if context.params.action %}
  {% capture events %}{{ context.session.events | default: '' }}{% endcapture %}
  {% assign event_list = events | split: ';' %}
  {% assign new_event = context.params.action | append: '=' | append: 'now' | date: '%s' %}
  {% assign event_list = event_list | push: new_event %}
  {% session events = event_list | join: ';' %}
{% endif %}

<!-- Analyze session lifetime -->
{% assign events = context.session.events | split: ';' %}
<p>Session has {{ events | size }} recorded events</p>
```

## Rate Limiting with Sessions

Implement rate limiting per user:

```liquid
{% assign max_requests = 100 %}
{% assign time_window = 3600 %}

{% assign current_time = 'now' | date: '%s' %}
{% assign window_start = context.session.rate_limit_window | default: current_time %}
{% assign window_age = current_time | minus: window_start %}

{% if window_age > time_window %}
  <!-- Reset window -->
  {% session rate_limit_count = 1 %}
  {% session rate_limit_window = current_time %}
{% else %}
  <!-- Increment count -->
  {% assign new_count = context.session.rate_limit_count | plus: 1 %}
  {% session rate_limit_count = new_count %}

  <!-- Check limit -->
  {% if new_count > max_requests %}
    Too many requests, please try again later
    {%- break -%}
  {% endif %}
{% endif %}
```

## Session Mirroring to Database

Persist critical session data to database:

```liquid
{% if context.params.save_to_db %}
  <!-- Save session to database record -->
  {% graphql res = 'save_session_data',
    user_id: context.session.user_id,
    data: context.session | json,
    expires_at: 'now' | date: '%s' | plus: 86400
  %}

  <!-- Clear volatile session data, keep reference -->
  {% session db_record_id = res.record.id %}
{% endif %}
```

## Graduated Session Escalation

Escalate permissions based on session age:

```liquid
{% assign created_at = context.session.created_at | default: 'now' | date: '%s' %}
{% assign age = 'now' | date: '%s' | minus: created_at %}

<!-- Determine permission level based on session age -->
{% if age < 300 %}
  <!-- < 5 minutes: read-only -->
  {% assign permission_level = 'read' %}
{% elsif age < 1800 %}
  <!-- < 30 minutes: read+write -->
  {% assign permission_level = 'write' %}
{% else %}
  <!-- > 30 minutes: full access -->
  {% assign permission_level = 'admin' %}
{% endif %}

{% if context.params.action == 'delete' and permission_level != 'admin' %}
  Not authorized: insufficient session age
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Gotchas & Issues](./gotchas.md)
