# API Calls Patterns

## Basic API Integration Pattern

### Simple External Service Call

```liquid
{% api_call 'weather_service' %}
  to: https://api.weather.com/current?city={{ context.params.city }}
  format: json
  request_type: GET
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.WEATHER_API_KEY }}"
    }
{% endapi_call %}

{% if weather_service.status == 200 %}
  <p>Weather: {{ weather_service.response.condition }}</p>
  <p>Temperature: {{ weather_service.response.temp }}°F</p>
{% else %}
  <p>Unable to fetch weather</p>
{% endif %}
```

## Authentication Pattern

### Bearer Token Authentication

```liquid
{% api_call 'api_request' %}
  to: https://api.service.com/data
  format: json
  request_type: GET
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.API_ACCESS_TOKEN }}"
    }
{% endapi_call %}
```

### API Key Authentication

```liquid
{% api_call 'keyed_service' %}
  to: https://api.example.com/resource
  format: json
  request_type: GET
  request_headers: |
    {
      "X-API-Key": "{{ context.constants.SERVICE_API_KEY }}",
      "X-API-Secret": "{{ context.constants.SERVICE_API_SECRET }}"
    }
{% endapi_call %}
```

### Basic Authentication

```liquid
{% assign credentials = 'user:password' | base64_encode %}

{% api_call 'basic_auth' %}
  to: https://api.example.com/secure
  format: json
  request_type: GET
  request_headers: |
    {
      "Authorization": "Basic {{ credentials }}"
    }
{% endapi_call %}
```

## Data Submission Pattern

### Create Record via API

```liquid
{% api_call 'create_user' %}
  to: https://api.example.com/users
  format: json
  request_type: POST
  request_headers: |
    {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{ context.constants.API_TOKEN }}"
    }
{% endapi_call %}

{
  "name": "{{ form.fields.name }}",
  "email": "{{ form.fields.email }}",
  "phone": "{{ form.fields.phone }}"
}
```

### Update Record via API

```liquid
{% api_call 'update_user' %}
  to: https://api.example.com/users/{{ user_id }}
  format: json
  request_type: PUT
  request_headers: |
    {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{ context.constants.API_TOKEN }}"
    }
{% endapi_call %}

{
  "name": "{{ updated_name }}",
  "status": "{{ updated_status }}"
}
```

### Delete Record via API

```liquid
{% api_call 'delete_user' %}
  to: https://api.example.com/users/{{ user_id }}
  format: json
  request_type: DELETE
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.API_TOKEN }}"
    }
{% endapi_call %}

{% if delete_user.status == 204 %}
  Record deleted successfully
{% endif %}
```

## Error Handling and Retry Pattern

### Comprehensive Error Handling

```liquid
{% api_call 'external_service' %}
  to: https://api.example.com/data
  format: json
  request_type: GET
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.API_KEY }}"
    }
{% endapi_call %}

{% if external_service.status == 200 %}
  <!-- Success -->
  {{ external_service.response.data }}

{% elsif external_service.status == 401 %}
  <!-- Unauthorized - credentials issue -->
  <p>Authentication failed</p>

{% elsif external_service.status == 404 %}
  <!-- Not found -->
  <p>Resource not found</p>

{% elsif external_service.status == 500 %}
  <!-- Server error - may retry -->
  <p>Service temporarily unavailable</p>

{% elsif external_service.error %}
  <!-- Network or timeout error -->
  <p>Connection error: {{ external_service.error }}</p>

{% else %}
  <!-- Unknown error -->
  <p>Unexpected error: {{ external_service.status }}</p>

{% endif %}
```

## Pagination Pattern

### Fetch Multiple Pages

```liquid
{% assign page = 1 %}
{% assign all_items = '' %}

{% for page in (1..10) %}
  {% api_call 'paginated_list' %}
    to: https://api.example.com/items?page={{ page }}&limit=20
    format: json
    request_type: GET
    request_headers: |
      {
        "Authorization": "Bearer {{ context.constants.API_TOKEN }}"
      }
  {% endapi_call %}

  {% if paginated_list.response.items.size == 0 %}
    {% break %}
  {% endif %}

  {% assign all_items = all_items | append: paginated_list.response.items %}
{% endfor %}

<!-- Process all_items -->
```

## Rate Limiting Pattern

### Respect API Rate Limits

```liquid
{% assign api_calls = 0 %}
{% assign max_calls = 100 %}

{% for item in items %}
  {% if api_calls >= max_calls %}
    <!-- Stop to avoid rate limiting -->
    {% break %}
  {% endif %}

  {% api_call 'service' %}
    to: https://api.example.com/process
    format: json
    request_type: POST
  {% endapi_call %}

  {% assign api_calls = api_calls | plus: 1 %}

  <!-- Add delay between calls if needed -->
{% endfor %}
```

## Webhook Handling Pattern

### Receive External Webhooks

```liquid
<!-- Listen for incoming webhook -->
{% if context.request.request_method == 'POST' %}
  {% assign payload = context.request.body_json %}

  <!-- Verify webhook signature -->
  {% assign signature = context.request.headers.X_Webhook_Signature %}
  {% assign expected = payload | hmac_sha256: context.constants.WEBHOOK_SECRET %}

  {% if signature == expected %}
    <!-- Process webhook -->
    {% graphql 'process_event' %}
      mutation {
        webhookProcess(type: "{{ payload.type }}", data: "{{ payload.data }}") {
          success
        }
      }
    {% endgraphql %}

    <!-- Send 200 OK -->
  {% else %}
    <!-- Signature mismatch - reject -->
  {% endif %}
{% endif %}
```

## File Download Pattern

### Download and Process File

```liquid
{% api_call 'download_report' %}
  to: https://cdn.example.com/exports/{{ report_id }}.csv
  format: binary
  request_type: GET
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.DOWNLOAD_TOKEN }}"
    }
{% endapi_call %}

{% if download_report.status == 200 %}
  {% assign file_size = download_report.headers.content-length %}

  {% if file_size <= 52428800 %}
    <!-- File is under 50MB -->
    <a href="{{ download_report.response }}">
      Download Report ({{ file_size | divided_by: 1048576 | round: 2 }}MB)
    </a>
  {% else %}
    <p>File too large to download</p>
  {% endif %}
{% endif %}
```

## Background Job Pattern

### Fire and Forget Processing

```liquid
<!-- Trigger async processing -->
{% api_call 'async_processor' async: true %}
  to: https://api.example.com/process
  format: json
  request_type: POST
  request_headers: |
    {
      "Authorization": "Bearer {{ context.constants.API_TOKEN }}"
    }
{% endapi_call %}

{
  "job_id": "{{ context.current_user.id }}_{{ 'now' | date: '%s' }}",
  "data": "{{ data_to_process }}"
}

<!-- Respond immediately, processing happens in background -->
<p>Your request is being processed. Job ID: {{ async_processor.job_id }}</p>
```

## Caching Pattern

### Store API Response

```liquid
{% unless context.cache.external_data %}
  {% api_call 'fetch_data' %}
    to: https://api.example.com/data
    format: json
    request_type: GET
  {% endapi_call %}

  {% assign context.cache.external_data = fetch_data.response %}
  {% assign context.cache.external_data_time = 'now' | date: '%s' %}
{% endunless %}

<!-- Use cached data -->
{{ context.cache.external_data }}
```

## See Also

- [API Calls Configuration](./configuration.md)
- [API Calls Reference](./api.md)
- [API Calls Troubleshooting](./gotchas.md)
