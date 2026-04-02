# Advanced Routing

Advanced techniques for complex routing scenarios, content negotiation, and performance optimization.

## Wildcard Catch-All Routes

Capture entire path segments for flexible routing patterns.

### Basic Wildcard

Wildcard prefix `*` captures remaining path as single parameter:

```
app/views/pages/*path.liquid
```

Handles any URL: `/anything`, `/deep/nested/path`, `/files/2025/report.pdf`

Access the full path:

```liquid
Full path: {{ context.params.path }}
```

### Multi-Level Wildcard Processing

Process wildcard path into components:

```liquid
<!-- File: app/views/pages/docs/*slug.liquid -->
<!-- URL: /docs/api/v2/authentication -->

{% assign parts = context.params.slug | split: "/" %}
{% assign section = parts[0] %} → "api"
{% assign version = parts[1] %} → "v2"
{% assign topic = parts[2] %} → "authentication"

<h1>{{ section | capitalize }} - {{ version }}</h1>
<p>{{ topic | replace: "-", " " | capitalize }}</p>
```

### Deep File Paths

Serve files from deeply nested directories:

```
app/views/pages/files/*filepath.liquid
```

Handle files in arbitrary structure:

```liquid
<!-- URL: /files/documents/2025/Q1/report.pdf -->
{{ context.params.filepath }} → "documents/2025/Q1/report.pdf"

<!-- Process for download/display -->
{% assign filename = context.params.filepath | split: "/" | last %}
File: {{ filename }}
```

## Optional Segments

Make path segments optional with parentheses syntax.

### Single Optional Segment

```
app/views/pages/posts(/:page).liquid
```

Matches: `/posts` and `/posts/2` and `/posts/latest`

Access with fallback:

```liquid
{% assign page = context.params.page | default: 1 %}
Showing page {{ page }}
```

### Multiple Optional Segments

```
app/views/pages/api(/:version)/data.liquid
```

Matches: `/api/data`, `/api/v1/data`, `/api/v2/data`

Process with conditional logic:

```liquid
{% if context.params.version %}
  API v{{ context.params.version }}
{% else %}
  API (default version)
{% endif %}
```

### Nested Optional Routes

```
app/views/pages/search(/:category)(/:tag).liquid
```

Matches: `/search`, `/search/tech`, `/search/tech/ruby`

Handle progressively:

```liquid
{% assign category = context.params.category %}
{% assign tag = context.params.tag %}

{% if category %}
  Results in: {{ category }}
  {% if tag %}
    Tagged with: {{ tag }}
  {% endif %}
{% else %}
  All categories
{% endif %}
```

## Route Priority and Matching Order

Routes are matched by specificity. Most specific matches first.

### Specificity Hierarchy

1. Exact static routes (highest)
   ```
   /blog/latest.liquid → matches exactly /blog/latest
   ```

2. Static with parameters
   ```
   /blog/:year/:month/:day.liquid → matches /blog/2025/02/06
   ```

3. Optional segments
   ```
   /posts(/:id).liquid → matches /posts and /posts/123
   ```

4. Wildcard routes (lowest)
   ```
   /docs/*path.liquid → matches /docs/anything/deeply/nested
   ```

### Conflict Resolution

When multiple routes could match, platformOS uses most specific:

```
Files:
  /products/latest.liquid
  /products/:id.liquid
  /products/*.liquid

URL: /products/latest
Matches: /products/latest.liquid (exact static route)

URL: /products/123
Matches: /products/:id.liquid (parameter route)

URL: /products/featured/bestsellers
Matches: /products/*.liquid (only wildcard matches)
```

### Preventing Conflicts

Order matters - define specific routes before general:

```
CORRECT ORDER:
1. app/views/pages/posts/latest.liquid
2. app/views/pages/posts/:id.liquid
3. app/views/pages/*path.liquid

INCORRECT ORDER:
1. app/views/pages/*path.liquid (matches everything!)
2. app/views/pages/posts/:id.liquid (never reached)
```

## Content Negotiation

Serve different formats based on file extension.

### Extension-Based Routing

Same route, different files for different formats:

```
app/views/pages/products/:id.liquid → HTML
app/views/pages/products/:id.json.liquid → JSON
app/views/pages/products/:id.xml.liquid → XML
app/views/pages/products/:id.csv.liquid → CSV
```

Separate requests automatically by extension:

