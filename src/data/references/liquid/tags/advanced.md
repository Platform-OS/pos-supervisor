# platformOS Liquid Tags: Advanced Patterns

## Combining transaction + try/catch for Safe Multi-Step Operations

**Overview:** Use `transaction` for data consistency and `try/catch` for error recovery to safely execute complex, multi-step operations.

**Pattern:** Wrap transaction in try/catch to handle both committed state and rollback scenarios:

```liquid
{% try %}
  {% transaction timeout: 15 %}
    {% graphql create_order = 'mutations/create_order', items: cart_items %}
    {% assign order_id = create_order.order.id %}

    {% graphql charge = 'mutations/charge_payment', order_id: order_id, amount: total %}
    {% if charge.errors %}
      {% rollback %}
      {% return nil %}
    {% endif %}

    {% graphql update_inventory = 'mutations/update_inventory', items: cart_items %}
  {% endtransaction %}

  {% graphql send_confirmation = 'mutations/send_email', order_id: order_id, type: 'confirmation' %}

{% catch %}
  {% log level: 'error', message: 'Order failed', transaction_error: true %}
  {% return error %}
{% endtry %}
```

**Best Practices:**

- Keep transactions focused on data mutations (graphql)
- Use `rollback` to explicitly reverse partial state
- Post-transaction operations (emails, webhooks) go outside the transaction
- Handle GraphQL errors before they cascade to try/catch
- Set appropriate timeout based on operation complexity

**When to use each:**

| Scenario | Use transaction | Use try/catch |
|----------|-----------------|---------------|
| Multiple DB writes | Yes | Conditional |
| Payment processing | Yes | Yes (for error handling) |
| Parsing/type coercion | No | Yes |
| Email sending | No | Yes |
| Inventory updates | Yes | Conditional |

---

## Nested Function Calls and Performance Implications

**Overview:** Functions can call other functions, but excessive nesting impacts performance and readability.

**Optimal Pattern:** 2-3 levels of nesting maximum for production code:

```liquid
{% function process_checkout %}
  {% assign subtotal = cart | calculate_subtotal %}
  {% assign tax = subtotal | calculate_tax, state: address.state %}
  {% assign shipping = address | calculate_shipping, items: cart %}

  {% return subtotal | plus: tax | plus: shipping %}
{% endfunction %}

{% function calculate_subtotal %}
  {%- assign total = 0 -%}
  {%- for item in cart -%}
    {%- assign item_total = item.price | times: item.quantity -%}
    {%- assign total = total | plus: item_total -%}
  {%- endfor -%}
  {{ total }}
{% endfunction %}

{% function calculate_tax %}
  {%- assign rate = state | get_tax_rate -%}
  {%- return subtotal | times: rate -%}
{% endfunction %}
```

**Performance Considerations:**

- Function calls add ~1-5ms overhead per call
- Avoid recursion over large arrays; use filters instead
- Cache expensive function results in variables
- Prefer filter chaining over nested function calls

**Depth Limit:** platformOS enforces a 50-level recursion limit to prevent infinite loops.

```liquid
{%- Anti-pattern: Deep recursion -%}
{% function factorial %}
  {% if n <= 1 %}
    {% return 1 %}
  {% else %}
    {% return n | times: factorial(n - 1) %}
  {% endif %}
{% endfunction %}

{%- Better: Use a loop -%}
{% function factorial %}
  {%- assign result = 1 -%}
  {%- for i in (1..n) -%}
    {%- assign result = result | times: i -%}
  {%- endfor -%}
  {%- return result -%}
{% endfunction %}
```

---

## Cache Key Strategies

**Overview:** Effective caching requires thoughtful key design to balance cache hits and data freshness.

### Per-User Caching

Cache variant per user to avoid serving other users' data:

```liquid
{% assign cache_key = 'user_dashboard_' | append: user.id %}
{% cache cache_key, expire: 3600 %}
  {% graphql user_stats = 'user_dashboard', user_id: user.id %}
  <div class="dashboard">
    {{ user_stats.stats.page_views }}
  </div>
{% endcache %}
```

**Invalidate** when user data changes:

```liquid
{% cache_clear key: 'user_dashboard_' | append: user.id %}
```

### Per-Page Caching

Cache by page slug for static or semi-static content:

```liquid
{% assign cache_key = 'page_content_' | append: page.slug %}
{% cache cache_key, expire: 7200 %}
  {% render 'partials/page_hero', page: page %}
  {% render 'partials/page_content', body: page.body %}
{% endcache %}
```

### Versioned Caching

Include version number to bust cache on content updates:

