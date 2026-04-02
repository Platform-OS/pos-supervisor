# Liquid Objects: Configuration

Configuration and setup for platformOS Liquid global objects and scopes.

## Overview

platformOS provides powerful global objects for accessing context data, request information, and application state. These objects are always available in any template without explicit declaration.

## Global Objects Hierarchy

### Context Object
The primary global object containing all application state:
- `context.params` - Request parameters (URL, form, query)
- `context.session` - Session data storage
- `context.location` - Request URL information
- `context.environment` - Deployment environment details
- `context.is_xhr` - AJAX request flag
- `context.authenticity_token` - CSRF protection token
- `context.current_user` - DO NOT USE DIRECTLY (use context.exports)
- `context.constants` - Hidden constant values
- `context.headers` - HTTP request headers
- `context.cookies` - HTTP cookies
- `context.device` - Device/browser information
- `context.page` - Page metadata
- `context.language` - User language setting
- `context.flash` - One-time flash messages
- `context.modules` - Loaded module metadata
- `context.visitor` - Visitor information
- `context.exports` - Shared data from GraphQL/partials

## Loop Objects

### forloop Object
Available inside for loops:
- `forloop.first` - Boolean, true on first iteration
- `forloop.last` - Boolean, true on last iteration
- `forloop.index` - Current iteration number (1-based)
- `forloop.index0` - Current iteration number (0-based)
- `forloop.rindex` - Remaining iterations (1-based from end)
- `forloop.rindex0` - Remaining iterations (0-based from end)
- `forloop.length` - Total iterations
- `forloop.parentloop` - Parent loop object (for nested loops)

### tablerowloop Object
Available inside tablerow loops (extends forloop):
- `tablerowloop.col` - Current column number (1-based)
- `tablerowloop.col0` - Current column number (0-based)
- `tablerowloop.col_first` - Boolean, true on first column
- `tablerowloop.col_last` - Boolean, true on last column
- Plus all forloop properties

## Key Namespaces

### context.params
Unified parameter access:
```
context.params.page_id
context.params.search_query
context.params.user_name
```

### context.session
Persistent session storage:
```
context.session.user_preferences
context.session.shopping_cart
context.session.ui_state
```

### context.location
Request URL components:
```
context.location.pathname     # /products/slug
context.location.search       # ?sort=price&page=1
context.location.host         # example.com
context.location.href         # Full URL
context.location.origin       # Protocol + host
```

### context.device
User device information:
```
context.device.type           # mobile, tablet, desktop
context.device.brand          # Device manufacturer
context.device.name           # Device model
context.device.os             # Operating system
context.device.is_mobile      # Boolean
context.device.is_tablet      # Boolean
```

### context.page
Current page metadata:
```
context.page.id               # Page unique ID
context.page.slug             # URL slug
context.page.layout           # Layout name
context.page.metadata         # Custom metadata hash
context.page.title            # Page title
```

### context.headers
HTTP request headers:
```
context.headers['User-Agent']
context.headers['Accept-Language']
context.headers['X-Forwarded-For']
context.headers['Authorization']
```

### context.cookies
HTTP cookies:
```
context.cookies['session_id']
context.cookies['user_preferences']
```

### context.visitor
Visitor tracking:
```
context.visitor.ip            # Client IP address
context.visitor.country       # GeoIP country
context.visitor.city          # GeoIP city
context.visitor.timezone      # Detected timezone
```

### context.exports
Data from GraphQL/partials:
```
context.exports.user          # From include_partial with exports
context.exports.products      # From graphql query
context.exports.metadata      # Custom exported data
```

## Environment-Specific Configuration

### context.environment
```
context.environment.name      # 'staging' or 'production'
context.environment.is_staging
context.environment.is_production
context.environment.url       # Base URL
context.environment.api_url   # API base URL
```

## Best Practices

1. **Never use context.current_user directly** - Use context.exports instead
2. **Always check for nil values** - Users may not be logged in
3. **Use constants for config** - Access via context.constants (hidden from output)
4. **Validate headers** - Headers may be missing or lowercase
5. **Handle missing params** - Use default filters for safety
6. **Cache device detection** - Store result in variable for performance
7. **Use session for state** - Prefer session over URL parameters for sensitive data
8. **Respect visitor privacy** - Use visitor IP only when necessary

## Loop Object Conventions

### Using forloop Properties
```liquid
{%- for item in items -%}
  {%- if forloop.first -%}<ul>{%- endif -%}
  <li class="{% if forloop.last %}last{% endif %}">{{ item }}</li>
  {%- if forloop.last -%}</ul>{%- endif -%}
{%- endfor -%}
```

### Nested Loop Context
```liquid
{%- for category in categories -%}
  {%- for product in category.products -%}
    Current: {{ forloop.index }} / {{ forloop.length }}
    Parent: {{ forloop.parentloop.index }}
  {%- endfor -%}
{%- endfor -%}
```

## Security Considerations

1. **Never log context.current_user** - May contain sensitive data
2. **Validate context.params** - All user input requires validation
3. **Use authenticity_token** - Always include in forms
4. **Filter context.headers** - Only use trusted headers
5. **Sanitize context.cookies** - Treat as user input
6. **Don't expose visitor IP** - Use only in backend logs

## See Also

- [Objects API Reference](api.md)
- [Objects & Patterns](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
