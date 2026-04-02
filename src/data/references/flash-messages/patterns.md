# Flash Messages Patterns

## Overview

Common patterns for implementing flash messages in platformOS applications.

## Basic Form Submission with Success Message

After successful form submission, redirect with confirmation:

```liquid
{% if form.valid? %}
  {% graphql result = 'create_user'
    name: form.name,
    email: form.email
  %}

  {% include 'modules/core/helpers/redirect_to',
    url: '/users',
    notice: 'user.created_successfully'
  %}
{% else %}
  <!-- Show validation errors -->
  {% include 'modules/core/helpers/flash/publish',
    alert: 'form.validation_failed'
  %}
{% endif %}
```

## Conditional Alerts Based on Action

Show different messages for different outcomes:

```liquid
{% if action == 'delete' %}
  {% if deletion_successful %}
    {% include 'modules/core/helpers/redirect_to',
      url: '/items',
      alert: 'item.deleted'
    %}
  {% else %}
    {% include 'modules/core/helpers/redirect_to',
      url: '/items',
      alert: 'item.deletion_failed'
    %}
  {% endif %}
{% endif %}
```

## Multi-Step Form with Warnings

Warn users during multi-step processes:

```liquid
{% if current_step == 2 %}
  {% if incomplete_required_fields.size > 0 %}
    {% include 'modules/core/helpers/redirect_to',
      url: '/form/step-2',
      warning: 'form.step_2_incomplete_fields'
    %}
  {% else %}
    {% include 'modules/core/helpers/redirect_to',
      url: '/form/step-3',
      notice: 'form.step_2_complete'
    %}
  {% endif %}
{% endif %}
```

## Displaying Flash with Localization

Render localized flash messages in layout:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash %}
  {% if sflash.notice %}
    <div class="alert alert-success">
      <i class="icon-check"></i>
      {{ sflash.notice | t }}
    </div>
  {% endif %}

  {% if sflash.alert %}
    <div class="alert alert-danger">
      <i class="icon-error"></i>
      {{ sflash.alert | t }}
    </div>
  {% endif %}

  {% if sflash.warning %}
    <div class="alert alert-warning">
      <i class="icon-warning"></i>
      {{ sflash.warning | t }}
    </div>
  {% endif %}

  {% if sflash.info %}
    <div class="alert alert-info">
      <i class="icon-info"></i>
      {{ sflash.info | t }}
    </div>
  {% endif %}
{% endif %}
```

## JavaScript Toast from Server

Trigger toast notifications from server actions:

```liquid
<script>
  {% include 'modules/core/helpers/flash/get_flash' %}
  {% if sflash.notice %}
    new pos.modules.toast('success', '{{ sflash.notice | t }}');
  {% endif %}
  {% if sflash.alert %}
    new pos.modules.toast('error', '{{ sflash.alert | t }}');
  {% endif %}
</script>
```

## Persistent Flash Across Pages

Keep flash visible until user manually closes:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash %}
  <div class="alert" id="flash-message" role="alert">
    <button type="button" class="close" aria-label="Close">
      <span aria-hidden="true">&times;</span>
    </button>
    <div class="alert-content">
      {{ sflash.notice | t | default: sflash.alert | t }}
    </div>
  </div>

  <script>
    document.querySelector('.close').addEventListener('click', function() {
      document.getElementById('flash-message').style.display = 'none';
    });
  </script>
{% endif %}
```

## Contextual Flash Messages

Show different messages based on user role:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if context.user.role == 'admin' %}
  {% assign flash_key = sflash.notice | append: '.admin' %}
{% else %}
  {% assign flash_key = sflash.notice %}
{% endif %}

{{ flash_key | t }}
```

## AJAX Request Flash Messages

Handle flash after AJAX form submissions:

```javascript
fetch('/api/form-submit', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => {
  if (data.success) {
    new pos.modules.toast('success', data.message);
  } else {
    new pos.modules.toast('error', data.error);
  }
});
```

## Flash Message Counter

Show notification with count:

```liquid
{% include 'modules/core/helpers/redirect_to',
  url: '/dashboard',
  notice: 'items.bulk_imported',
  count: imported_items.size
%}
```

Use in layout:

```liquid
{% if sflash.notice contains 'bulk_imported' %}
  {{ sflash.notice | t: count: imported_count }}
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Known Gotchas](./gotchas.md)
- [Advanced Techniques](./advanced.md)
