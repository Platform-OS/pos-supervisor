# API Calls Gotchas and Troubleshooting

## Credential Management Issues

### Never Hardcode API Keys

**Issue**: API keys exposed in source code

```liquid
# WRONG - Never do this!
to: https://api.example.com
request_headers: |
  {
    "Authorization": "Bearer sk_live_abc123xyz"
  }
```

### Store Credentials as Constants

```bash
# CORRECT - Use constants
pos-cli constants set production PAYMENT_API_KEY "sk_live_abc123xyz"
```

Reference in code:

```liquid
# CORRECT
to: https://api.example.com
request_headers: |
  {
    "Authorization": "Bearer {{ context.constants.PAYMENT_API_KEY }}"
  }
```

### Credential Rotation

Rotate credentials regularly:

```bash
# Generate new key in service provider
# Update constant
pos-cli constants set production PAYMENT_API_KEY "sk_live_new_key"

# Old requests will fail, triggering failover
```

## Authentication Failures

### 401 Unauthorized

**Cause**: Invalid or expired token

**Solution**:
```bash
# Verify constant is set
pos-cli constants list production | grep API_KEY

# Regenerate token in service provider
# Update constant
pos-cli constants set production API_TOKEN "new_token"
```

### Wrong Authorization Header Format

**Issue**: Bearer token not properly formatted

```liquid
# WRONG
"Authorization": "{{ context.constants.API_KEY }}"

# CORRECT
"Authorization": "Bearer {{ context.constants.API_KEY }}"
```

### Missing Headers

**Issue**: Required headers not included

```liquid
# WRONG - Missing Content-Type
{% api_call 'service' %}
  to: https://api.example.com/data
  format: json
  request_type: POST
{% endapi_call %}

{
  "key": "value"
}

# CORRECT
request_headers: |
  {
    "Content-Type": "application/json"
  }
```

## Request Issues

### Timeout Errors

**Issue**: API call exceeds default timeout (30 seconds)

**Solution**:
- Increase timeout in configuration
- Optimize request payload
- Use background jobs for long-running tasks

```liquid
<!-- Use async for long operations -->
{% api_call 'large_export' async: true %}
  to: https://api.example.com/export
  format: json
  request_type: POST
{% endapi_call %}
```

### Request Body Encoding

**Issue**: Characters not properly encoded

```liquid
# Escape special characters
{% assign escaped_text = form.fields.message | escape_json %}

{
  "message": "{{ escaped_text }}"
}
```

### Large Request Payloads

**Issue**: Request too large causes failure

**Solution**: Break into smaller requests or use pagination

```liquid
{% assign page = 0 %}
{% assign batch_size = 100 %}

{% for item in large_array %}
  <!-- Process in batches -->
{% endfor %}
```

## Response Handling Issues

### JSON Parsing Errors

**Issue**: Response not valid JSON

```liquid
# Check response before parsing
{% if response_text contains '{' %}
  {{ response | parse_json }}
{% else %}
  <!-- Handle non-JSON response -->
{% endif %}
```

### Null Response

**Issue**: API returns empty response

```liquid
# WRONG
{{ api_response.response.user.name }}

# CORRECT - Check for existence
{% if api_response.response and api_response.response.user %}
  {{ api_response.response.user.name }}
{% else %}
  User not found
{% endif %}
```

### Missing Response Fields

**Issue**: Field doesn't exist in response

```liquid
# WRONG
<p>{{ api_response.response.address.zip_code }}</p>

# CORRECT - Safe navigation
{% if api_response.response.address %}
  <p>{{ api_response.response.address.zip_code }}</p>
{% endif %}
```

## Rate Limiting

### 429 Too Many Requests

**Issue**: Hit API rate limit

**Solution**:
```liquid
{% if api_response.status == 429 %}
  <!-- Wait and retry -->
  {% assign retry_after = api_response.headers.retry-after | plus: 0 %}
  <!-- Implement exponential backoff -->
{% endif %}
```

