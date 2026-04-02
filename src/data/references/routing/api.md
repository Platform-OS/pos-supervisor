# Routing API Reference

Access URL parameters, location information, and control response behavior with platformOS routing API.

## context.params

Container for URL parameters and query string values. Populated automatically from URL and query string.

### Dynamic Route Parameters

```liquid
<!-- File: app/views/pages/posts/:id.liquid -->
<!-- URL: /posts/42 -->

{{ context.params.id }} → 42
```

### Multiple Parameters

```liquid
<!-- File: app/views/pages/users/:username/posts/:post_id.liquid -->
<!-- URL: /users/alice/posts/789 -->

{{ context.params.username }} → "alice"
{{ context.params.post_id }} → "789"
```

### Query String Parameters

```liquid
<!-- URL: /search?q=liquid&sort=date&page=2 -->

{{ context.params.q }} → "liquid"
{{ context.params.sort }} → "date"
{{ context.params.page }} → "2"
```

### Wildcard Parameters

```liquid
<!-- File: app/views/pages/files/*filepath.liquid -->
<!-- URL: /files/docs/2025/readme.txt -->

{{ context.params.filepath }} → "docs/2025/readme.txt"
```

### Type Casting

All params arrive as strings. Convert as needed:

```liquid
{{ context.params.id | to_integer }} → 42
{{ context.params.enabled | to_boolean }} → true
{{ context.params.price | to_float }} → 19.99
```

## context.location

URL and request location information.

### Properties

| Property | Type | Description | Example |
|----------|------|-------------|---------|
| `pathname` | string | URL path without query/hash | `/posts/42` |
| `search` | string | Query string with `?` | `?q=liquid&sort=date` |
| `host` | string | Domain with port | `example.com` or `localhost:3000` |
| `href` | string | Complete URL | `http://example.com/posts/42?id=1` |
| `protocol` | string | Protocol (http/https) | `https:` |

### Usage Examples

```liquid
<!-- Current pathname -->
{{ context.location.pathname }} → /posts/42

<!-- Full query string -->
{{ context.location.search }} → ?q=liquid&page=2

<!-- Request host -->
{{ context.location.host }} → example.com

<!-- Complete URL -->
{{ context.location.href }} → https://example.com/posts/42?id=1

<!-- Check protocol -->
{% if context.location.protocol == "https:" %}
  Secure connection
{% endif %}
```

## Response Control Tags

### redirect_to Tag

Redirect to another URL:

```liquid
{% redirect_to "/thank-you" %}
```

Redirects can include parameters:

```liquid
{% redirect_to "/posts/{{ context.params.id }}" %}
```

External redirects supported:

```liquid
{% redirect_to "https://external.com/page" %}
```

### response_status Tag

Set HTTP status code:

```liquid
{% response_status 404 %}
```

Common status codes:

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Default successful response |
| 201 | Created | POST endpoint success |
| 204 | No Content | Successful DELETE |
| 301 | Moved Permanently | Permanent redirect |
| 302 | Found | Temporary redirect |
| 304 | Not Modified | Cache indicator |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | Authentication required |
| 403 | Forbidden | Permission denied |
| 404 | Not Found | Resource missing |
| 500 | Server Error | Unexpected error |

Usage example:

```liquid
<!-- Check resource exists -->
{% if post %}
  {% response_status 200 %}
  {{ post.title }}
{% else %}
  {% response_status 404 %}
  Post not found
{% endif %}
```

### response_headers Tag

Set custom response headers:

```liquid
{% response_headers "Content-Security-Policy" | add: "default-src 'self'" %}
```

Multiple headers:

```liquid
{% response_headers "X-Custom-Header" | add: "value" %}
{% response_headers "Cache-Control" | add: "no-cache" %}
```

Common headers:

| Header | Purpose | Example |
|--------|---------|---------|
| `Content-Type` | Response format | `application/json` |
| `Cache-Control` | Caching rules | `max-age=3600` |
| `X-Custom-*` | Custom metadata | `X-API-Version: 2` |
| `Set-Cookie` | Session/auth | `sessionid=abc123` |
| `Access-Control-Allow-*` | CORS rules | `Access-Control-Allow-Origin: *` |

## URL Helpers

### Building URLs Dynamically

```liquid
<!-- Link to parameterized route -->
<a href="/posts/{{ post.id }}">Read post</a>

<!-- With query parameters -->
<a href="/search?q={{ search_term | url_encode }}&page=1">Search</a>

<!-- Complete URL construction -->
{{ context.location.protocol }}//{{ context.location.host }}/posts/{{ post.id }}
```

### URL Encoding

Encode values for safe URL inclusion:

```liquid
{{ "hello world" | url_encode }} → hello%20world
{{ "email@example.com" | url_encode }} → email%40example.com
```

## Request Detection

### AJAX Requests

Detect if request came from JavaScript:

```liquid
<!-- context.is_xhr checks X-Requested-With header -->
{% if context.is_xhr %}
  <!-- Return JSON instead of HTML -->
  {{ "success" | json }}
{% else %}
  <!-- Return HTML page -->
  {% redirect_to "/success" %}
{% endif %}
```

## See Also

- [Configuration](./configuration.md) - Slug syntax, content type mapping, front matter
- [Patterns](./patterns.md) - RESTful routes, API endpoints, conditional redirects
- [Advanced](./advanced.md) - Content negotiation, programmatic redirects, multi-format endpoints
- [Troubleshooting](./gotchas.md) - Common errors and solutions
