# Emails and SMS Gotchas

## Overview

Common pitfalls and troubleshooting tips for email and SMS implementation in platformOS.

## Email Delivery Issues

### Front Matter Variables Not Interpolating

Front matter must be valid YAML. Use quotes for Liquid:

```yaml
---
to: '{{ user.email }}'
subject: "Order #{{ order.id }} Confirmed"
---
```

Without quotes, YAML parsing fails silently.

### Layout Not Found Error

Ensure layout path is relative to `app/views/layouts/`:

```yaml
---
layout: 'mailer'
---
```

Not: `layout: 'app/views/layouts/mailer'`

### Template Variables Scope Issues

Data passed to email must be in `data` object:

```graphql
mutation {
  email_send(
    template: "welcome"
    to: "user@example.com"
    data: {
      user_name: "John"
      company: "Acme"
    }
  ) {
    success
  }
}
```

Access as `{{ data.user_name }}`, not `{{ user_name }}`.

## Missing Context Variables

Variables undefined in templates render as empty strings. Always provide defaults:

```liquid
Hello {{ data.user.first_name | default: 'Customer' }},
```

## Email Authentication Issues

### SPF/DKIM/DMARC Failures

Configure sender domain properly in platformOS settings. Use verified sender domain:

```yaml
---
from: 'noreply@yourdomain.com'
---
```

Not: `from: 'noreply@platformos.com'`

### Reply-To Domain Mismatch

Reply-to should match or be a subdomain of sender:

```yaml
---
from: 'support@example.com'
reply_to: 'help@example.com'
---
```

Both should resolve to your infrastructure.

## SMS Specific Issues

### Character Encoding Problems

SMS has 160-character limit (or 153 with multi-part). Check encoding:

```liquid
{% assign message = "Your code: {{ data.code }}" %}
{% assign length = message | size %}
{% if length > 160 %}
  Warning: SMS will be split into multiple messages
{% endif %}
```

### Invalid Phone Numbers

Validate phone format before sending:

```graphql
mutation SendSMS($phone: String!) {
  sms_send(
    template: "verification"
    to: $phone
    data: { code: "123456" }
  ) {
    success
    errors
  }
}
```

Phone must include country code: `+1234567890`

## HTML Email Rendering

### Inline Styles Required

Many email clients strip external stylesheets. Use inline styles:

```html
<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #f0f0f0;">
    <td style="padding: 10px; border: 1px solid #ccc;">
      Content
    </td>
  </tr>
</table>
```

### Dark Mode Incompatibility

Use `preheader` text and test dark mode rendering:

```html
<div style="display:none; max-height:0; overflow:hidden;">
  Preview text shown in inbox list
</div>
```

## Event Consumer Timing

### Race Conditions with Events

Events are processed asynchronously. Ensure data exists before sending:

```liquid
{% graphql user_check = 'check_user_exists' user_id: event.payload %}
{% if user_check.user %}
  {% graphql result = 'send_email_to_user' user_id: event.payload %}
{% endif %}
```

### Consumer Not Triggering

Check consumer handle matches event name exactly:

```yaml
---
handle: user_welcome_event_consumer
events: ['user/welcome']
---
```

Event name must match: `send_event('user/welcome', payload)`

## Debugging Tips

### Enable Email Logs

Check Activity > Email Log in platformOS dashboard for delivery status and errors.

### Test with Staging Domain

Test email sending in staging environment before production deployment.

### Validate Template Rendering

Pre-render templates in tests to catch Liquid syntax errors early.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Common Patterns](./patterns.md)
- [Advanced Techniques](./advanced.md)
