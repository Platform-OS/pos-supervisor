# API Calls Reference

## API Call Invocation

### Basic API Call

Call API from templates:

```liquid
{% api_call 'external_service' %}
  to: https://api.example.com/users
  format: json
  request_type: GET
{% endapi_call %}

{% if external_service.status == 200 %}
  {{ external_service.response }}
{% endif %}
```

### Named API Calls

Reference by name created in `app/api_calls/`:

```liquid
{% api_call 'payment_service' %}
  to: https://api.payment.com/charge
  format: json
  request_type: POST
{% endapi_call %}
```

## Request Types

### GET Request

Retrieve data:

```liquid
{% api_call 'fetch_user' %}
  to: https://api.example.com/users/123
  format: json
  request_type: GET
{% endapi_call %}

{{ fetch_user.response.name }}
```

### POST Request

Send data:

```liquid
{% api_call 'create_user' %}
  to: https://api.example.com/users
  format: json
  request_type: POST
  request_headers: |
    {
      "Content-Type": "application/json"
    }
{% endapi_call %}

{
  "name": "{{ form.fields.name }}",
  "email": "{{ form.fields.email }}"
}
```

### PUT Request

Update resource:

```liquid
{% api_call 'update_user' %}
  to: https://api.example.com/users/123
  format: json
  request_type: PUT
  request_headers: |
    {
      "Content-Type": "application/json"
    }
{% endapi_call %}

{
  "name": "{{ new_name }}"
}
```

### DELETE Request

Remove resource:

```liquid
{% api_call 'delete_user' %}
  to: https://api.example.com/users/123
  format: json
  request_type: DELETE
{% endapi_call %}

{% if delete_user.status == 204 %}
  User deleted
{% endif %}
```

### PATCH Request

Partial update:

```liquid
{% api_call 'patch_user' %}
  to: https://api.example.com/users/123
  format: json
  request_type: PATCH
{% endapi_call %}
```

## Response Handling

### Response Object

Response available as variable:

```liquid
{% api_call 'service_call' %}
  to: https://api.example.com/endpoint
  format: json
  request_type: GET
{% endapi_call %}

<!-- Response properties -->
service_call.status      <!-- HTTP status code -->
service_call.response    <!-- Response body -->
service_call.headers     <!-- Response headers -->
```

### Status Codes

```liquid
{% case api_response.status %}
  {% when 200 %}
    Success
  {% when 201 %}
    Created
  {% when 400 %}
    Bad Request
  {% when 401 %}
    Unauthorized
  {% when 404 %}
    Not Found
  {% when 500 %}
    Server Error
{% endcase %}
```

### JSON Parsing

Automatically parsed for JSON format:

```liquid
{% api_call 'get_data' %}
  to: https://api.example.com/data
  format: json
  request_type: GET
{% endapi_call %}

<!-- Access nested properties -->
{{ get_data.response.user.name }}
{{ get_data.response.data.items[0].id }}
```

## Headers Management

### Set Authorization Header

```liquid
request_headers: |
  {
    "Authorization": "Bearer {{ context.constants.API_TOKEN }}"
  }
```

### Add Custom Headers

```liquid
request_headers: |
  {
    "Content-Type": "application/json",
    "X-Request-ID": "{{ context.current_user.id }}",
    "X-Correlation-ID": "{{ transaction_id }}"
  }
```

## File Download Filter

### Download File with GET

Maximum 50MB:

```liquid
{% api_call 'download_report' %}
  to: https://api.example.com/export
  format: binary
  request_type: GET
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.DOWNLOAD_TOKEN }}"
    }
{% endapi_call %}

<a href="{{ download_report.response }}">
  Download Report
</a>
```

### File Size Verification

```liquid
{% api_call 'large_file' %}
  to: https://cdn.example.com/file.zip
  format: binary
  request_type: GET
{% endapi_call %}

{% if large_file.headers.content-length > 52428800 %}
  File exceeds 50MB limit
{% endif %}
```

## Request Body Configuration

### JSON Payload

```liquid
{
  "user_id": "{{ context.current_user.id }}",
  "action": "{{ action }}",
  "timestamp": "{{ 'now' | date: '%Y-%m-%d %H:%M:%S' }}"
}
```

### Liquid Template in Body

```liquid
{
  "message": "User {{ context.current_user.name }} performed {{ action }}"
}
```

## Background Jobs

### Async API Calls

Non-blocking execution:

```liquid
{% api_call 'async_task' async: true %}
  to: https://api.example.com/process
  format: json
  request_type: POST
{% endapi_call %}
```

Returns job ID immediately.

### Monitor Job Status

```liquid
{% if async_task.job_id %}
  Job {{ async_task.job_id }} started
{% endif %}
```

## Error Handling

### Try-Catch

Capture and handle errors:

```liquid
{% api_call 'external_api' %}
  to: https://api.example.com/data
  format: json
  request_type: GET
{% endapi_call %}

{% if external_api.status == 200 %}
  {{ external_api.response }}
{% elsif external_api.error %}
  Error: {{ external_api.error }}
{% else %}
  Unknown error
{% endif %}
```

### Timeout Handling

```liquid
{% api_call 'slow_service' %}
  to: https://api.slow.com/endpoint
  format: json
  request_type: GET
{% endapi_call %}

{% if external_api.status == null %}
  Service timeout
{% endif %}
```

## Constants in API Calls

### Reference Stored Credentials

```liquid
{
  "api_key": "{{ context.constants.PAYMENT_API_KEY }}",
  "webhook_secret": "{{ context.constants.WEBHOOK_SECRET }}"
}
```

## See Also

- [API Calls Configuration](./configuration.md)
- [API Calls Patterns](./patterns.md)
- [API Calls Troubleshooting](./gotchas.md)
