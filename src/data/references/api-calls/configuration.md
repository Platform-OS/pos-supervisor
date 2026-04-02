# API Calls Configuration Reference

## API Call Directory Structure

Create API calls in `app/api_calls/` directory:

```
app/api_calls/
├── payment_service.liquid
├── email_service.liquid
├── analytics_tracking.liquid
└── external_api.liquid
```

## API Call File Structure

### Basic Template

```liquid
---
to: https://api.example.com/endpoint
format: json
request_type: POST
request_headers: |
  {
    "Authorization": "Bearer token",
    "Content-Type": "application/json"
  }
---

{
  "key": "{{ context.current_user.id }}",
  "value": "{{ data }}"
}
```

## Front Matter Configuration

### Required Fields

**`to`**: Endpoint URL

```yaml
to: https://api.service.com/v1/endpoint
```

**`format`**: Response format (json, xml, text)

```yaml
format: json
```

**`request_type`**: HTTP method (GET, POST, PUT, DELETE, PATCH)

```yaml
request_type: POST
```

### Optional Fields

**`request_headers`**: HTTP headers as JSON

```yaml
request_headers: |
  {
    "Authorization": "Bearer API_KEY",
    "Content-Type": "application/json",
    "X-Custom-Header": "value"
  }
```

**`request_body`**: Request payload

```yaml
request_body: |
  {
    "name": "{{ user.name }}",
    "email": "{{ user.email }}"
  }
```

## Credential Management

### Store Credentials as Constants

Never hardcode API keys. Use platformOS constants:

```bash
# Set constant
pos-cli constants set dev EXTERNAL_API_KEY "key_xyz123"
pos-cli constants set staging EXTERNAL_API_KEY "key_staging"
pos-cli constants set production EXTERNAL_API_KEY "key_prod"
```

### Reference in API Call

```liquid
---
to: https://api.example.com/endpoint
format: json
request_type: GET
request_headers: |
  {
    "Authorization": "Bearer {{ context.constants.EXTERNAL_API_KEY }}"
  }
---
```

## Request Headers Configuration

### Common Headers

```yaml
request_headers: |
  {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "PlatformOS/1.0"
  }
```

### Authentication Headers

```yaml
request_headers: |
  {
    "Authorization": "Bearer {{ context.constants.API_TOKEN }}",
    "X-API-Key": "{{ context.constants.API_KEY }}"
  }
```

### Custom Headers

```yaml
request_headers: |
  {
    "X-Request-ID": "{{ context.current_user.id }}",
    "X-Timestamp": "{{ 'now' | date: '%s' }}"
  }
```

## Response Handling

### JSON Response Format

API response available in template context:

```liquid
---
to: https://api.example.com/users
format: json
request_type: GET
---

{% if result.status == 200 %}
  User: {{ result.response.name }}
{% else %}
  Error: {{ result.response.error }}
{% endif %}
```

### XML Response Format

```yaml
format: xml
```

### Text Response Format

```yaml
format: text
```

## Error Handling Setup

### Try-Catch Pattern Configuration

Prepare handlers in API call file:

```liquid
---
to: https://api.example.com/endpoint
format: json
request_type: POST
---

{% if result.status == 200 %}
  <!-- Success handling -->
{% elsif result.status == 401 %}
  <!-- Unauthorized -->
{% elsif result.status == 500 %}
  <!-- Server error -->
{% else %}
  <!-- Other errors -->
{% endif %}
```

## Download File Configuration

### GET with File Download

Configure maximum file size (50MB):

```liquid
---
to: https://example.com/files/download
format: binary
request_type: GET
request_headers: |
  {
    "Authorization": "Bearer {{ context.constants.FILE_API_KEY }}"
  }
---
```

Max file size: **50MB**

## Request Body Configuration

### JSON Payload

```liquid
---
to: https://api.example.com/data
format: json
request_type: POST
request_headers: |
  {
    "Content-Type": "application/json"
  }
---

{
  "id": "{{ context.current_user.id }}",
  "name": "{{ context.current_user.name }}",
  "email": "{{ context.current_user.email }}"
}
```

### Form Data

```liquid
---
to: https://api.example.com/upload
format: json
request_type: POST
request_headers: |
  {
    "Content-Type": "application/x-www-form-urlencoded"
  }
---

user_id={{ context.current_user.id }}&action=submit
```

## Background Job Configuration

### Async API Calls

Configure for background execution:

```liquid
---
to: https://api.example.com/async
format: json
request_type: POST
async: true
---

{
  "job_id": "{{ job_id }}",
  "data": "{{ payload }}"
}
```

## Timeout Configuration

### Default Timeout

Default timeout: 30 seconds

Set custom timeout:

```yaml
timeout: 60
```

Value in seconds.

## See Also

- [API Calls Usage](./api.md)
- [API Calls Patterns](./patterns.md)
- [API Calls Troubleshooting](./gotchas.md)
