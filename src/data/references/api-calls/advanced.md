# Advanced API Calls Techniques

## Circuit Breaker Pattern

### Prevent Cascading Failures

```liquid
{% assign api_failures = 0 %}
{% assign failure_threshold = 5 %}
{% assign circuit_open = false %}

{% if context.cache.api_circuit_failures %}
  {% assign api_failures = context.cache.api_circuit_failures %}
{% endif %}

{% if api_failures >= failure_threshold %}
  {% assign circuit_open = true %}
{% endif %}

{% unless circuit_open %}
  {% api_call 'external_service' %}
    to: https://api.example.com/data
    format: json
    request_type: GET
  {% endapi_call %}

  {% if external_service.status >= 500 %}
    {% assign api_failures = api_failures | plus: 1 %}
    {% assign context.cache.api_circuit_failures = api_failures %}
  {% else %}
    {% assign context.cache.api_circuit_failures = 0 %}
  {% endif %}
{% else %}
  <!-- Circuit open - use fallback -->
  <p>Service unavailable, using cached data</p>
{% endunless %}
```

## Exponential Backoff Retry Pattern

### Intelligent Retry Logic

```liquid
{% assign max_retries = 3 %}
{% assign retry_count = 0 %}
{% assign backoff_multiplier = 2 %}
{% assign success = false %}

{% for attempt in (1..max_retries) %}
  {% if success %}
    {% break %}
  {% endif %}

  {% api_call 'flaky_service' %}
    to: https://api.example.com/data
    format: json
    request_type: GET
  {% endapi_call %}

  {% if flaky_service.status == 200 %}
    {% assign success = true %}
  {% else %}
    {% assign retry_count = attempt %}
    {% assign wait_time = retry_count | times: backoff_multiplier %}
    <!-- In real scenario, implement actual delay -->
  {% endif %}
{% endfor %}

{% unless success %}
  <p>Service unavailable after {{ max_retries }} attempts</p>
{% endunless %}
```

## Request Deduplication

### Prevent Duplicate API Calls

```liquid
{% assign request_key = 'api_' | append: context.current_user.id | append: '_' | append: request_type %}

{% unless context.cache[request_key] %}
  {% api_call 'data_service' %}
    to: https://api.example.com/user/{{ context.current_user.id }}
    format: json
    request_type: GET
  {% endapi_call %}

  <!-- Cache response for request -->
  {% assign context.cache[request_key] = data_service.response %}
  {% assign context.cache[request_key | append: '_time'] = 'now' | date: '%s' %}
{% endunless %}

<!-- Use cached response -->
{% assign cached_response = context.cache[request_key] %}
```

## Request Batching

### Combine Multiple Requests

```liquid
{% assign user_ids = '1,2,3,4,5' | split: ',' %}

{% api_call 'batch_users' %}
  to: https://api.example.com/users/batch
  format: json
  request_type: POST
  request_headers: |
    {
      "Content-Type": "application/json"
    }
{% endapi_call %}

{
  "ids": [{% for id in user_ids %}"{{ id }}"{% unless forloop.last %},{% endunless %}{% endfor %}]
}
```

## Streaming Large Responses

### Process Large Data Sets

```liquid
{% assign page = 1 %}
{% assign all_records = '' %}
{% assign has_more = true %}

{% while has_more %}
  {% api_call 'paginated_data' %}
    to: https://api.example.com/records?page={{ page }}&limit=1000
    format: json
    request_type: GET
  {% endapi_call %}

  {% if paginated_data.response.items.size > 0 %}
    {% for item in paginated_data.response.items %}
      <!-- Process individual item -->
      {% assign processed = item.id | append: ',' %}
      {% assign all_records = all_records | append: processed %}
    {% endfor %}

    {% assign page = page | plus: 1 %}
  {% else %}
    {% assign has_more = false %}
  {% endif %}

  <!-- Avoid infinite loops -->
  {% if page > 100 %}
    {% assign has_more = false %}
  {% endif %}
{% endwhile %}
```

## Request Transformation Pipeline

### Process and Transform API Data

```liquid
{% api_call 'raw_data' %}
  to: https://api.example.com/source
  format: json
  request_type: GET
{% endapi_call %}

<!-- Transform response -->
{% assign transformed_data = '' %}

{% for item in raw_data.response.items %}
  {% assign transformed_item = '' %}
  {% assign transformed_item = item.id | append: '|' | append: item.name | append: '|' | append: item.value %}
  {% assign transformed_data = transformed_data | append: transformed_item | append: '
' %}
{% endfor %}

<!-- Store transformed data -->
{% graphql 'save_transformed' %}
  mutation {
    importData(data: "{{ transformed_data }}") {
      success
    }
  }
{% endgraphql %}
```

## Webhook Event Processing

### Advanced Webhook Handling

