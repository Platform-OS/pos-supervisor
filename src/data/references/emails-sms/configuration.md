# Emails and SMS Configuration

## Overview

platformOS emails and SMS messages are configured through their respective file structures, with front matter defining delivery parameters and layouts controlling presentation.

## Email Configuration

Emails are defined in `app/emails/` with front matter metadata:

```yaml
---
to: '{{ user.email }}'
from: 'support@example.com'
reply_to: 'help@example.com'
subject: 'Welcome to {{ site_name }}'
layout: 'mailer'
cc: 'manager@example.com'
bcc: 'archive@example.com'
---
```

### Front Matter Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `to` | Yes | String | Recipient email address, supports Liquid variables |
| `from` | Yes | String | Sender email address |
| `reply_to` | No | String | Reply-to email address |
| `subject` | Yes | String | Email subject line with Liquid support |
| `layout` | Yes | String | Template layout from `app/views/layouts/mailer.liquid` |
| `cc` | No | String/Array | Carbon copy recipients |
| `bcc` | No | String/Array | Blind carbon copy recipients |

## Email Layouts

Email layouts are stored in `app/views/layouts/` and commonly named `mailer.liquid`:

```liquid
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
  </style>
</head>
<body>
  {{ page.body }}
</body>
</html>
```

Layouts wrap email content and define HTML structure.

## SMS Configuration

SMS messages are defined in `app/smses/` with similar structure to emails:

```yaml
---
to: '{{ user.phone_number }}'
from: 'PlatformOS'
layout: 'sms'
---
```

### SMS Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `to` | Yes | Phone number, supports Liquid variables |
| `from` | Yes | SMS sender ID (alphanumeric, up to 11 chars typically) |
| `layout` | Yes | SMS layout template |

## Data Access

Dynamic data is passed to emails/SMS via context variables:

```liquid
data:
  user: user_id
  order: order_id
```

Access in templates using `{{ data.user.name }}` or `{{ data.order.total }}`.

## File Structure

```
app/
├── emails/
│   ├── welcome.liquid
│   ├── password_reset.liquid
│   └── order_confirmation.liquid
├── smses/
│   ├── sms_verification.liquid
│   └── order_shipped.liquid
└── views/layouts/
    ├── mailer.liquid
    └── sms.liquid
```

## Best Practices

1. **Use front matter variables** for all metadata
2. **Leverage Liquid filters** for date/currency formatting
3. **Keep layouts minimal** for email compatibility
4. **Test with real data** before production
5. **Version control templates** alongside code

## See Also

- [Emails and SMS API Reference](./api.md)
- [Common Patterns](./patterns.md)
- [Known Gotchas](./gotchas.md)
- [Advanced Techniques](./advanced.md)