```liquid
{% assign version = settings.cache_version | default: '1' %}
{% assign cache_key = 'product_' | append: product.id | append: '_v' | append: version %}

{% cache cache_key, expire: 86400 %}
  {% render 'partials/product_card', product: product %}
{% endcache %}

{%- To bust cache, update settings.cache_version -%}
```

### Multi-Key Strategy

Combine multiple factors for granular cache control:

```liquid
{% assign user_segment = user.tier | default: 'guest' %}
{% assign cache_key = 'feed_' | append: user_segment | append: '_page_' | append: page.current %}

{% cache cache_key, expire: 1800 %}
  {% graphql feed = 'feed_by_tier', tier: user_segment, page: page.current %}
  {% for item in feed.items %}
    {% render 'partials/feed_item', item: item %}
  {% endfor %}
{% endcache %}
```

**Cache Key Best Practices:**

- Keep keys under 256 characters (longer keys are hashed)
- Include version number for bust-ability
- Use user/page/segment identifiers
- Avoid secrets or sensitive data in keys
- Log cache_key during development for debugging

---

## Background Job Patterns

**Overview:** Background jobs enable asynchronous processing. Master patterns for common use cases.

### Delayed Execution Pattern

Execute a task after a delay:

```liquid
{% background task: 'send_welcome_email', user_id: user.id, delay: 300 %}

{%- In event consumer (delayed): -%}
{% function send_welcome_email %}
  {% graphql user = 'get_user', id: user_id %}
  {% if user.user %}
    {% graphql send = 'send_email', to: user.user.email, template: 'welcome' %}
  {% endif %}
{% endfunction %}
```

### Retry Pattern with Exponential Backoff

Implement retry logic within the background handler:

```liquid
{% function process_payment %}
  {%- assign max_retries = 3 -%}
  {%- assign retry_count = 0 -%}

  {% try %}
    {% graphql charge = 'payment_gateway_charge', amount: amount, user_id: user_id %}
  {% catch %}
    {%- if retry_count < max_retries -%}
      {%- assign retry_count = retry_count | plus: 1 -%}
      {%- assign delay = 60 | times: retry_count -%}
      {% background task: 'process_payment', user_id: user_id, amount: amount, delay: delay, retry: true %}
    {%- else -%}
      {% log level: 'error', message: 'Payment failed after retries', user_id: user_id %}
    {%- endif -%}
  {% endtry %}
{% endfunction %}
```

### Priority Management Pattern

Use context or metadata to prioritize jobs:

```liquid
{% assign priority = order.tier == 'vip' | if: 'high' | else: 'normal' %}
{% background task: 'process_order', order_id: order.id, priority: priority %}
```

**Job Execution Guarantees:**

- Jobs execute at least once (no guarantee of exactly-once)
- Execution not guaranteed within specified time window
- Minimum delay is 1 minute
- Jobs may be retried on transient failure

---

## Export Namespace Patterns for Complex Partial Chains

**Overview:** `export` encapsulates partial logic and prevents scope pollution across partial chains.

**Pattern 1: Expose Calculated Values**

```liquid
{%- partials/product_formatter -%}
{% assign price = product.price | times: tax_multiplier %}
{% assign discount = price | times: discount_rate %}
{% assign final_price = price | minus: discount %}

{% export final_price, discount, price %}

{%- Usage in page -%}
{% render 'partials/product_formatter', product: product, tax_multiplier: 1.1, discount_rate: 0.1 %}
Final price: {{ final_price }}
```

**Pattern 2: Namespace Isolation**

Prevent variable name collisions in deeply nested partials:

```liquid
{%- partials/cart/summary -%}
{% assign total = 0 %}
{% assign item_count = 0 %}
{% for item in cart.items %}
  {% assign total = total | plus: item.price %}
  {% assign item_count = item_count | plus: 1 %}
{% endfor %}

{% export total, item_count %}

{%- partials/cart/details (uses different scope) -%}
{% assign total = 0 %} {%- Different 'total' variable -%}
{% for line_item in order.line_items %}
  {% assign total = total | plus: line_item.total %}
{% endfor %}
```

**Pattern 3: Complex Partial Chain with Multiple Exports**

```liquid
{%- page: checkout -%}
{% render 'partials/checkout/summary', cart: cart, user: user %}
Subtotal: {{ subtotal }}
Tax: {{ tax }}
Grand total: {{ grand_total }}

{%- partials/checkout/summary -%}
{% render 'partials/checkout/items', items: cart.items %}
{% render 'partials/checkout/tax', subtotal: subtotal, state: user.state %}

{% export subtotal, tax, grand_total %}

{%- partials/checkout/items -%}
{% assign subtotal = 0 %}
{% for item in items %}
  {% assign item_total = item.price | times: item.qty %}
  {% assign subtotal = subtotal | plus: item_total %}
{% endfor %}
{% export subtotal %}

{%- partials/checkout/tax -%}
{% assign rate = state | get_tax_rate %}
{% assign tax = subtotal | times: rate %}
{% assign grand_total = subtotal | plus: tax %}
{% export tax, grand_total %}
```

