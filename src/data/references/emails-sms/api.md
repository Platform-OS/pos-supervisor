# Emails and SMS API Reference

## Overview

platformOS provides GraphQL mutations for sending emails and SMS messages, with support for template variables, attachments, and delivery tracking.

## GraphQL Mutations

### email_send

Sends an email using a defined template:

```graphql
mutation SendWelcomeEmail(
  $email: String!
  $data: JsonObject!
) {
  email_send(
    template: "welcome"
    to: $email
    data: $data
  ) {
    success
    errors
  }
}
```

### email_send Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `template` | String | Yes | Name of email template (without `.liquid` extension) |
| `to` | String | Yes | Recipient email address |
| `data` | Object | No | Data variables passed to template context |
| `delay` | Integer | No | Delay in seconds before sending |
| `bcc` | String | No | Additional BCC address |

### sms_send

Sends an SMS message:

```graphql
mutation SendVerificationSMS(
  $phone: String!
  $code: String!
) {
  sms_send(
    template: "verification"
    to: $phone
    data: {
      verification_code: $code
    }
  ) {
    success
    errors
  }
}
```

### sms_send Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `template` | String | Yes | SMS template name |
| `to` | String | Yes | Recipient phone number |
| `data` | Object | No | Template variables |

## Response Structure

```json
{
  "success": true,
  "errors": []
}
```

## Template Variable Access

Within email/SMS templates, access passed data:

```liquid
Hello {{ data.user.first_name }},

Your order #{{ data.order.id }} has been confirmed.
Total: {{ data.order.total | pricify }}

Best regards,
{{ site.name }}
```

## Sending Inline Content

Override template content programmatically:

```graphql
mutation SendEmail {
  email_send(
    template: "custom"
    to: "user@example.com"
    data: {
      subject: "Custom Subject"
      body: "Custom HTML body"
    }
  ) {
    success
  }
}
```

## Attachments

Include file attachments in emails:

```graphql
mutation SendInvoice {
  email_send(
    template: "invoice"
    to: "customer@example.com"
    data: {
      attachments: [
        {
          filename: "invoice.pdf"
          content: "base64_encoded_content"
          mime_type: "application/pdf"
        }
      ]
    }
  ) {
    success
  }
}
```

## Batch Sending

Send to multiple recipients:

```graphql
mutation SendBatch(
  $recipients: [String!]!
) {
  email_send(
    template: "newsletter"
    to: $recipients
    data: { newsletter_date: "2024-01-15" }
  ) {
    success
  }
}
```

## Status Checking

Query email delivery status:

```graphql
query GetEmailStatus($id: ID!) {
  email(id: $id) {
    id
    status
    sent_at
    opened_at
    clicked_at
    bounce_type
  }
}
```

## See Also

- [Configuration Guide](./configuration.md)
- [Common Patterns](./patterns.md)
- [Known Gotchas](./gotchas.md)
- [Advanced Techniques](./advanced.md)
