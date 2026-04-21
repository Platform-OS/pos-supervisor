# platformOS Development Guide for LLM Agents

> **Essential Knowledge Base for AI Coding Agents**  
> Version: 2025-2026 | Last Updated: April 2026  
> Source: [platformOS Documentation](https://documentation.platformos.com/)

---

## Table of Contents

1. [Introduction & Architecture](#1-introduction--architecture)
2. [Directory Structure](#2-directory-structure)
3. [Core Concepts](#3-core-concepts)
4. [Pages & Layouts](#4-pages--layouts)
5. [Records & Tables](#5-records--tables)
6. [Properties](#6-properties)
7. [Forms](#7-forms)
8. [Liquid Templating](#8-liquid-templating)
9. [GraphQL API](#9-graphql-api)
10. [Users & Authentication](#10-users--authentication)
11. [Authorization Policies](#11-authorization-policies)
12. [Modules](#12-modules)
13. [Background Jobs](#13-background-jobs)
14. [Notifications](#14-notifications)
15. [Assets & Uploads](#15-assets--uploads)
16. [Best Practices](#16-best-practices)
17. [Common Gotchas & Pitfalls](#17-common-gotchas--pitfalls)
18. [Performance Optimization](#18-performance-optimization)
19. [Testing & CI/CD](#19-testing--cicd)
20. [System Limitations](#20-system-limitations)
21. [Data Import/Export](#22-data-importexport)
22. [Quick Reference](#23-quick-reference)
23. [Translations](#24-translations)
24. [Activity Feeds](#25-activity-feeds)
25. [JSON Documents](#26-json-documents)
26. [AI Embeddings](#27-ai-embeddings)
27. [Migrations](#28-migrations)

---

## 1. Introduction & Architecture

### What is platformOS?

platformOS is a **model-based application development platform** (PaaS) that enables developers to build web applications, APIs, and digital products without managing infrastructure. It combines:

- **Liquid templating** for views
- **GraphQL** for data queries and mutations
- **YAML configuration** for schema definition
- **Background job processing** for async operations
- **Built-in authentication & authorization**

### Key Architectural Principles

| Principle | Description |
|-----------|-------------|
| **Convention over Configuration** | File locations determine behavior |
| **Git-based Workflow** | Version control everything |
| **Multi-tenancy** | Multiple instances per codebase |
| **Serverless Backend** | No server management required |
| **Edge Caching** | Built-in CDN for performance |

### Development Workflow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Local     │───▶│    Test     │───▶│   Staging   │───▶│  Production │
│ Development │    │   Instance  │    │   Instance  │    │   Instance  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┘
                              pos-cli deploy
```

---

## 2. Directory Structure

### Required Directory Layout

```
project-root/
├── app/                          # Main application code
│   ├── assets/                   # Static files (CSS, JS, images)
│   ├── authorization_policies/   # Access control rules
│   ├── emails/                   # Email notification templates
│   ├── api_calls/                # API call notifications
│   ├── smses/                    # SMS notification templates
│   ├── forms/                    # Form configurations
│   ├── graphql/                  # GraphQL query files
│   ├── migrations/               # Data migration scripts
│   ├── schema/                   # Table definitions (YAML)
│   ├── views/
│   │   ├── layouts/              # Page layouts
│   │   ├── pages/                # Page definitions
│   │   └── partials/             # Reusable Liquid snippets
│   ├── config.yml                # App configuration
│   └── user.yml                  # User property definitions
├── modules/                      # External modules
│   └── MODULE_NAME/
│       ├── public/               # Publicly accessible files
│       └── private/              # IP-protected files
└── .pos                          # pos-cli configuration
```

### Critical File Locations

| Component | Required Path | Extension |
|-----------|---------------|-----------|
| Pages | `app/views/pages/` | `.liquid` |
| Layouts | `app/views/layouts/` | `.liquid` |
| Partials | `app/views/partials/` | `.liquid` |
| Tables | `app/schema/` | `.yml` |
| Forms | `app/forms/` | `.liquid` |
| GraphQL | `app/graphql/` | `.graphql` |
| Assets | `app/assets/` | any |

### Configuration Files

**`.pos` (pos-cli config):**
```yaml
staging:
  url: https://staging.example.com
  email: dev@example.com
production:
  url: https://www.example.com
  email: dev@example.com
```

**`app/config.yml`:**
```yaml
# Modules that can be deleted during deploy
modules_that_allow_delete_on_deploy:
  - my_module

# Other app-level configuration
```

---

## 3. Core Concepts

### The platformOS Data Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Client  │───▶│  Router  │───▶│  Liquid  │───▶│ GraphQL  │
│ Request  │    │  (Page)  │    │ Template │    │  Query   │
└──────────┘    └──────────┘    └──────────┘    └────┬─────┘
                                                     │
                                                ┌────▼─────┐
                                                │ Database │
                                                │ (Record) │
                                                └──────────┘
```

### Key Terminology

| Term | Definition |
|------|------------|
| **Instance** | A deployed environment (staging, production) |
| **Table** | Schema definition for data objects |
| **Record** | Individual data object instance |
| **Property** | Field/column definition |
| **Page** | Route handler + view template |
| **Layout** | Wrapper template for pages |
| **Partial** | Reusable template snippet |
| **Form** | Configuration for data submission |
| **Authorization Policy** | Access control rule |

---

## 4. Pages & Layouts

### Page Configuration

Pages are defined in `app/views/pages/` with `.liquid` extension. URL path is derived from file location unless `slug` is specified.

**File:** `app/views/pages/blog/post.html.liquid`
```liquid
---
slug: blog/:slug
layout: blog_layout
converter: markdown
authorization_policies:
  - valid_user_policy
---

<h1>{{ context.params.slug }}</h1>
<p>Author: {{ context.current_user.email }}</p>
```

### Page Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `slug` | String | URL pattern (e.g., `products/:id`) |
| `layout` | String | Layout template name |
| `converter` | String | `markdown`, `textile` |
| `authorization_policies` | Array | Policies to check |
| `response_headers` | Hash | Custom HTTP headers |
| `method` | String | HTTP method restriction |

### Dynamic URL Parameters

```yaml
# Required parameter
slug: products/:id
# Access: context.params.id

# Optional parameter
slug: search(/:country)(/:city)
# Matches: /search, /search/USA, /search/USA/NYC

# Wildcard parameter
slug: docs/*path
# Access: context.params.path (contains full remaining path)

# Optional wildcard
slug: docs(/*path)
# Matches: /docs and /docs/anything/here
```

### Layouts

**File:** `app/views/layouts/application.liquid`
```liquid
<!DOCTYPE html>
<html>
<head>
  <title>{{ page_title | default: 'My App' }}</title>
  {{ content_for_head }}
</head>
<body>
  {% render 'header' %}
  
  <main>
    {{ content_for_layout }}
  </main>
  
  {% render 'footer' %}
</body>
</html>
```

**Key Layout Variables:**
- `content_for_layout` - Page content injection point
- `content_for_head` - Head content (meta tags, styles)

### Context Object (Complete Reference)

The `context` object is the **only predefined global object** in platformOS Liquid. It is available in pages, partials, layouts, and notifications.

#### Authentication & User

```liquid
{{ context.current_user }}           # Current user object or null
{{ context.current_user.id }}        # User UUID
{{ context.current_user.email }}     # User email
{{ context.current_user.first_name }}# First name
{{ context.current_user.last_name }} # Last name
{{ context.current_user.slug }}      # User slug
{{ context.current_user.properties }}# Custom properties hash
```

#### Request Data

```liquid
{{ context.params }}                 # URL params + query string + form data
{{ context.params.id }}              # Named route parameter
{{ context.params.page }}            # Query string parameter
{{ context.headers }}                # HTTP headers hash
{{ context.headers.REQUEST_METHOD }} # GET, POST, etc.
{{ context.headers.PATH_INFO }}      # Request path
{{ context.cookies }}                # Cookies hash
{{ context.session }}                # Session data hash
```

#### Security

```liquid
{{ context.authenticity_token }}     # CSRF token for forms
{{ context.constants }}              # Sensitive config (API keys, secrets)
```

**Accessing Constants:**
```liquid
{{ context.constants.STRIPE_API_KEY }}
{{ context.constants.SENDGRID_API_KEY }}
```

Set constants via GraphQL:
```graphql
mutation {
  constant_set(name: "STRIPE_API_KEY", value: "sk_live_...")
}
```

#### Device & Environment

```liquid
{{ context.device }}                      # Device detection hash
{{ context.device.device_type }}          # desktop, smartphone, tablet, etc.
{{ context.device.browser }}              # Browser name
{{ context.device.os }}                   # Operating system
{{ context.environment }}                 # "staging" or "production"
```

#### Flash Messages

```liquid
{{ context.flash }}                       # Flash messages hash
{{ context.flash.notice }}                # Success message
{{ context.flash.alert }}                 # Error message
```

**Available Device Types:**
- `desktop`
- `smartphone`
- `tablet`
- `console`
- `portable media player`
- `tv`
- `car browser`
- `camera`

**Available HTTP Headers:**
- `SERVER_NAME`
- `REQUEST_METHOD`
- `PATH_INFO`
- `REQUEST_URI`
- `HTTP_AUTHORIZATION`

---

## 5. Records & Tables

### Defining Tables

Tables define data structure in `app/schema/` as YAML files.

**File:** `app/schema/blog_post.yml`
```yaml
name: blog_post
properties:
  - name: title
    type: string
  - name: content
    type: text
  - name: published_at
    type: datetime
  - name: author_id
    type: string
  - name: tags
    type: array
  - name: metadata
    type: jsonb
```

### Property Types Reference

| Type | Description | Liquid Equivalent |
|------|-------------|-------------------|
| `string` | Short text (255 chars) | String |
| `text` | Long text | String |
| `integer` | Whole numbers | Integer |
| `float` | Decimal numbers | Float |
| `boolean` | true/false | Boolean |
| `date` | Date only | Date |
| `datetime` | Date + Time | DateTime |
| `array` | List of values | Array |
| `jsonb` | JSON data | Hash |
| `geojson` | Geographic data | GeoJSON Object |
| `upload` | File attachment | Upload Object |

### Record Lifecycle

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Create │───▶│  Read   │───▶│ Update  │───▶│ Delete  │
│  record │    │  record │    │ record  │    │ record  │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
     │              │              │              │
  GraphQL       GraphQL        GraphQL        GraphQL
  mutation       query         mutation       mutation
```

### Creating Records via GraphQL

**File:** `app/graphql/records/create_blog_post.graphql`
```graphql
mutation create_blog_post(
  $title: String!
  $content: String!
  $author_id: String!
) {
  record_create(
    record: {
      table: "blog_post"
      properties: [
        { name: "title", value: $title }
        { name: "content", value: $content }
        { name: "author_id", value: $author_id }
      ]
    }
  ) {
    id
    created_at
    properties
  }
}
```

### Querying Records

**File:** `app/graphql/records/get_blog_posts.graphql`
```graphql
query get_blog_posts(
  $limit: Int = 10
  $published: Boolean = true
) {
  records(
    per_page: $limit
    filter: {
      table: { value: "blog_post" }
      properties: [
        { name: "published", value_boolean: $published }
      ]
    }
    sort: [{ created_at: { order: DESC } }]
  ) {
    results {
      id
      created_at
      properties
    }
    total_entries
    total_pages
  }
}
```

### CRUD Operations Summary

| Operation | GraphQL | Example |
|-----------|---------|---------|
| Create | `record_create` | Create new record |
| Read | `records`, `record` | Query records |
| Update | `record_update` | Modify existing |
| Delete | `record_delete` | Soft/hard delete |

---

## 6. Properties

### Property Configuration

Properties are defined in Table YAML files:

```yaml
properties:
  - name: status
    type: string
    default: draft
  
  - name: view_count
    type: integer
    default: 0
  
  - name: settings
    type: jsonb
  
  - name: tags
    type: array
```

### Array Properties

Arrays can store multiple values of any type:

```yaml
properties:
  - name: tags
    type: array
```

**GraphQL mutation:**
```graphql
mutation {
  record_create(
    record: {
      table: "blog_post"
      properties: [
        { name: "tags", value_array: ["tech", "news", "featured"] }
      ]
    }
  ) {
    id
  }
}
```

### JSONB Properties

Store complex nested data:

```yaml
properties:
  - name: metadata
    type: jsonb
```

**GraphQL mutation:**
```graphql
mutation {
  record_create(
    record: {
      table: "blog_post"
      properties: [
        { 
          name: "metadata", 
          value_json: "{\"seo_title\": \"My Post\", \"keywords\": [\"a\", \"b\"]}"
        }
      ]
    }
  ) {
    id
  }
}
```

### Upload Properties

Handle file uploads:

```yaml
properties:
  - name: avatar
    type: upload
```

**In forms:**
```liquid
{% form %}
  <input type="file" name="{{ form.fields.properties.avatar.name }}">
  <button>Upload</button>
{% endform %}
```

---

## 7. Forms

### Form Structure

Forms have two sections: YAML configuration + Liquid implementation.

**File:** `app/forms/contact_form.liquid`
```liquid
---
name: contact_form
resource: contact_message
resource_owner: anyone
redirect_to: /contact/thank-you
flash_notice: Message sent successfully!
fields:
  properties:
    name:
      validation:
        presence: true
    email:
      validation:
        presence: true
        email: true
    message:
      validation:
        presence: true
        length:
          minimum: 10
email_notifications:
  - contact_notification
authorization_policies:
  - not_spam_policy
---

{% form %}
  <div>
    <label>Name</label>
    <input type="text" name="{{ form.fields.properties.name.name }}" 
           value="{{ form.fields.properties.name.value }}">
    {% if form.fields.properties.name.errors %}
      <span class="error">{{ form.fields.properties.name.errors }}</span>
    {% endif %}
  </div>
  
  <div>
    <label>Email</label>
    <input type="email" name="{{ form.fields.properties.email.name }}"
           value="{{ form.fields.properties.email.value }}">
  </div>
  
  <div>
    <label>Message</label>
    <textarea name="{{ form.fields.properties.message.name }}">{{ form.fields.properties.message.value }}</textarea>
  </div>
  
  <button type="submit">Send</button>
{% endform %}
```

### Form Configuration Options

| Option | Description |
|--------|-------------|
| `name` | Unique form identifier |
| `resource` | Associated table name |
| `resource_owner` | `anyone`, `self`, `anyone_with_token` |
| `redirect_to` | URL after successful submission |
| `flash_notice` | Success message |
| `flash_alert` | Error message |
| `fields` | Field definitions and validation |
| `email_notifications` | Emails to send |
| `api_call_notifications` | API calls to make |
| `callback_actions` | Synchronous Liquid code |
| `async_callback_actions` | Background job code |
| `authorization_policies` | Access control |
| `default_payload` | JSON payload to merge |

### Validation Options

```yaml
fields:
  properties:
    email:
      validation:
        presence:
          message: Email is required
        email: true
        uniqueness:
          message: Email already exists
    password:
      validation:
        length:
          minimum: 8
          message: Password too short
        confirmation: true  # Requires password_confirmation field
    age:
      validation:
        numericality:
          greater_than: 0
          less_than: 150
    website:
      validation:
        url: true
```

### Rendering Forms in Pages

```liquid
---
slug: contact
---

<h1>Contact Us</h1>

{% render_form 'contact_form' %}

<!-- Or with custom HTML wrapper -->
<div class="form-container">
  {% render_form 'contact_form', class: 'contact-form' %}
</div>
```

### Form Object Structure

```liquid
{{ form.fields.properties.FIELD_NAME.name }}      # Input name attribute
{{ form.fields.properties.FIELD_NAME.value }}     # Current value
{{ form.fields.properties.FIELD_NAME.errors }}    # Validation errors
{{ form.errors }}                                  # All form errors
{{ form.valid? }}                                  # Boolean validation state
```

---

## 8. Liquid Templating

### platformOS Liquid Tags

#### Query Tag (GraphQL Execution)

```liquid
{% graphql my_query = 'get_blog_posts', limit: 10 %}

{% for post in my_query.records.results %}
  <h2>{{ post.properties.title }}</h2>
{% endfor %}
```

#### Background Tag (Async Jobs)

```liquid
{% background job_id = 'send_email', delay: 0.5, priority: 'high', max_attempts: 3 %}
  {% graphql result = 'send_notification', user_id: user_id %}
  {% log result %}
{% endbackground %}
```

**Background Options:**
- `delay`: Minutes to delay (default: 0)
- `priority`: `low`, `default`, `high`
- `max_attempts`: 1-5 retries (default: 1)
- `source_name`: Job identifier label

**CRITICAL:** Variables must be explicitly passed to background:
```liquid
{% background data: my_data, user_id: user.id %}
  {{ data }}  {# Available #}
  {{ my_data }}  {# NOT available - wasn't passed #}
{% endbackground %}
```

#### Include/Render Tags

```liquid
{# Include with local variables #}
{% include 'header', title: 'My Page', show_nav: true %}

{# Render (preferred - isolated scope) #}
{% render 'product_card', product: product %}

{# Render with collection #}
{% render 'product_card' for products as product %}
```

#### Function Tag

```liquid
{% function my_result = 'helpers/calculate_total', items: cart_items %}

{# In app/views/partials/helpers/calculate_total.liquid #}
{% return items | sum: 'price' %}
```

#### Parse JSON Tag

```liquid
{% parse_json my_data %}
  {
    "name": "John",
    "items": [1, 2, 3]
  }
{% endparse_json %}

{{ my_data.name }}  {# John #}
```

#### Cache Tag

Cache expensive operations to improve performance:

```liquid
{% cache key: 'sidebar_categories', expire: 3600 %}
  {% graphql categories = 'get_categories' %}
  {% for category in categories.records.results %}
    <a href="/categories/{{ category.id }}">{{ category.properties.name }}</a>
  {% endfor %}
{% endcache %}
```

**Cache Options:**
- `key` - Unique cache identifier
- `expire` - Cache lifetime in seconds
- `if` - Conditional caching

```liquid
{% cache key: 'user_stats', expire: 300, if: context.current_user %}
  {# Only cache for logged-in users #}
{% endcache %}
```

#### Log Tag

Debug by logging to instance logs:

```liquid
{% log 'Debug message' %}
{% log user_id: user.id, action: 'purchase' %}
{% log my_variable %}
```

View logs with: `pos-cli logs staging`

#### Content For Tag

Inject content into layouts:

```liquid
{# In page #}
{% content_for 'head' %}
  <meta name="description" content="{{ page.description }}">
  <link rel="canonical" href="{{ page.url }}">
{% endcontent_for %}

{# In layout #}
<head>
  {{ content_for_head }}
</head>
```

#### Yield Tag

Define content blocks in layouts:

```liquid
{# In layout #}
<aside>
  {% yield 'sidebar' %}
</aside>

{# In page #}
{% content_for 'sidebar' %}
  <div class="custom-sidebar">
    <h3>Related Links</h3>
  </div>
{% endcontent_for %}
```

#### Return Tag

Return values from function partials:

```liquid
{# app/views/partials/calculate_tax.liquid #}
{% assign tax = amount | times: 0.2 %}
{% return tax %}

{# Usage #}
{% function tax_amount = 'calculate_tax', amount: 100 %}
Tax: {{ tax_amount }}
```

#### Raw Tag

Prevent Liquid from processing content:

```liquid
{% raw %}
  {{ this will not be processed }}
  {% if true %}neither will this{% endif %}
{% endraw %}
```

#### Liquid Tag (New Syntax)

Use the new Liquid tag syntax for cleaner code:

```liquid
{% liquid
  assign user = context.current_user
  if user
    echo 'Hello, ' | append: user.first_name
  else
    echo 'Hello, Guest'
  endif
%}
```

### Complete platformOS Tag Reference

| Tag | Purpose |
|-----|---------|
| `{% graphql %}` | Execute GraphQL queries |
| `{% background %}` | Run async background jobs |
| `{% form %}` | Render form with CSRF protection |
| `{% render_form %}` | Include a form by name |
| `{% include %}` | Include partial (deprecated, use render) |
| `{% render %}` | Render partial with isolated scope |
| `{% function %}` | Call function partial with return value |
| `{% parse_json %}` | Parse JSON string to object |
| `{% cache %}` | Cache content fragment |
| `{% log %}` | Log to instance logs |
| `{% content_for %}` | Define content for layout blocks |
| `{% yield %}` | Insert content block in layout |
| `{% return %}` | Return value from function |
| `{% raw %}` | Disable Liquid processing |
| `{% liquid %}` | New multi-line Liquid syntax |

### platformOS Liquid Filters

#### Array Filters

```liquid
{# Add to array #}
{% assign new_array = old_array | add_to_array: 'new_item' %}

{# Compact - remove nil values #}
{% assign clean = array | compact %}

{# Group by property #}
{% assign grouped = products | group_by: 'category' %}

{# Map/extract property #}
{% assign names = users | map: 'name' %}

{# Sort by property #}
{% assign sorted = products | sort_by: 'price' %}

{# Sum array values #}
{{ order_items | sum: 'total' }}

{# Find unique values #}
{% assign unique_tags = all_tags | uniq %}
```

#### Date/Time Filters

```liquid
{{ 'now' | to_time }}
{{ '2024-01-15' | to_time | add_to_time: 1, 'week' }}
{{ 'now' | strftime: '%Y-%m-%d %H:%M' }}
{{ post.created_at | time_ago_in_words }}
```

#### Hash/Object Filters

```liquid
{# Merge hashes #}
{% assign combined = defaults | hash_merge: overrides %}

{# Get keys #}
{% assign keys = config | hash_keys %}

{# Get values #}
{% assign values = config | hash_values %}

{# Deep clone #}
{% assign copy = original | deep_clone %}
```

#### URL Filters

```liquid
{{ 'style.css' | asset_url }}
{{ 'photo.jpg' | asset_url | img_tag: 'Photo' }}
{{ user.avatar | default: 'default.png' | asset_url }}
```

#### String Filters

```liquid
{{ text | strip_html }}
{{ text | truncate: 100 }}
{{ text | truncatewords: 20 }}
{{ text | url_encode }}
{{ text | url_decode }}
{{ text | md5 }}
{{ text | sha1 }}
{{ text | hmac_sha256: secret_key }}
{{ text | base64_encode }}
{{ text | base64_decode }}
{{ text | html_safe }}           {# Mark as safe HTML #}
{{ text | sanitize }}            {# Sanitize HTML input #}
{{ text | escape_javascript }}   {# Escape for JS #}
{{ text | json }}                {# Convert to JSON #}
```

#### Number/Currency Filters

```liquid
{{ 1234.5 | round }}             {# 1235 #}
{{ 1234.5 | round: 1 }}          {# 1234.5 #}
{{ 1234.5 | ceil }}              {# 1235 #}
{{ 1234.5 | floor }}             {# 1234 #}
{{ 19.99 | amount_to_fractional: 'USD' }}  {# 1999 (cents) #}
{{ 1999 | fractional_to_amount: 'USD' }}   {# 19.99 #}
{{ 1234567 | format_number: 'en' }}        {# 1,234,567 #}
```

#### Encoding/Encryption Filters

```liquid
{{ 'text' | base64_encode }}
{{ 'ZW5jb2RlZA==' | base64_decode }}
{{ 'text' | md5 }}
{{ 'text' | sha1 }}
{{ 'text' | hmac_sha256: secret_key }}
{{ 'text' | encrypt: key, algorithm: 'aes-256-gcm' }}
{{ 'encrypted' | decrypt: key, algorithm: 'aes-256-gcm' }}
```

**Supported Encryption Algorithms:**
- `aes-128-cbc`, `aes-192-cbc`, `aes-256-cbc`
- `aes-128-gcm`, `aes-192-gcm`, `aes-256-gcm`
- `aes-128-ctr`, `aes-192-ctr`, `aes-256-ctr`
- And many more...

#### URL/Link Filters

```liquid
{{ 'style.css' | asset_url }}
{{ 'photo.jpg' | asset_url | img_tag: 'Alt text' }}
{{ 'photo.jpg' | asset_url | img_tag: 'Alt', 'class-name' }}
{{ '/path' | link_to: 'Click here' }}
{{ 'page' | app_url }}           {# Generate app URL #}
```

#### Debug/Development Filters

```liquid
{{ variable | debug }}           {# Debug output #}
{{ variable | inspect }}         {# Ruby-style inspect #}
{{ 'code' | time_diff }}         {# Measure execution time #}
```

### Complete platformOS Filter Reference

| Category | Filters |
|----------|---------|
| **Array** | `add_to_array`, `compact`, `group_by`, `map`, `sort_by`, `sum`, `uniq`, `flatten`, `shuffle`, `rotate`, `in_groups_of` |
| **Date** | `to_time`, `add_to_time`, `strftime`, `time_ago_in_words`, `date_add` |
| **Hash** | `hash_merge`, `hash_keys`, `hash_values`, `deep_clone` |
| **String** | `strip_html`, `truncate`, `truncatewords`, `url_encode`, `md5`, `sha1`, `hmac_sha256`, `base64_encode`, `sanitize`, `html_safe` |
| **Number** | `round`, `ceil`, `floor`, `format_number`, `amount_to_fractional`, `fractional_to_amount` |
| **URL** | `asset_url`, `img_tag`, `link_to`, `app_url` |
| **JSON** | `json`, `parse_json` |
| **Debug** | `debug`, `inspect`, `time_diff` |

### Whitespace Control

```liquid
{# Use hyphens to control whitespace #}
{%- if condition -%}
  No extra whitespace
{%- endif -%}

{# Output whitespace control #}
{{- variable -}}
```

---

## 9. GraphQL API

### Query Structure

All GraphQL queries are stored in `app/graphql/` with `.graphql` extension.

### Record Queries

**List Records:**
```graphql
query list_products(
  $page: Int = 1
  $per_page: Int = 20
  $category: String
) {
  records(
    per_page: $per_page
    page: $page
    filter: {
      table: { value: "product" }
      properties: [
        { name: "category", value: $category }
      ]
    }
    sort: [{ price: { order: ASC } }]
  ) {
    total_entries
    total_pages
    has_next_page
    has_previous_page
    results {
      id
      created_at
      updated_at
      deleted_at
      type_name
      properties
    }
  }
}
```

**Single Record:**
```graphql
query get_product($id: ID!) {
  record(id: $id) {
    id
    properties
  }
}
```

### Record Mutations

**Create:**
```graphql
mutation create_product(
  $name: String!
  $price: Float!
) {
  record_create(
    record: {
      table: "product"
      properties: [
        { name: "name", value: $name }
        { name: "price", value_float: $price }
      ]
    }
  ) {
    id
    properties
    errors {
      message
    }
  }
}
```

**Update:**
```graphql
mutation update_product(
  $id: ID!
  $name: String
) {
  record_update(
    id: $id
    record: {
      properties: [
        { name: "name", value: $name }
      ]
    }
  ) {
    id
    properties
  }
}
```

**Delete:**
```graphql
mutation delete_product($id: ID!) {
  record_delete(id: $id) {
    id
    deleted_at
  }
}
```

### User Queries

```graphql
# Get current user
query current_user {
  current_user {
    id
    email
    created_at
    properties
  }
}

# List users
query list_users {
  users {
    results {
      id
      email
      properties
    }
  }
}

# Create user
mutation create_user(
  $email: String!
  $password: String!
) {
  user_create(
    user: {
      email: $email
      password: $password
    }
  ) {
    id
    email
  }
}
```

### Pagination

```graphql
query paginated_records(
  $page: Int = 1
  $per_page: Int = 20
) {
  records(
    page: $page
    per_page: $per_page
    filter: { table: { value: "post" } }
  ) {
    total_entries
    total_pages
    has_next_page
    has_previous_page
    results { id }
  }
}
```

### Filtering

```graphql
query filtered_records {
  records(
    filter: {
      table: { value: "product" }
      properties: [
        { name: "status", value: "active" }
        { name: "price", range: { gte: 10, lte: 100 } }
      ]
      created_at: { gte: "2024-01-01" }
    }
  ) {
    results { id }
  }
}
```

---

## 10. Users & Authentication

### User Properties

Define custom user properties in `app/user.yml`:

```yaml
properties:
  - name: role
    type: string
    default: customer
  - name: first_name
    type: string
  - name: last_name
    type: string
  - name: last_sign_in_at
    type: datetime
```

### Built-in User Fields

| Field | Description |
|-------|-------------|
| `email` | Unique identifier (case-insensitive) |
| `password` | Virtual field (bcrypt2 hashed) |
| `encrypted_password` | Stored hash |
| `created_at` | Registration timestamp |
| `updated_at` | Last update timestamp |

### Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Sign Up   │────▶│   Sign In   │────▶│   Session   │
│   (Form)    │     │   (Form)    │     │  (Cookie)   │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                       ┌──────┴──────┐
                                       ▼             ▼
                                ┌──────────┐  ┌──────────┐
                                │  Logout  │  │  Access  │
                                │  (Form)  │  │  Pages   │
                                └──────────┘  └──────────┘
```

### Session Management

```liquid
{# Check if user is logged in #}
{% if context.current_user %}
  <p>Welcome, {{ context.current_user.email }}</p>
{% else %}
  <a href="/sign-in">Sign In</a>
{% endif %}

{# Access user properties #}
{{ context.current_user.properties.role }}
{{ context.current_user.properties.first_name }}
```

### Sign In Form

**File:** `app/forms/sign_in_form.liquid`
```liquid
---
name: sign_in_form
resource: session
resource_owner: anyone
redirect_to: /
flash_alert: Invalid email or password
---

{% form %}
  <input type="email" name="{{ form.fields.email.name }}">
  <input type="password" name="{{ form.fields.password.name }}">
  <button>Sign In</button>
{% endform %}
```

### Sign Up Form

**File:** `app/forms/sign_up_form.liquid`
```liquid
---
name: sign_up_form
resource: user
resource_owner: anyone
redirect_to: /welcome
flash_notice: Account created!
fields:
  email:
    validation:
      presence: true
      email: true
      uniqueness: true
  password:
    validation:
      presence: true
      length:
        minimum: 8
---

{% form %}
  <input type="email" name="{{ form.fields.email.name }}">
  <input type="password" name="{{ form.fields.password.name }}">
  <button>Sign Up</button>
{% endform %}
```

---

## 11. Authorization Policies

### Creating Policies

**File:** `app/authorization_policies/valid_user.liquid`
```liquid
---
name: valid_user_policy
redirect_to: /sign-in
flash_alert: Please sign in to access this page
---

{% if context.current_user %}
  true
{% else %}
  false
{% endif %}
```

### Policy Configuration

| Option | Description |
|--------|-------------|
| `name` | Policy identifier |
| `redirect_to` | Where to redirect if policy fails |
| `flash_alert` | Error message on failure |

### Associating with Pages

```liquid
---
slug: admin/dashboard
authorization_policies:
  - valid_user_policy
  - admin_only_policy
---
```

### Associating with Forms

```liquid
---
name: delete_product_form
resource: product
authorization_policies:
  - valid_user_policy
  - product_owner_policy
---
```

### Common Policy Patterns

**Admin Only:**
```liquid
{% if context.current_user.properties.role == 'admin' %}
  true
{% else %}
  false
{% endif %}
```

**Resource Owner:**
```liquid
{% graphql product = 'get_product', id: context.params.id %}
{% if product.record.properties.owner_id == context.current_user.id %}
  true
{% else %}
  false
{% endif %}
```

---

## 12. Modules

### Module Structure

```
modules/
└── my_module/
    ├── public/
    │   ├── views/
    │   ├── forms/
    │   ├── graphql/
    │   └── assets/
    └── private/
        ├── views/
        └── forms/
```

### Module Namespacing

All module files are prefixed with `modules/MODULE_NAME/`:

```liquid
{# Reference module partial #}
{% render 'modules/my_module/header' %}

{# Reference module GraphQL #}
{% graphql result = 'modules/my_module/get_data' %}

{# Reference module form #}
{% render_form 'modules/my_module/contact_form' %}

{# Reference module asset #}
{{ 'modules/my_module/style.css' | asset_url }}
```

### Installing Modules

```bash
# Install from Partner Portal
pos-cli modules install module_name

# Install specific version
pos-cli modules install module_name@1.2.3
```

### Overwriting Module Files

Create a file with the same path in your `app` directory:

```
app/
└── views/
    └── partials/
        └── modules/
            └── my_module/
                └── header.liquid  # Overrides module version
```

### Creating Modules

1. Create directory: `modules/MODULE_NAME/`
2. Add `public/` and/or `private/` subdirectories
3. Structure mirrors `app/` directory
4. Deploy with `pos-cli deploy`

---

## 13. Background Jobs

### When to Use Background Jobs

| Use Case | Example |
|----------|---------|
| Email sending | Welcome emails, notifications |
| API calls | Webhooks, external integrations |
| Data processing | Imports, exports, reports |
| Scheduled tasks | Daily cleanup, reminders |
| Long operations | Image processing, batch updates |

### Background Tag Syntax

```liquid
{% background 
  job_id = 'unique_job_id',
  delay: 5.0,           # Delay in minutes
  priority: 'high',      # low, default, high
  max_attempts: 3,       # 1-5 retries
  source_name: 'my_job'  # Human-readable label
%}
  {# Your async code here #}
  {% graphql result = 'send_email', to: email %}
  {% log result %}
{% endbackground %}
```

### Priority Levels

| Priority | Max Execution | Use Case |
|----------|---------------|----------|
| `high` | 1 minute | Critical, time-sensitive |
| `default` | 5 minutes | Standard operations |
| `low` | 60 minutes | Background processing |

### Variable Passing

```liquid
{% assign user_id = context.current_user.id %}
{% assign data = '{"key": "value"}' | parse_json %}

{% background user_id: user_id, data: data %}
  {# Variables available: user_id, data, context #}
  {% graphql user = 'get_user', id: user_id %}
  {% log user %}
{% endbackground %}
```

**IMPORTANT:** Only explicitly passed variables are available inside background blocks.

### Monitoring Jobs

```graphql
query list_background_jobs {
  background_jobs(
    per_page: 10
    sort: [{ created_at: { order: DESC } }]
  ) {
    results {
      id
      source_name
      priority
      attempts
      max_attempts
      created_at
      started_at
      completed_at
      failed_at
      error_message
    }
  }
}
```

---

## 14. Notifications

### Email Notifications

**File:** `app/emails/welcome_user.liquid`
```liquid
---
name: welcome_user
to: '{{ form.email }}'
from: 'noreply@example.com'
subject: 'Welcome to Our Platform!'
layout: mailer
---

<h1>Welcome, {{ form.name }}!</h1>
<p>Thank you for joining us.</p>

<p><a href="{{ 'dashboard' | app_url }}">Get Started</a></p>
```

**Email Configuration Options:**

| Option | Description |
|--------|-------------|
| `name` | Notification identifier |
| `to` | Recipient email (Liquid) |
| `from` | Sender email |
| `subject` | Email subject (Liquid) |
| `layout` | Email layout template |
| `bcc` | BCC recipients |
| `cc` | CC recipients |

### SMS Notifications

**File:** `app/smses/verification_code.liquid`
```liquid
---
name: verification_code
to: '{{ form.phone_number }}'
---

Your verification code is: {{ form.verification_code }}
```

### API Call Notifications

**File:** `app/api_calls/webhook.liquid`
```liquid
---
name: webhook_notification
to: 'https://api.example.com/webhook'
format: json
callback: ''
request_type: POST
headers: >
  {
    "Authorization": "Bearer {{ context.constants.api_key }}",
    "Content-Type": "application/json"
  }
---

{
  "event": "user_signup",
  "user_id": "{{ form.id }}",
  "email": "{{ form.email }}",
  "timestamp": "{{ 'now' | to_time }}"
}
```

### Triggering Notifications

From forms:
```yaml
---
name: contact_form
email_notifications:
  - contact_confirmation
  - admin_notification
api_call_notifications:
  - crm_webhook
sms_notifications:
  - sms_confirmation
---
```

---

## 15. Assets & Uploads

### Assets (Static Files)

Assets are files in `app/assets/` that are served via CDN.

**Directory Structure:**
```
app/assets/
├── css/
│   └── app.css
├── js/
│   └── app.js
├── images/
│   └── logo.png
└── fonts/
    └── custom.woff2
```

**Using Assets:**
```liquid
<link rel="stylesheet" href="{{ 'css/app.css' | asset_url }}">
<script src="{{ 'js/app.js' | asset_url }}"></script>
<img src="{{ 'images/logo.png' | asset_url }}" alt="Logo">
```

### User Uploads

Uploads are dynamic files stored per-record.

**Table Definition:**
```yaml
name: product
properties:
  - name: image
    type: upload
```

**Form:**
```liquid
{% form %}
  <input type="file" name="{{ form.fields.properties.image.name }}">
{% endform %}
```

**Displaying Uploads:**
```liquid
{% graphql product = 'get_product', id: id %}
<img src="{{ product.record.properties.image.url }}" 
     alt="{{ product.record.properties.image.file_name }}">
```

**Upload Properties:**

| Property | Description |
|----------|-------------|
| `url` | Direct file URL |
| `file_name` | Original filename |
| `content_type` | MIME type |
| `size` | File size in bytes |

### Assets vs Uploads

| Aspect | Assets | Uploads |
|--------|--------|---------|
| Location | `app/assets/` | Record properties |
| Use Case | Static files (CSS, JS, logos) | Dynamic content |
| Quantity | Thousands expected | Millions supported |
| CDN | Yes | Yes |
| Max Size | 2GB | 2GB |

### Direct S3 Upload

platformOS uses **direct S3 upload** - files go straight to AWS S3 without passing through the application server.

**Advantages:**
- **Speed** - No middleman, faster uploads
- **Cost** - Less bandwidth and server load
- **Security** - No file processing on app server
- **Scalability** - Handle unlimited concurrent uploads
- **Size** - Up to 5GB single file, 5TB multipart

**Upload Flow:**
```
1. User selects file
2. Browser requests signed S3 URL from platformOS
3. Browser uploads directly to S3
4. S3 returns success
5. platformOS saves file reference to record
```

### Upload Configuration Options

**Table Definition with Options:**
```yaml
name: product
properties:
  - name: image
    type: upload
    options:
      public: true              # Public or private access
      max_size: 5242880         # 5MB in bytes
      versions:
        - name: thumbnail
          resize: '200x200>'    # Resize to fit 200x200
        - name: medium
          resize: '800x600>'
      extensions:
        - jpg
        - png
        - gif
```

### Upload Versions

Automatically generate resized versions:

```yaml
properties:
  - name: photo
    type: upload
    options:
      versions:
        - name: thumb
          resize: '100x100#'    # Exact fit, may crop
        - name: medium
          resize: '300x300>'    # Fit within, no upscale
        - name: large
          resize: '800x800>'
```

**Access versions in Liquid:**
```liquid
{{ product.properties.photo.url }}           # Original
{{ product.properties.photo.versions.thumb.url }}   # Thumbnail
{{ product.properties.photo.versions.medium.url }}  # Medium
```

### Image Processing Options

| Option | Description | Example |
|--------|-------------|---------|
| `resize: '100x100'` | Resize to dimensions | Fit within |
| `resize: '100x100>'` | Resize only if larger | Downscale only |
| `resize: '100x100<'` | Resize only if smaller | Upscale only |
| `resize: '100x100#'` | Exact dimensions | May crop |
| `resize: '100x100^'` | Minimum dimensions | May crop |

---

## 16. Best Practices

### Code Organization

```
app/
├── views/
│   ├── pages/           # Route handlers
│   ├── layouts/         # Page wrappers
│   └── partials/
│       ├── components/  # UI components
│       ├── forms/       # Form partials
│       └── helpers/     # Utility partials
├── forms/               # Form configurations
├── graphql/             # Data queries
│   ├── records/
│   ├── users/
│   └── system/
└── schema/              # Table definitions
```

### Naming Conventions

| Component | Convention | Example |
|-----------|------------|---------|
| Tables | snake_case | `blog_post` |
| Properties | snake_case | `published_at` |
| Pages | snake_case | `about_us.liquid` |
| Partials | snake_case | `header.liquid` |
| Forms | snake_case | `contact_form.liquid` |
| GraphQL | snake_case | `get_blog_posts.graphql` |

### Security Best Practices

1. **Always use authorization policies** for protected routes
2. **Validate all inputs** using form validations
3. **Escape output** using Liquid's auto-escaping
4. **Use HTTPS** for all production instances
5. **Store secrets** in Partner Portal constants, not code
6. **Sanitize user content** before displaying

### Performance Best Practices

1. **Use pagination** for all list queries
2. **Load related records** in single GraphQL query
3. **Use background jobs** for long operations
4. **Cache expensive queries** using static cache
5. **Optimize images** before uploading as assets
6. **Minimize GraphQL response size** with specific field selection

### Error Handling

```liquid
{% graphql result = 'create_record', name: name %}

{% if result.record_create.errors %}
  <div class="errors">
    {% for error in result.record_create.errors %}
      <p>{{ error.message }}</p>
    {% endfor %}
  </div>
{% else %}
  <p>Success! ID: {{ result.record_create.id }}</p>
{% endif %}
```

---

## 17. Common Gotchas & Pitfalls

### 1. Variable Scope in Background Jobs

**WRONG:**
```liquid
{% assign user_id = context.current_user.id %}
{% background %}
  {{ user_id }}  {# nil - not passed #}
{% endbackground %}
```

**CORRECT:**
```liquid
{% assign user_id = context.current_user.id %}
{% background user_id: user_id %}
  {{ user_id }}  {# Works! #}
{% endbackground %}
```

### 2. N+1 Query Problem

**WRONG (N+1 queries):**
```liquid
{% graphql companies = 'get_companies' %}
{% for company in companies.records.results %}
  {% graphql programmers = 'get_programmers', company_id: company.id %}
  {# Each iteration = 1 query! #}
{% endfor %}
```

**CORRECT (single query):**
```graphql
query get_companies_with_programmers {
  records(
    filter: { table: { value: "company" } }
  ) {
    results {
      id
      properties
      programmers: related_records(
        table: "programmer"
        foreign_property: "company_id"
      ) {
        id
        properties
      }
    }
  }
}
```

### 3. Form Field Name Format

**WRONG:**
```liquid
<input name="email">  {# Won't bind to form #}
```

**CORRECT:**
```liquid
<input name="{{ form.fields.properties.email.name }}">
```

### 4. Module File References

**WRONG:**
```liquid
{% render 'modules/my_module/public/header' %}
```

**CORRECT:**
```liquid
{% render 'modules/my_module/header' %}
```

### 5. Date/Time Formatting

**WRONG:**
```liquid
{{ '2024-01-01' | strftime: '%Y' }}  {# Error - not a time object #}
```

**CORRECT:**
```liquid
{{ '2024-01-01' | to_time | strftime: '%Y' }}
```

### 6. Array vs JSONB Confusion

**Arrays** - for simple lists:
```yaml
type: array
# Value: ["a", "b", "c"]
```

**JSONB** - for complex objects:
```yaml
type: jsonb
# Value: {"nested": {"key": "value"}}
```

### 7. Form Resource Owner

**For public forms** (contact, newsletter):
```yaml
resource_owner: anyone
```

**For authenticated forms** (profile edit):
```yaml
resource_owner: self
```

**For admin forms**:
```yaml
resource_owner: anyone_with_token
authorization_policies:
  - admin_only_policy
```

### 8. Whitespace in Liquid

**Problem:** Extra whitespace in output
```liquid
{% if true %}
  Content
{% endif %}
{# Outputs newlines around content #}
```

**Solution:** Use whitespace control
```liquid
{%- if true -%}
  Content
{%- endif -%}
```

### 9. GraphQL Variable Types

**Integer vs Float:**
```graphql
# Integer property
{ name: "count", value_int: 5 }

# Float property  
{ name: "price", value_float: 19.99 }
```

**Boolean:**
```graphql
{ name: "active", value_boolean: true }
```

### 10. Soft Delete vs Hard Delete

**Soft delete** (default):
```graphql
mutation {
  record_delete(id: "123") {
    id
    deleted_at  # Timestamp set
  }
}
```

**Hard delete** (permanent):
```graphql
mutation {
  record_delete(id: "123", hard_delete: true) {
    id
  }
}
```

### 11. Reserved Names

Avoid these reserved names for custom tables and properties:

**System Fields (automatically created):**
- `id` - Record UUID
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp
- `deleted_at` - Soft delete timestamp
- `type_name` - Table name
- `properties` - Property container

**Reserved Words:**
- `user`, `users` - Built-in User table
- `session`, `sessions` - Session management
- `record`, `records` - Record operations
- `constant`, `constants` - System constants
- `table`, `tables` - Table metadata

### 12. Form Resource Owner Confusion

| Value | When to Use |
|-------|-------------|
| `anyone` | Public forms (contact, newsletter) |
| `self` | User editing their own data |
| `anyone_with_token` | API endpoints with token auth |

**Wrong:**
```yaml
resource_owner: self  # Won't work for public contact form
```

**Correct:**
```yaml
resource_owner: anyone  # For public forms
```

### 13. Module File Deletion Behavior

By default, module files are **NOT deleted** during deploy to protect private files.

To enable deletion for a module:
```yaml
# app/config.yml
modules_that_allow_delete_on_deploy:
  - my_module
```

### 14. GraphQL Query Caching

GraphQL queries are cached by default. To bypass cache:
```graphql
query {
  records(
    per_page: 10
    filter: { table: { value: "product" } }
  ) @skip_cache {
    results { id }
  }
}
```

### 15. File Upload Size Limits

| Upload Type | Max Size |
|-------------|----------|
| Direct S3 (single part) | 5 GB |
| Direct S3 (multipart) | 5 TB |
| Application-processed | 2 GB |

### 16. Background Job Payload Limits

```liquid
{# WRONG - payload too large #}
{% background data: huge_array_with_thousands_of_items %}

{# CORRECT - pass reference only #}
{% background record_id: record_id %}
  {% graphql record = 'get_record', id: record_id %}
  {# Process data in background #}
{% endbackground %}
```

### 17. Liquid Truthiness

In Liquid, only `nil` and `false` are falsy. Empty strings and zero are truthy:

```liquid
{% if '' %}TRUE{% endif %}     {# TRUE! #}
{% if 0 %}TRUE{% endif %}       {# TRUE! #}
{% if empty_array %}TRUE{% endif %}  {# FALSE (nil) #}
{% if false %}TRUE{% endif %}    {# FALSE #}
```

Use `blank` and `present` for better checks:
```liquid
{% if '' == blank %}EMPTY{% endif %}  {# EMPTY #}
{% if 0 == blank %}ZERO IS BLANK{% endif %}  {# Not blank! #}
```

---

## 18. Performance Optimization

### Measuring Performance

**time_diff filter:**
```liquid
{% assign start = 'now' | to_time %}

{% graphql posts = 'get_posts' %}

{% assign duration = start | time_diff: 'now' %}
<p>Query took: {{ duration }}ms</p>
```

### Query Optimization

**1. Select only needed fields:**
```graphql
# BAD - fetches everything
query {
  records { results { properties } }
}

# GOOD - specific fields
query {
  records { 
    results { 
      id
      properties
    } 
  }
}
```

**2. Use pagination:**
```graphql
query {
  records(per_page: 20, page: 1) {
    total_entries
    results { id }
  }
}
```

**3. Load related records efficiently:**
```graphql
query {
  records(filter: { table: { value: "order" } }) {
    results {
      id
      items: related_records(table: "order_item") {
        id
        properties
      }
    }
  }
}
```

### Caching Strategies

**Static Cache (Edge Caching):**
```liquid
---
slug: public-page
response_headers:
  Cache-Control: public, max-age=3600
---
```

**Fragment Caching:**
```liquid
{% cache key: 'sidebar', expire: 3600 %}
  {% graphql categories = 'get_categories' %}
  {% for category in categories.records.results %}
    <a href="{{ category.id }}">{{ category.properties.name }}</a>
  {% endfor %}
{% endcache %}
```

### Background Job Optimization

**Keep payloads small:**
```liquid
{# BAD - large payload #}
{% background data: huge_array %}

{# GOOD - pass reference #}
{% assign job_id = 'process_' | append: record_id %}
{% background job_id: job_id, record_id: record_id %}
  {% graphql record = 'get_record', id: record_id %}
  {# Process in background #}
{% endbackground %}
```

---

## 19. Testing & CI/CD

### pos-cli GUI

```bash
# Start GUI for GraphQL development
pos-cli gui serve staging

# Access at http://localhost:3333
```

### platformOS Check

```bash
# Install
npm install -g @platformos/platformos-check

# Run checks
platformos-check

# Auto-fix issues
platformos-check --auto-correct
```

### GitHub Actions CI

**File:** `.github/workflows/platformos.yml`
```yaml
name: platformOS CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install pos-cli
        run: npm install -g @platformos/pos-cli
      
      - name: Deploy to Staging
        run: pos-cli deploy staging
        env:
          MPKIT_TOKEN: ${{ secrets.MPKIT_TOKEN }}
          MPKIT_URL: ${{ secrets.STAGING_URL }}
      
      - name: Run Tests
        run: npm test
```

### Release Pool Setup

1. Create dedicated test instances in Partner Portal
2. Configure GitHub secrets:
   - `MPKIT_TOKEN`
   - `STAGING_URL`
   - `PRODUCTION_URL`

### Testing Best Practices

1. **Unit test** GraphQL queries
2. **Integration test** form submissions
3. **E2E test** critical user flows
4. **Performance test** with realistic data volumes
5. **Security test** authorization policies

---

## 20. System Limitations

### Resource Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| File upload size | 2GB | Assets and uploads |
| Background job payload | 100KB | Keep payloads small |
| Background job execution | 1-60 min | Depends on priority |
| GraphQL query complexity | Varies | Monitor performance |
| Records per query | Unlimited | Use pagination |
| Assets | Thousands | Use uploads for dynamic content |
| Uploads | Millions | No practical limit |

### Background Job Limits

| Priority | Max Execution | Use For |
|----------|---------------|---------|
| `high` | 1 minute | Critical, urgent tasks |
| `default` | 5 minutes | Standard operations |
| `low` | 60 minutes | Heavy processing |

### Rate Limiting

- API calls may be rate-limited based on plan
- Background job scheduling has queue limits
- GraphQL queries have complexity scoring

### Reserved Names

Avoid these names for custom tables/properties:
- `id`, `created_at`, `updated_at`, `deleted_at`
- `type_name`, `properties`, `user`
- Built-in Liquid objects and filters

---

## 22. Data Import/Export

### Exporting Data

```bash
# Export all data from an instance
pos-cli data export staging --path=./export.json

# Export specific tables
pos-cli data export staging --tables=products,orders --path=./products.json
```

### Importing Data

```bash
# Import data to an instance
pos-cli data import staging ./export.json

# Import with transformations
pos-cli data import staging ./data.json --transform=./transform.js
```

### Data Export Format

```json
{
  "users": [
    {
      "id": "123",
      "email": "user@example.com",
      "created_at": "2024-01-15T10:00:00Z",
      "properties": {
        "first_name": "John",
        "last_name": "Doe"
      }
    }
  ],
  "records": {
    "product": [
      {
        "id": "456",
        "properties": {
          "name": "Widget",
          "price": 19.99
        }
      }
    ]
  }
}
```

### Programmatic Import with Migrations

```liquid
{# app/migrations/20240115000000_import_products.liquid #}
{% parse_json data %}
  {{ 'data/products.json' | load_file }}
{% endparse_json %}

{% for product in data.products %}
  {% graphql result = 'create_product',
    name: product.name,
    price: product.price,
    sku: product.sku
  %}
  {% log result %}
{% endfor %}
```

### Cleaning Instance Data

```bash
# WARNING: This deletes all data!
pos-cli data clean staging

# Clean specific tables
pos-cli data clean staging --tables=products,orders
```

---

## 23. Quick Reference

### File Templates

**New Page:**
```liquid
---
slug: my-page
layout: application
---

<h1>Page Title</h1>
```

**New Table:**
```yaml
name: my_table
properties:
  - name: name
    type: string
```

**New Form:**
```liquid
---
name: my_form
resource: my_table
resource_owner: anyone
redirect_to: /success
fields:
  properties:
    name:
      validation:
        presence: true
---

{% form %}
  <input name="{{ form.fields.properties.name.name }}">
  <button>Submit</button>
{% endform %}
```

**New GraphQL Query:**
```graphql
query my_query($param: String) {
  records(filter: { table: { value: "my_table" } }) {
    results { id properties }
  }
}
```

### Common Liquid Patterns

**Conditional rendering:**
```liquid
{% if condition %}
  <!-- content -->
{% elsif other_condition %}
  <!-- other content -->
{% else %}
  <!-- default content -->
{% endif %}
```

**Loop with index:**
```liquid
{% for item in items %}
  {{ forloop.index }}: {{ item.name }}
{% endfor %}
```

**Pagination:**
```liquid
{% if records.has_previous_page %}
  <a href="?page={{ records.current_page | minus: 1 }}">Previous</a>
{% endif %}

{% if records.has_next_page %}
  <a href="?page={{ records.current_page | plus: 1 }}">Next</a>
{% endif %}
```

### Common GraphQL Patterns

**Create with error handling:**
```graphql
mutation {
  record_create(record: { table: "post", properties: [] }) {
    id
    errors { message }
  }
}
```

**Update specific fields:**
```graphql
mutation {
  record_update(id: "123", record: { properties: [{ name: "status", value: "published" }] }) {
    id
    properties
  }
}
```

**Search with filters:**
```graphql
query {
  records(
    filter: {
      table: { value: "product" }
      properties: [{ name: "category", value: "electronics" }]
      created_at: { gte: "2024-01-01" }
    }
  ) {
    results { id }
  }
}
```

### pos-cli Commands

```bash
# Authentication
pos-cli auth login                    # Login to Partner Portal

# Development
pos-cli sync staging                  # Watch and sync changes
pos-cli deploy staging                # Deploy to instance
pos-cli deploy staging -f             # Force deploy (delete missing files)

# Data
pos-cli data export staging           # Export instance data
pos-cli data import staging file.json # Import data
pos-cli migrations run staging        # Run pending migrations

# Modules
pos-cli modules install module_name   # Install module
pos-cli modules remove module_name    # Remove module

# GUI
pos-cli gui serve staging             # Start development GUI

# Logs
pos-cli logs staging                  # Stream logs
```

### Error Messages Reference

| Error | Cause | Solution |
|-------|-------|----------|
| `Record not found` | Invalid ID | Check record exists |
| `Validation failed` | Invalid data | Check form validations |
| `Unauthorized` | Policy failed | Check authorization |
| `Rate limited` | Too many requests | Add delays, use caching |
| `Timeout` | Query too slow | Optimize query, add pagination |
| `Property not found` | Wrong property name | Check table schema |
| `Table not found` | Wrong table name | Check table definition |
| `Form not found` | Wrong form name | Check form file exists |

### GraphQL Property Type Mapping

| Property Type | GraphQL Input | Example |
|---------------|---------------|---------|
| `string` | `value: "text"` | `{ name: "title", value: "Hello" }` |
| `integer` | `value_int: 42` | `{ name: "count", value_int: 5 }` |
| `float` | `value_float: 19.99` | `{ name: "price", value_float: 19.99 }` |
| `boolean` | `value_boolean: true` | `{ name: "active", value_boolean: true }` |
| `date` | `value: "2024-01-15"` | `{ name: "birthday", value: "2024-01-15" }` |
| `datetime` | `value: "2024-01-15T10:00:00Z"` | ISO 8601 format |
| `array` | `value_array: ["a", "b"]` | `{ name: "tags", value_array: ["a", "b"] }` |
| `jsonb` | `value_json: "{}"` | JSON string |
| `upload` | Via form only | File uploads |

### Form Validation Reference

| Validation | Syntax | Description |
|------------|--------|-------------|
| `presence` | `presence: true` | Required field |
| `email` | `email: true` | Valid email format |
| `uniqueness` | `uniqueness: true` | Must be unique |
| `length` | `length: { minimum: 5, maximum: 100 }` | String length |
| `numericality` | `numericality: { greater_than: 0 }` | Number range |
| `confirmation` | `confirmation: true` | Must match confirmation field |
| `url` | `url: true` | Valid URL format |

### pos-cli Extended Commands

```bash
# Authentication
pos-cli auth login                      # Login to Partner Portal
pos-cli auth logout                     # Logout

# Development
pos-cli sync staging                    # Watch and sync changes
pos-cli sync staging --live-reload      # With live reload
pos-cli deploy staging                  # Deploy to instance
pos-cli deploy staging -f               # Force deploy (delete missing files)
pos-cli deploy staging --direct-assets  # Deploy assets directly

# Data Management
pos-cli data export staging             # Export all data
pos-cli data export staging --tables=products,orders
pos-cli data import staging file.json   # Import data
pos-cli data clean staging              # Delete all data (DANGER!)
pos-cli migrations run staging          # Run pending migrations
pos-cli migrations status staging       # Check migration status

# Modules
pos-cli modules install module_name     # Install module
pos-cli modules install module_name@1.2 # Specific version
pos-cli modules remove module_name      # Remove module
pos-cli modules list staging            # List installed modules

# GUI Tools
pos-cli gui serve staging               # Start development GUI
pos-cli gui serve staging --port 3333   # Custom port

# Logs
pos-cli logs staging                    # Stream logs
pos-cli logs staging --tail 100         # Last 100 lines
pos-cli logs staging --follow           # Follow new logs

# Environment
pos-cli env list                        # List environments
pos-cli env add production              # Add environment
pos-cli env remove staging              # Remove environment

# Testing
pos-cli test staging                    # Run tests

# Debug
pos-cli shell staging                   # Interactive shell
```

---

## 24. Translations

### Overview

Translations serve three main purposes:
1. **Multi-language sites** - Static copy in multiple languages
2. **Date formatting** - Consistent date/time display
3. **Flash messages** - System message localization

### Translation Files

**File:** `app/translations/en.yml`
```yaml
en:
  hello: "Hello"
  welcome: "Welcome to our site"
  buttons:
    submit: "Submit"
    cancel: "Cancel"
  errors:
    not_found: "Page not found"
```

**File:** `app/translations/es.yml`
```yaml
es:
  hello: "Hola"
  welcome: "Bienvenido a nuestro sitio"
  buttons:
    submit: "Enviar"
    cancel: "Cancelar"
  errors:
    not_found: "Página no encontrada"
```

### Using Translations in Liquid

**Basic translation:**
```liquid
{{ 'hello' | t }}                    # Output: Hello (or Hola)
```

**Nested keys:**
```liquid
{{ 'buttons.submit' | t }}           # Output: Submit
{{ 'errors.not_found' | t }}         # Output: Page not found
```

**With interpolation:**
```yaml
# en.yml
welcome_user: "Welcome, {{ name }}!"
```
```liquid
{{ 'welcome_user' | t: name: user.first_name }}
```

### Date Localization

Use the `l` (localize) filter for consistent date formatting:

```yaml
# en.yml
date:
  formats:
    short: "%b %d, %Y"
    long: "%B %d, %Y %H:%M"
```
```liquid
{{ 'now' | l: 'short' }}             # Jan 15, 2024
{{ post.published_at | l: 'long' }}  # January 15, 2024 14:30
```

### Language Detection

platformOS automatically detects language from:
1. User's `language` property (if set)
2. Browser's Accept-Language header
3. Default language (English)

Access current language:
```liquid
{{ context.language }}               # Current language code (e.g., "en")
```

---

## 25. Activity Feeds

### Overview

Activity Feeds implement the [W3C Activity Streams 2.0](https://www.w3.org/TR/2017/REC-activitystreams-core-20170523/) specification for tracking user activities.

**Key Characteristics:**
- Activities are **immutable** (append-only)
- Each activity has a **unique UUID**
- Activities can be shared between actors
- Activities represent events that happened in the past

### Activity Structure

```json
{
  "actor": {
    "type": "Person",
    "id": "User.1",
    "name": "Sally Smith"
  },
  "type": "Create",
  "object": {
    "type": "Relationship",
    "id": "Relationship.42"
  },
  "target": {
    "type": "Group",
    "id": "Group.5"
  }
}
```

### Creating Activities

**GraphQL Mutation:**
```graphql
mutation create_activity {
  activity_create(
    activity: {
      type: "Join"
      actor: {
        type: "Person"
        id: "User.123"
        name: "John Doe"
      }
      object: {
        type: "Group"
        id: "Group.456"
      }
    }
  ) {
    id
    uuid
  }
}
```

### Publishing to Feeds

After creating an activity, publish it to feeds:

```graphql
mutation publish_to_feed {
  feed_publish(
    feed_id: "user_123_notifications"
    activity_uuid: "abc-123-uuid"
  ) {
    id
  }
}
```

### Querying Feeds

```graphql
query get_user_feed {
  feeds(
    feed_id: "user_123_notifications"
    per_page: 20
  ) {
    total_entries
    results {
      id
      uuid
      type
      actor
      object
      target
      created_at
    }
  }
}
```

### Common Activity Types

| Type | Description |
|------|-------------|
| `Create` | Created something |
| `Update` | Updated something |
| `Delete` | Deleted something |
| `Join` | Joined a group/event |
| `Leave` | Left a group/event |
| `Follow` | Started following |
| `Like` | Liked content |
| `Comment` | Commented on content |
| `Share` | Shared content |
| `Approve` | Approved a request |

---

## 26. JSON Documents

### Overview

JSON Documents provide a schemaless data storage option for flexible, document-based data. Unlike Records (which require a Table schema), JSON Documents can store any valid JSON structure.

**Use Cases:**
- Configuration data
- Unstructured content
- Temporary data storage
- Data that doesn't fit a rigid schema

### Creating JSON Documents

**GraphQL Mutation:**
```graphql
mutation create_json_document {
  json_document_create(
    document: {
      name: "site_config"
      content: "{\"theme\": \"dark\", \"features\": [\"blog\", \"shop\"]}"
    }
  ) {
    id
    name
    content
    created_at
  }
}
```

### Querying JSON Documents

```graphql
query get_json_document {
  json_document(name: "site_config") {
    id
    name
    content
    created_at
    updated_at
  }
}

query list_json_documents {
  json_documents(
    per_page: 10
    sort: [{ created_at: { order: DESC } }]
  ) {
    results {
      id
      name
      content
    }
  }
}
```

### Updating JSON Documents

```graphql
mutation update_json_document {
  json_document_update(
    name: "site_config"
    document: {
      content: "{\"theme\": \"light\", \"features\": [\"blog\", \"shop\", \"forum\"]}"
    }
  ) {
    id
    content
    updated_at
  }
}
```

### Using in Liquid

```liquid
{% graphql config = 'get_json_document', name: 'site_config' %}
{% assign settings = config.json_document.content | parse_json %}

Theme: {{ settings.theme }}
Features: {{ settings.features | join: ', ' }}
```

### JSON Document vs Records

| Feature | JSON Documents | Records |
|---------|---------------|---------|
| Schema | Schemaless | Defined in Table YAML |
| Validation | None | Form validation |
| Structure | Any JSON | Fixed properties |
| Use Case | Config, flexible data | Structured entities |
| GraphQL | `json_document_*` | `record_*` |

---

## 27. AI Embeddings

### Overview

platformOS supports AI embeddings for semantic search and similarity matching. Embeddings are vector representations of text that capture semantic meaning.

**Use Cases:**
- Semantic search
- Content recommendation
- Similarity matching
- Clustering

### Creating Embeddings

**GraphQL Mutation:**
```graphql
mutation create_embedding {
  embedding_create(
    embedding: {
      name: "product_description"
      value: "High-quality wireless headphones with noise cancellation"
      target_id: "product_123"
      target_type: "Product"
    }
  ) {
    id
    vector
  }
}
```

### Semantic Search

```graphql
query semantic_search {
  embeddings_search(
    query: "wireless audio devices"
    limit: 10
    threshold: 0.7
  ) {
    results {
      id
      target_id
      target_type
      similarity
      value
    }
  }
}
```

### Querying Embeddings

```graphql
query get_embedding {
  embedding(
    target_id: "product_123"
    target_type: "Product"
  ) {
    id
    name
    value
    vector
    created_at
  }
}
```

### Deleting Embeddings

```graphql
mutation delete_embedding {
  embedding_delete(
    target_id: "product_123"
    target_type: "Product"
  ) {
    id
  }
}
```

### Embedding Parameters

| Parameter | Description |
|-----------|-------------|
| `name` | Identifier for the embedding type |
| `value` | The text to embed |
| `target_id` | ID of the associated entity |
| `target_type` | Type of the associated entity |
| `vector` | The computed embedding vector (read-only) |

---

## 28. Migrations

### Overview

Migrations are Liquid scripts that run once to transform data. They are useful for:
- Data transformations during schema changes
- Bulk data updates
- One-time data imports

### Creating Migrations

**File:** `app/migrations/20240115120000_add_status_to_products.liquid`
```liquid
{% graphql products = 'get_all_products' %}

{% for product in products.records.results %}
  {% graphql result = 'update_product_status', 
    id: product.id, 
    status: 'active' 
  %}
  {% log result %}
{% endfor %}
```

### Migration File Naming

Migrations are executed in alphabetical order. Use timestamps as prefixes:
```
app/migrations/
├── 20240101000000_initial_setup.liquid
├── 20240115120000_add_status.liquid
└── 20240201000000_migrate_images.liquid
```

### Running Migrations

```bash
# Run pending migrations
pos-cli migrations run staging

# Check migration status
pos-cli migrations status staging
```

### Migration Best Practices

1. **Make migrations idempotent** - Running twice should not cause errors:
```liquid
{% graphql product = 'get_product', id: product_id %}
{% unless product.record.properties.status %}
  {# Only update if status is not set #}
  {% graphql result = 'update_product', id: product_id, status: 'active' %}
{% endunless %}
```

2. **Use background jobs for large migrations:**
```liquid
{% background source_name: 'data_migration' %}
  {% graphql records = 'get_all_records' %}
  {% for record in records.records.results %}
    {# Process each record #}
  {% endfor %}
{% endbackground %}
```

3. **Test migrations on staging first**
4. **Log progress for debugging:**
```liquid
{% log 'Migration started' %}
{% log 'Processed ' | append: count | append: ' records' %}
```

### Migration Limitations

- Migrations run as background jobs
- Should complete within a few minutes
- For long-running operations, use low-priority background jobs
- Failed migrations can be retried

---

## Resources

- **Documentation:** https://documentation.platformos.com/
- **API Reference:** https://documentation.platformos.com/api-reference
- **Examples:** https://examples.platform-os.com/
- **GitHub:** https://github.com/Platform-OS
- **Partner Portal:** https://partners.platformos.com/
- **Community:** https://community.platformos.com/

---

*This guide is designed for LLM agents developing on platformOS. For the most up-to-date information, always refer to the official documentation.*