### Prevent Rate Limiting

```liquid
<!-- Add delay between calls -->
{% assign request_count = 0 %}

{% for item in items %}
  {% if request_count >= 100 %}
    <!-- Hit limit, wait -->
    {% break %}
  {% endif %}

  {% api_call 'service' %}
    to: https://api.example.com/endpoint
    format: json
    request_type: POST
  {% endapi_call %}

  {% assign request_count = request_count | plus: 1 %}
{% endfor %}
```

## File Download Issues

### File Size Exceeds 50MB

**Issue**: Cannot download file larger than 50MB

```liquid
{% api_call 'download_large' %}
  to: https://cdn.example.com/file.zip
  format: binary
  request_type: GET
{% endapi_call %}

{% assign file_size = download_large.headers.content-length %}

{% if file_size > 52428800 %}
  <!-- File too large -->
  <p>File exceeds 50MB limit</p>
{% else %}
  <!-- Download allowed -->
{% endif %}
```

### Broken Download Links

**Issue**: Download returns 404 or empty file

**Solution**:
```liquid
{% if download_file.status == 200 %}
  {% assign size = download_file.headers.content-length %}

  {% if size > 0 %}
    <a href="{{ download_file.response }}">
      Download File
    </a>
  {% else %}
    <!-- File is empty -->
  {% endif %}
{% else %}
  <!-- Download failed -->
{% endif %}
```

## Async Job Issues

### Job Not Completing

**Issue**: Background job hangs or never completes

**Solution**:
```liquid
<!-- Check job status -->
{% graphql 'check_job' %}
  query {
    backgroundJob(id: "{{ job_id }}") {
      status
      progress
    }
  }
{% endgraphql %}

{% if check_job.backgroundJob.status == 'failed' %}
  <p>Job failed: {{ check_job.backgroundJob.error }}</p>
{% endif %}
```

### Async Response Timing

**Issue**: Polling for job results times out

**Solution**: Implement webhook callback instead

```liquid
<!-- Provide webhook URL for completion notification -->
{
  "callback_url": "{{ context.request.url }}/webhook",
  "job_id": "{{ unique_job_id }}"
}
```

## Network and Connectivity

### Connection Timeout

**Issue**: Cannot reach external API

**Cause**: Network unavailable, DNS failure, firewall block

**Solution**:
```liquid
{% if api_response.error %}
  <!-- Connection failed -->
  <p>Service temporarily unavailable</p>
{% endif %}
```

### SSL/TLS Certificate Issues

**Issue**: "Certificate verification failed"

**Solution**:
- Verify endpoint uses valid HTTPS certificate
- Check certificate expiration
- Contact API provider if expired

## Error Response Parsing

### API Returns Error Messages

**Issue**: Difficulty extracting error details

```liquid
{% api_call 'service' %}
  to: https://api.example.com/data
  format: json
  request_type: POST
{% endapi_call %}

{% if service.status >= 400 %}
  <!-- Extract error details -->
  {% assign error_message = service.response.error.message | default: 'Unknown error' %}
  <p>Error: {{ error_message }}</p>
{% endif %}
```

## Webhook Security

### Invalid Webhook Signature

**Issue**: Signature verification fails

```liquid
{% assign received_sig = context.request.headers.X_Webhook_Signature %}
{% assign computed_sig = payload | hmac_sha256: context.constants.WEBHOOK_SECRET %}

{% unless received_sig == computed_sig %}
  <!-- Reject webhook - signature mismatch -->
  <!-- Return 403 Forbidden -->
{% endunless %}
```

### Missing Webhook Validation

**Issue**: Processing unsigned webhooks

**Solution**: Always validate webhook signature before processing

## See Also

- [API Calls Configuration](./configuration.md)
- [API Calls Patterns](./patterns.md)
- [CLI Troubleshooting](../cli/gotchas.md)