---

## content_for with flush:true for Replacement

**Overview:** By default, `content_for` appends to blocks. Use `flush: true` to replace instead.

**Default Behavior (Append):**

```liquid
{%- Layout -%}
{% content_for header %}
  <h1>Default Header</h1>
{% endcontent_for %}

<main>
  {% yield header %}
</main>

{%- Page (appends to header block) -%}
{% content_for header %}
  <h2>Page-specific subtitle</h2>
{% endcontent_for %}

{%- Output: -%}
<h1>Default Header</h1>
<h2>Page-specific subtitle</h2>
```

**Replace Behavior (flush: true):**

```liquid
{%- Page (replaces header block) -%}
{% content_for header, flush: true %}
  <h1>Page-specific Header Only</h1>
{% endcontent_for %}

{%- Output: -%}
<h1>Page-specific Header Only</h1>
{%- (Default header is discarded) -%}
```

**Use Cases:**

- Override layout defaults completely
- Multi-step form progression (replace form on each step)
- Dynamic sidebars (replace instead of append)
- Modal content replacement

---

## Response Headers for CORS, CSP, and Custom Headers

**Overview:** Use `response_headers` tag to set HTTP response headers for CORS, security policies, and custom headers.

**CORS Headers:**

```liquid
{% response_headers set: true %}
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
{% endresponse_headers %}
```

**Content Security Policy (CSP):**

```liquid
{% response_headers set: true %}
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' cdn.example.com; style-src 'self' 'unsafe-inline'
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
{% endresponse_headers %}
```

**Custom Headers:**

```liquid
{% response_headers set: true %}
  X-Custom-Header: custom-value
  X-Request-ID: {{ request.id }}
  Cache-Control: public, max-age=3600
{% endresponse_headers %}
```

**Conditional Headers:**

```liquid
{% if user.is_premium %}
  {% response_headers set: true %}
    X-Premium-User: true
    Cache-Control: private, max-age=7200
  {% endresponse_headers %}
{% else %}
  {% response_headers set: true %}
    Cache-Control: public, max-age=300
  {% endresponse_headers %}
{% endif %}
```

**Best Practices:**

- Set headers early in the page/layout lifecycle
- Avoid setting conflicting headers multiple times
- Use `set: true` to replace existing headers; `set: false` to append
- Test header output with browser DevTools or curl

---

## Using print vs html_safe for Unescaped Output

**Overview:** Both `print` and `html_safe` output unescaped content, but usage contexts differ.

**print Tag:** Output unescaped HTML directly:

```liquid
{% assign markup = '<strong>Bold text</strong>' %}
{% print markup %}
{%- Output: <strong>Bold text</strong> -%}
```

**html_safe Filter:** Mark a string as safe from escaping:

```liquid
{% assign markup = '<em>Italic</em>' %}
{{ markup | html_safe }}
{%- Output: <em>Italic</em> -%}
```

**When to Use Each:**

| Scenario | Use print | Use html_safe |
|----------|-----------|---------------|
| Output raw HTML | Yes | No |
| Filter on a variable | No | Yes |
| Conditionally output markup | Either | Either |
| JSON or data structures | Yes | No |
| User-generated content | Neither (security risk) | Neither (security risk) |

**Security Warning:** Only use unescaped output for trusted content. Never use on user input:

```liquid
{%- UNSAFE: User input -%}
{{ user.bio | html_safe }}

{%- SAFE: Escaped user input ----}
{{ user.bio }}

{%- SAFE: Sanitized markup ----}
{% assign sanitized = user.bio | sanitize %}
{{ sanitized | html_safe }}
```

**Performance:** `print` and `html_safe` have negligible performance difference; prefer `html_safe` for consistency with Liquid idioms.

---

## See Also

- [transaction Tag Reference](/liquid/tags/transaction)
- [try/catch Tag Reference](/liquid/tags/try-catch)
- [rollback Tag Reference](/liquid/tags/rollback)
- [cache Tag Reference](/liquid/tags/cache)
- [function Tag Reference](/liquid/tags/function)
- [export Tag Reference](/liquid/tags/export)
- [content_for Tag Reference](/liquid/tags/content-for)
- [response_headers Tag Reference](/liquid/tags/response-headers)
- [print Tag Reference](/liquid/tags/print)
- [background Tag Reference](/liquid/tags/background)
- [Gotchas & Troubleshooting](/liquid/tags/gotchas)
- [Liquid Tag Overview](/liquid/tags)
