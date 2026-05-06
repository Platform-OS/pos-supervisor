# Pages -- Gotchas & Troubleshooting

Common errors, limits, and debugging guidance for page files.

## Architecture Rules (Type 2 failures — linter does not catch these)

### Pages are controllers — no inline HTML

**Cause:** Putting HTML markup directly in a page file. Pages are controllers: they fetch data
and delegate rendering to partials. The linter does not catch this — the page will render,
but the architecture is wrong and becomes unmaintainable.

```liquid
{# WRONG — page contains HTML: #}
---
slug: products/index
layout: application
---
{% graphql g = 'products/list' %}
<div class="container">
  <h1>Products</h1>
  {% for product in g.records.results %}
    <div class="card">{{ product.properties_object.title }}</div>
  {% endfor %}
</div>

{# RIGHT — page is controller only: #}
---
slug: products/index
layout: application
---
{% graphql g = 'products/list' %}
{% render 'products/index', products: g.records.results %}
```

Allowed tags in pages: `{% graphql %}`, `{% render %}`, `{% function %}`, `{% redirect_to %}`,
`{% liquid %}`, `{% if %}` / `{% unless %}` for guards.

### Page title — two patterns, one for each use case

**Static title** (same every time the page loads — from front matter):

```yaml
# In page front matter:
---
slug: about
layout: application
metadata:
  title: About Us
  description: Learn about our company
---
```

```liquid
{# In layout: #}
<title>{{ context.page.metadata.title | default: 'My App' }}</title>
<meta name="description" content="{{ context.page.metadata.description }}">
```

**Dynamic title** (depends on data — content_for/yield):

```liquid
{# In page — after fetching data: #}
{% graphql g = 'products/find', id: context.params.id %}
{% assign product = g.record %}
{% content_for 'title' %}{{ product.properties_object.name }}{% endcontent_for %}
{% render 'products/show', product: product %}

{# In layout — the yield reads the content_for block: #}
<title>{% yield 'title' %}</title>
```

`content_for` and `yield` must use the same slot name string exactly.

---

## Nested Assignment with `assign`

Use the extended `assign` tag syntax for nested hash and array operations:

```liquid
{% assign data = {} %}
{% assign data['profile'] = profile %}
{% assign data['is_admin'] = false %}

{# Empty array literal: #}
{% assign items = [] %}

{# Array append: #}
{% assign items << new_item %}
```

The `function` tag also supports these forms: `{% function data['product'] = 'products/find', id: id %}`

## Common Errors

### "Liquid error: undefined method 'graphql'"

**Cause:** You are calling `{% graphql %}` inside a partial instead of a page.

**Solution:** Move the GraphQL call to the page file and pass the result to the partial as a parameter.

### Root page (`/`) — omit the slug entirely

**Cause:** Setting `slug: /` or `slug: ""` or `slug: index` in front matter for the home page, then getting an InvalidSlug warning.

**Solution:** For the home page (root `/`), do not set a slug at all. A page at `app/views/pages/index.html.liquid` serves `/` by default — no front matter slug is needed.

```liquid
{# WRONG — triggers InvalidSlug warning: #}
---
slug: /
layout: application
---

{# RIGHT — no slug needed for root page: #}
---
layout: application
---
```

### "404 Not Found" for a page that exists

**Cause:** The slug in front matter does not match the requested URL, or the file extension does not match the expected content type.

**Solution:** Verify the `slug:` in front matter matches the URL pattern. Check that `.json.liquid` files are requested as `/path.json`, not `/path`.

### "CSRF token is invalid" on POST/PUT/DELETE

**Cause:** The form submission is missing the `authenticity_token` field, or the token has expired.

**Solution:** Include `<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">` in every non-GET form.

### "Multiple pages match the same route"

**Cause:** Two page files define the same slug and method combination.

**Solution:** Ensure each slug + method pair is unique. Use `platformos-check` to detect conflicts before deploying.

### "Page renders blank content"

**Cause:** The page calls `{% render %}` but the partial path is wrong, or the partial is empty.

**Solution:** Verify the partial path matches a file at `app/views/partials/<path>.liquid`. Check for typos in the path string.

### "Variables from partial are not accessible in page"

**Cause:** Variables defined inside partials are local to that partial scope.

**Solution:** Use `{% function result = 'partial' %}` to capture a return value, or use `{% export %}` to make values available via `context.exports`.

### "Redirect loop detected"

**Cause:** A page redirects to a URL that resolves back to the same page, or an auth guard redirects to a login page that redirects back.

**Solution:** Add a condition before redirecting. Check `context.location.pathname` to avoid self-redirects.

### "Layout not found"

**Cause:** The `layout:` value in front matter references a layout file that does not exist in `app/views/layouts/`.

**Solution:** Create the layout file or fix the name. Use `layout: ""` for no layout.

## Limits

| Resource                     | Limit               | Notes                                         |
|------------------------------|----------------------|-----------------------------------------------|
| Front matter slug length     | 255 characters       | Includes dynamic segments                     |
| URL parameters per request   | ~100                 | Combined slug + query params                  |
| Page file size               | 1 MB                 | Keep pages thin -- use partials for content    |
| Nested partial depth         | 3 (default)          | Override with `max_deep_level` in front matter |
| GraphQL calls per page       | No hard limit        | Each call adds latency; minimize for performance|
| Redirect chain depth         | 10 hops              | Browser-enforced                              |
| Response body size           | 10 MB                | For large responses consider pagination        |

## Troubleshooting Flowchart

```
Page not working?
├── Getting 404?
│   ├── Check slug matches URL exactly
│   ├── Check method matches request method
│   ├── Check file is in app/views/pages/
│   └── Run platformos-check for conflicts
├── Getting blank page?
│   ├── Check partial path is correct
│   ├── Check partial file exists
│   ├── Add {% log %} statements to trace execution
│   └── Check layout is rendering {{ content_for_layout }}
├── CSRF error?
│   ├── Verify authenticity_token in form
│   ├── Check form method matches page method
│   └── Ensure session cookies are enabled
├── Data not loading?
│   ├── Check GraphQL file path is correct
│   ├── Test query in pos-cli gui GraphQL editor
│   ├── Verify variable names match between query and page
│   └── Check filter/argument values are correct types
└── Auth redirect loop?
    ├── Check can_do_or_unauthorized logic
    ├── Verify login page does not itself require auth
    └── Check return_url parameter handling
```

## See Also

- [Pages Overview](README.md) -- introduction and key concepts
- [Pages Configuration](configuration.md) -- front matter reference
- [Pages API](api.md) -- tags and context objects
- [Pages Advanced](advanced.md) -- edge cases and optimization
- [Routing Gotchas](../routing/gotchas.md) -- URL matching problems
