# Liquid Tags -- Configuration Reference

Complete parameter and option reference for every platformOS Liquid tag.

## graphql

Executes a GraphQL query or mutation defined in `app/graphql/`.

```liquid
{% graphql result = "query_name", param1: value1, param2: value2 %}
{% graphql result = "query_name", args: json_hash %}
```

Inline form (query defined in-place):

```liquid
{% graphql result %}
  query { records(per_page: 10, filter: { table: { value: "my_table" } }) { results { id } } }
{% endgraphql %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| result variable | String | Yes | Variable name to store the query result |
| query name | String | Yes (file form) | Path to `.graphql` file relative to `app/graphql/` |
| named args | Any | No | Individual arguments passed to the query |
| `args` | Hash | No | Pass all arguments as a single hash object |

## function

Calls a partial and captures its return value. Variables are local -- only passed args are accessible.

```liquid
{% function result = 'path/to/partial', arg1: value1, arg2: value2 %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| result variable | String | Yes | Variable to store the returned value |
| partial path | String | Yes | Path relative to `app/views/partials/` (no `.liquid`) |
| named args | Any | No | Arguments passed into the partial scope |

## render

Renders a partial template. Output is inserted in place. Variables are local.

```liquid
{% render 'path/to/partial', var1: value1, var2: value2 %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| partial path | String | Yes | Path relative to `app/views/partials/` |
| named args | Any | No | Variables available inside the partial |

## background

Executes enclosed code asynchronously in a background job.

```liquid
{% background source_name: 'job_name', delay: 0.5, priority: 'default', max_attempts: 3 %}
  ... async code ...
{% endbackground %}
```

Partial form:

```liquid
{% background job = 'path/to/partial', arg1: val, delay: 1, priority: 'high' %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source_name` | String | -- | Job identifier for logging and tracking |
| `delay` | Float | `0` | Minutes to delay before execution |
| `priority` | String | `"default"` | `"low"`, `"default"`, or `"high"` |
| `max_attempts` | Integer | `1` | Retry count on failure (1-5) |

## cache

Caches rendered output of the enclosed block.

```liquid
{% cache 'unique_key', expire: 3600 %}
  ... expensive rendering ...
{% endcache %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| key | String | -- | Unique cache identifier |
| `expire` | Integer | -- | Time-to-live in seconds |

## assign (hash/array literals)

Assigns a hash or array literal directly to a variable. This is the modern replacement for the deprecated `parse_json` block tag.

```liquid
{% assign variable_name = { "key": "value", "items": [1, 2, 3] } %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| variable name | String | Yes | Variable to store the hash or array |

## redirect_to

Issues an HTTP redirect to the client.

```liquid
{% redirect_to '/target/path' %}
{% redirect_to url_variable, status: 301 %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| path | String | -- | Target URL (absolute or relative) |
| `status` | Integer | `302` | HTTP status code (301 or 302) |

## session

Sets or clears a session variable. Assign `null` to clear.

```liquid
{% session key_name = value %}
{% session key_name = null %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| key | String | Yes | Session variable name |
| value | Any | Yes | Value to store (`null` to clear) |

## log

Writes to the environment log (visible via `pos-cli logs`).

```liquid
{% log variable %}
{% log data, type: 'error', env: 'staging' %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| value | Any | -- | Data to log (objects are serialized) |
| `type` | String | `"info"` | Log level: `"debug"`, `"info"`, `"error"` |
| `env` | String | all | Restrict to environment: `"staging"` or `"production"` |

## sign_in

Authenticates a user by their ID and creates a session.

```liquid
{% sign_in user_id: id, timeout_in_minutes: 60 %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `user_id` | Integer | -- | The user's database ID |
| `timeout_in_minutes` | Integer | platform default | Session timeout duration |

## transaction

Wraps operations in a database transaction. All-or-nothing semantics.

```liquid
{% transaction timeout: 5 %}
  ... database operations ...
{% endtransaction %}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timeout` | Integer | platform default | Transaction timeout in seconds |

## try / catch

Exception handling. The catch block receives the error object.

```liquid
{% try %}
  ... risky code ...
{% catch error_variable %}
  ... handle error ...
{% endtry %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| error variable | String | Yes | Variable name for the caught error |

## export

Makes a variable accessible outside the partial via `context.exports`.

```liquid
{% export variable_name, namespace: 'my_namespace' %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| variable | Any | Yes | The variable to export |
| `namespace` | String | Yes | Namespace key in `context.exports` |

## return

Returns a value from a partial invoked via `function`. Stops partial execution.

```liquid
{% return result_variable %}
```

## content_for / yield

Stores markup blocks for later rendering in layouts.

```liquid
{% content_for 'block_name' %}
  ... markup ...
{% endcontent_for %}

{% yield 'block_name' %}
```

## response_status

Sets the HTTP response status code.

```liquid
{% response_status 404 %}
```

## response_headers

Sets custom HTTP response headers. Accepts a JSON string.

```liquid
{% response_headers '{"Content-Type": "application/json", "X-Custom": "value"}' %}
```

## assign (hash key mutation)

Modifies a hash value by key path (supports nested keys). This is the modern replacement for the deprecated `hash_assign` tag.

```liquid
{% assign obj["key"] = "value" %}
{% assign obj["nested"]["key"] = value %}
```

## print

Outputs a variable WITHOUT HTML escaping. Use with caution -- XSS risk with user input.

```liquid
{% print html_content %}
```

## spam_protection

Generates CAPTCHA/spam protection markup.

```liquid
{% spam_protection "recaptcha_v2" %}
{% spam_protection "recaptcha_v3", action: "signup" %}
{% spam_protection "hcaptcha" %}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| provider | String | Yes | `"recaptcha_v2"`, `"recaptcha_v3"`, `"hcaptcha"` |
| `action` | String | No | Action name (reCAPTCHA v3 only) |

## context (tag)

Sets the request-level locale.

```liquid
{% context language: 'de' %}
```

## rollback

Manually triggers a rollback inside a `transaction` block.

```liquid
{% rollback %}
```

## theme_render_rc

Renders a theme partial with configurable search paths.

```liquid
{% theme_render_rc 'partial_name' %}
```

## form / include_form

Legacy form tags. Prefer standard HTML `<form>` elements with `authenticity_token`.

```liquid
{% form %}...{% endform %}
{% include_form 'form_name' %}
```

## See Also

- [Tags Overview](README.md) -- introduction and key concepts
- [Tags API](api.md) -- compact syntax reference
- [Tags Patterns](patterns.md) -- common usage workflows
- [Tags Gotchas](gotchas.md) -- common errors and limits
- [Tags Advanced](advanced.md) -- optimization and edge cases