```liquid
<!-- Secure webhook endpoint -->
{% if context.request.request_method == 'POST' %}
  {% assign raw_body = context.request.raw_body %}
  {% assign signature = context.request.headers.X_Webhook_Signature %}

  <!-- Verify signature -->
  {% assign expected_sig = raw_body | hmac_sha256: context.constants.WEBHOOK_SECRET %}

  {% if signature != expected_sig %}
    <!-- Reject invalid webhook -->
  {% else %}
    {% assign payload = context.request.body_json %}

    {% case payload.event_type %}
      {% when 'user.created' %}
        {% graphql 'handle_user_created' %}
          mutation {
            userCreated(id: "{{ payload.data.user_id }}") {
              success
            }
          }
        {% endgraphql %}

      {% when 'user.updated' %}
        {% graphql 'handle_user_updated' %}
          mutation {
            userUpdated(id: "{{ payload.data.user_id }}") {
              success
            }
          }
        {% endgraphql %}

      {% when 'payment.completed' %}
        {% api_call 'notify_fulfillment' %}
          to: https://fulfillment.example.com/process
          format: json
          request_type: POST
        {% endapi_call %}

        {
          "order_id": "{{ payload.data.order_id }}",
          "amount": {{ payload.data.amount }}
        }
    {% endcase %}

    <!-- Return success to webhook provider -->
  {% endif %}
{% endif %}
```

## API Version Compatibility

### Handle Multiple API Versions

```liquid
{% assign api_version = context.constants.API_VERSION | default: 'v2' %}

{% api_call 'versioned_api' %}
  to: https://api.example.com/{{ api_version }}/data
  format: json
  request_type: GET
  request_headers: |
    {
      "Accept": "application/{{ api_version }}+json"
    }
{% endapi_call %}

<!-- Handle version-specific response formats -->
{% case api_version %}
  {% when 'v1' %}
    {{ versioned_api.response.result }}

  {% when 'v2' %}
    {{ versioned_api.response.data }}

  {% when 'v3' %}
    {{ versioned_api.response.content }}
{% endcase %}
```

## Distributed Transaction Pattern

### Multi-Step Coordinated Operations

```liquid
<!-- Step 1: Create order -->
{% graphql 'create_order' %}
  mutation {
    orderCreate(amount: {{ amount }}) {
      orderId
    }
  }
{% endgraphql %}

{% assign order_id = create_order.orderId %}

<!-- Step 2: Process payment -->
{% api_call 'payment_service' %}
  to: https://payment.example.com/charge
  format: json
  request_type: POST
{% endapi_call %}

{
  "order_id": "{{ order_id }}",
  "amount": {{ amount }}
}

<!-- Step 3: Verify payment -->
{% if payment_service.status == 200 %}
  <!-- Step 4: Fulfill order -->
  {% api_call 'fulfillment_service' %}
    to: https://fulfillment.example.com/ship
    format: json
    request_type: POST
  {% endapi_call %}

  {
    "order_id": "{{ order_id }}"
  }

  <!-- Step 5: Notify user -->
  {% graphql 'notify_user' %}
    mutation {
      userNotify(userId: {{ user_id }}, message: "Order confirmed") {
        success
      }
    }
  {% endgraphql %}
{% else %}
  <!-- Payment failed - rollback order -->
  {% graphql 'cancel_order' %}
    mutation {
      orderCancel(orderId: "{{ order_id }}") {
        success
      }
    }
  {% endgraphql %}
{% endif %}
```

## Response Caching Strategy

### Smart Cache Management

```liquid
{% assign cache_key = 'api_' | append: context.current_user.id %}
{% assign cache_ttl = 3600 %}

{% if context.cache[cache_key] %}
  {% assign cache_age = 'now' | date: '%s' | minus: context.cache[cache_key | append: '_time'] %}

  {% if cache_age < cache_ttl %}
    <!-- Use cached response -->
    {% assign response = context.cache[cache_key] %}
  {% else %}
    <!-- Cache expired, fetch fresh data -->
    {% api_call 'fresh_data' %}
      to: https://api.example.com/data
      format: json
      request_type: GET
    {% endapi_call %}

    {% assign context.cache[cache_key] = fresh_data.response %}
    {% assign context.cache[cache_key | append: '_time'] = 'now' | date: '%s' %}
    {% assign response = fresh_data.response %}
  {% endif %}
{% else %}
  <!-- No cache, fetch data -->
  {% api_call 'new_data' %}
    to: https://api.example.com/data
    format: json
    request_type: GET
  {% endapi_call %}

  {% assign context.cache[cache_key] = new_data.response %}
  {% assign context.cache[cache_key | append: '_time'] = 'now' | date: '%s' %}
  {% assign response = new_data.response %}
{% endif %}
```

## See Also

- [API Calls Patterns](./patterns.md)
- [API Calls Configuration](./configuration.md)
- [CLI Advanced Techniques](../cli/advanced.md)
