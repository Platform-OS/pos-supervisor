# Flash Messages Advanced Techniques

## Overview

Advanced patterns and techniques for sophisticated flash message implementations in platformOS.

## Custom Flash Styling Based on Context

Apply dynamic CSS classes based on flash type and user preferences:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash %}
  {% assign theme = context.user.theme_preference | default: 'light' %}
  {% assign flash_type = sflash.notice | default: sflash.alert | default: sflash.warning %}
  {% assign flash_class = 'flash-' | append: flash_type | append: '-' | append: theme %}

  <div class="flash {{ flash_class }}" role="alert">
    {{ flash_type | t }}
  </div>
{% endif %}
```

## Flash Message Queuing

Queue multiple messages to display sequentially:

```liquid
---
handle: flash_queue_helper
---

{% if request.method == 'POST' %}
  {% assign queue = session.flash_queue | default: '[]' | parse_json %}
  {% assign new_message = 'message' | append: queue.size %}

  {% assign queue = queue | push: new_message %}
  {% assign session.flash_queue = queue | json %}
{% endif %}
```

Render in layout:

```liquid
{% assign queue = session.flash_queue | parse_json %}
{% for message in queue %}
  <div class="flash queued-{{ forloop.index }}">
    {{ message | t }}
  </div>
{% endfor %}
```

## Animated Flash Dismissal

Implement JavaScript-based flash animation and auto-dismiss:

```liquid
<script>
  {% include 'modules/core/helpers/flash/get_flash' %}
  {% if sflash.notice %}
    const flash = document.querySelector('.flash');
    flash.addEventListener('animationend', function() {
      flash.remove();
    });
    setTimeout(() => {
      flash.classList.add('dismiss-animation');
    }, 3000);
  {% endif %}
</script>

<style>
  @keyframes slideOut {
    to {
      transform: translateX(-100%);
      opacity: 0;
    }
  }

  .flash.dismiss-animation {
    animation: slideOut 0.3s ease-out forwards;
  }
</style>
```

## Conditional Flash Based on User Segments

Show different messages based on user attributes:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if context.user.is_premium? %}
  {% assign flash_prefix = 'premium' %}
{% elsif context.user.is_trial? %}
  {% assign flash_prefix = 'trial' %}
{% else %}
  {% assign flash_prefix = 'free' %}
{% endif %}

{% assign localized_key = sflash.notice | prepend: flash_prefix | append: '_message' %}
{{ localized_key | t }}
```

## Flash with Deep Links

Combine flash messages with deep linking:

```liquid
{% if form.valid? %}
  {% assign deep_link = '/items/' | append: item.id | append: '#details' %}
  {% include 'modules/core/helpers/redirect_to',
    url: deep_link,
    notice: 'item.saved'
  %}
{% endif %}
```

## Flash Message Persistence Across Domain Changes

When redirecting between subdomains, ensure flash persists:

```liquid
<!-- Flash by default doesn't persist across subdomains -->
<!-- Solution: Store in session with longer TTL -->

{% assign session.persistent_flash = sflash | json %}
{% assign session.persistent_flash_ttl = 'now' | date: '%s' | plus: 3600 %}

{% include 'modules/core/helpers/redirect_to',
  url: 'https://other-subdomain.example.com/page'
%}
```

## Flash Analytics and Tracking

Log flash messages for analytics:

```liquid
{% include 'modules/core/helpers/flash/get_flash' %}

{% if sflash %}
  {% assign flash_type = 'notice' | default: 'alert' %}
  {% graphql log = 'log_flash_event'
    type: flash_type,
    message_key: sflash.notice | default: sflash.alert,
    user_id: context.user.id,
    timestamp: 'now'
  %}
{% endif %}
```

## Flash with Error Details

Display detailed error information in flash:

```liquid
{% if form.errors? %}
  {% assign error_list = form.errors | map: 'message' | join: ', ' %}
  {% include 'modules/core/helpers/redirect_to',
    url: request.url_path,
    alert: 'form.validation_error',
    error_details: error_list
  %}
{% endif %}

<!-- In layout -->
{% if sflash.alert %}
  <div class="alert">
    <p>{{ sflash.alert | t }}</p>
    {% if sflash.error_details %}
      <ul>
        {% for error in sflash.error_details | split: ', ' %}
          <li>{{ error }}</li>
        {% endfor %}
      </ul>
    {% endif %}
  </div>
{% endif %}
```

## Progressive Enhancement with Flash

Enhance user experience with progressive flash enhancements:

```liquid
<!-- No JavaScript fallback -->
<noscript>
  <div class="flash-static">
    {% include 'modules/core/helpers/flash/get_flash' %}
    {{ sflash.notice | t }}
  </div>
</noscript>

<!-- JavaScript enhancement -->
<script>
  {% include 'modules/core/helpers/flash/get_flash' %}
  if ('{% if sflash %}true{% else %}false{% endif %}' === 'true') {
    initializeEnhancedFlash('{{ sflash.notice | t | escape_javascript }}');
  }
</script>
```

## Flash Message Accessibility

Implement accessible flash messages:

```liquid
<div class="flash"
     role="alert"
     aria-live="polite"
     aria-atomic="true">
  {% include 'modules/core/helpers/flash/get_flash' %}
  {{ sflash.notice | t }}
</div>

<style>
  /* Ensure visible focus for keyboard navigation */
  .flash:focus {
    outline: 2px solid #0066cc;
    outline-offset: 2px;
  }
</style>
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Common Patterns](./patterns.md)
- [Known Gotchas](./gotchas.md)