```
GET /products/42 → products/:id.liquid (HTML)
GET /products/42.json → products/:id.json.liquid (JSON)
GET /products/42.xml → products/:id.xml.liquid (XML)
```

Each file sets appropriate Content-Type automatically based on extension.

### Accept Header Negotiation

Detect requested format via Accept header:

```liquid
<!-- File: products/:id.liquid -->
{% assign accept = context.headers["Accept"] %}

{% if accept contains "application/json" %}
  {
    "product": {
      "id": {{ product.id | json }},
      "name": "{{ product.name }}"
    }
  }
{% elsif accept contains "application/xml" %}
  <?xml version="1.0"?>
  <product>
    <id>{{ product.id }}</id>
    <name>{{ product.name }}</name>
  </product>
{% else %}
  <h1>{{ product.name }}</h1>
  <p>Price: ${{ product.price }}</p>
{% endif %}
```

## Programmatic Redirects

Control redirects with logic and parameters.

### Conditional Redirects

```liquid
{% if user.admin %}
  <!-- Admin only -->
{% elsif user.logged_in %}
  <!-- Regular user -->
{% else %}
  {% redirect_to "/login?next={{ context.location.pathname | url_encode }}" %}
{% endif %}
```

### Redirect with Status Code

```liquid
{% response_status 301 %}
{% redirect_to "/new-path" %}
```

Status codes:

- `301` - Permanent (search engines update links)
- `302` - Temporary (standard redirect)
- `303` - See Other (after POST redirect to GET)
- `307` - Temporary Redirect (preserve method)

### Query Parameter Preservation

Maintain query parameters across redirect:

```liquid
{% assign next_page = context.params.page | default: 1 %}
{% assign sort = context.params.sort | default: "date" %}

{% redirect_to "/posts?page={{ next_page }}&sort={{ sort }}" %}
```

### Redirect Loops Prevention

Track redirect history to prevent loops:

```liquid
{% assign redirect_count = context.params._redirect_count | to_integer %}

{% if redirect_count > 5 %}
  <!-- Prevent infinite redirect loop -->
  {% response_status 500 %}
  Redirect loop detected
{% else %}
  {% assign next_count = redirect_count | plus: 1 %}
  {% redirect_to "/page?_redirect_count={{ next_count }}" %}
{% endif %}
```

## Multi-Format Endpoints

Serve multiple representations of same resource.

### API with Multiple Formats

```
app/views/pages/api/v1/products/:id.json.liquid
app/views/pages/api/v1/products/:id.csv.liquid
app/views/pages/api/v1/products/:id.xml.liquid
app/views/pages/api/v1/products/:id.ics.liquid (calendar)
```

### Selecting Format via Query Parameter

```
app/views/pages/api/products/:id.liquid
```

Content:

```liquid
{% assign format = context.params.format | default: "json" %}

{% if format == "csv" %}
  {% response_headers "Content-Type" | add: "text/csv" %}
  name,sku,price
  "{{ product.name }}",{{ product.sku }},{{ product.price }}
{% elsif format == "xml" %}
  {% response_headers "Content-Type" | add: "application/xml" %}
  <?xml version="1.0"?>
  <product>
    <name>{{ product.name }}</name>
  </product>
{% else %}
  {% response_headers "Content-Type" | add: "application/json" %}
  { "product": { "name": "{{ product.name }}" } }
{% endif %}
```

Access: `/api/products/42?format=csv`

## Advanced Caching Strategies

### Cache Headers by Route Pattern

```liquid
<!-- Static content: long cache -->
{% response_headers "Cache-Control" | add: "public, max-age=86400" %}

<!-- User-specific content: no cache -->
{% if user.logged_in %}
  {% response_headers "Cache-Control" | add: "no-cache, private" %}
{% endif %}

<!-- API responses: moderate cache -->
{% response_headers "Cache-Control" | add: "max-age=300" %}
```

### ETags for Conditional Requests

```liquid
{% assign content_hash = product | md5 %}
{% response_headers "ETag" | add: "\"{{ content_hash }}\"" %}

{% if context.headers["If-None-Match"] contains content_hash %}
  {% response_status 304 %}
{% endif %}
```

## See Also

- [Configuration](./configuration.md) - Slug syntax, route matching rules
- [API Reference](./api.md) - context properties and methods
- [Patterns](./patterns.md) - RESTful routes, common patterns
- [Troubleshooting](./gotchas.md) - Common errors and solutions
