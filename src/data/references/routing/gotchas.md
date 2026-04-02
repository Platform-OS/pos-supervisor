# Routing Troubleshooting Guide

Common routing errors, their causes, and solutions.

## Common Errors

### Route Not Matching

**Symptoms:** URL returns 404 or matches wrong page

**Cause:** File not in correct directory or filename doesn't match URL structure

**Solution:**

```
Expected URL: /products/123
Should be: app/views/pages/products/:id.liquid ✓
NOT: app/views/pages/product/:id.liquid ✗
```

Verify directory structure matches URL hierarchy:

```
URL /users/alice/posts should use:
app/views/pages/users/:username/posts.liquid
```

### Duplicate Slug Conflicts

**Symptoms:** Multiple pages match same URL, unpredictable behavior

**Cause:** Multiple files with same slug in different directories or extensions

**Solutions:**

1. Ensure unique filenames per directory:

```
WRONG:
app/views/pages/posts.liquid
app/views/pages/posts.json.liquid (different extension OK)

WRONG:
app/views/pages/posts/new.liquid
app/views/pages/posts/new.html.liquid (different extension OK)
```

2. Use different directories for different resource types:

```
CORRECT:
app/views/pages/articles/index.liquid (plural for lists)
app/views/pages/articles/:id.liquid (for individual items)
```

### HTTP Method Conflicts

**Symptoms:** POST/PUT/DELETE requests return 405 Method Not Allowed

**Cause:** Missing or wrong method in front matter

**Solution:** Specify method explicitly:

```yaml
---
method: post
---
```

One method per file. Separate files for different methods:

```
app/views/pages/users.liquid (method: get - list)
app/views/pages/users/create.liquid (method: post - create)
app/views/pages/users/:id/update.liquid (method: put - update)
app/views/pages/users/:id/delete.liquid (method: delete - delete)
```

### Missing CSRF Token

**Symptoms:** POST/PUT/DELETE forms fail with 403 Forbidden

**Cause:** Form submission missing CSRF token

**Solution:** Include token in forms:

```liquid
<form method="post" action="/items">
  <input type="hidden" name="authenticity_token"
         value="{{ context.authenticity_token }}">
  <!-- form fields -->
  <button type="submit">Submit</button>
</form>
```

Or use platformOS form helpers if available.

### 404 Not Found on Valid Routes

**Symptoms:** Page exists but returns 404

**Causes:**

1. File has wrong extension or in wrong location
2. Route priority - more specific route matches first
3. Query parameters interfering with slug matching

**Solution:**

```
Check file location:
URL: /api/users/123
File: app/views/pages/api/users/:id.liquid ✓

Check order (most specific first):
/posts/latest.liquid → /posts/latest
/posts/:id.liquid → /posts/123 (NOT /posts/latest)
```

## Limits and Constraints

| Constraint | Limit | Notes |
|------------|-------|-------|
| Route depth | Unlimited | `/a/b/c/d/e/f/...` all supported |
| Parameter count | Unlimited | `/users/:uid/posts/:pid/comments/:cid/...` OK |
| URL length | 2048 characters | Some browsers limit URLs |
| Query string size | 8192 characters | Platform dependent |
| Parameter name length | 255 characters | Use descriptive but concise names |
| File name length | 255 characters | OS file system limit |
| Special characters | Limited | Avoid: `<>:"/\|?*` in filenames |

## Troubleshooting Flowchart

```
Is the page returning 404?
├─ No file at expected path?
│  └─ Create: app/views/pages/your/route.liquid
│
├─ File exists but wrong location?
│  └─ Move to correct directory matching URL
│
├─ Dynamic route parameter not working?
│  └─ Check param name: /users/:id uses context.params.id
│
└─ Method not allowed (405)?
   └─ Add front matter: method: post (or put/delete)

Is context.params.xyz undefined?
├─ Parameter in URL? /posts/:xyz
│  └─ Check param name matches
│
├─ Query string? ?xyz=value
│  └─ Passed correctly via GET
│
└─ Try: {{ context.params | inspect }}
   (Shows all available params)

Are you getting wrong page content?
├─ More specific route available?
│  └─ Create: /specific/route.liquid (before wildcard)
│
├─ Multiple files same route?
│  └─ Remove duplicates in different extensions
│
└─ Verify with: {{ context.location.pathname }}
```

## Performance Considerations

1. **Wildcard routes are expensive** - Match last after specific routes
   ```
   Specific: /posts/:id.liquid (fast)
   Wildcard: /docs/*path.liquid (slower, matches anything)
   ```

2. **Deep nesting impacts lookup** - 5+ levels reasonable
   ```
   /a/b/c/d/e.liquid (fine)
   /a/b/c/d/e/f/g/h.liquid (slower)
   ```

3. **Many parameters increase overhead** - Validate early
   ```liquid
   {% unless context.params.id and context.params.name %}
     {% response_status 400 %}
   {% endunless %}
   ```

## Debugging Techniques

### Inspect All Available Parameters

```liquid
{{ context.params | inspect }}
<!-- Output: {"id"=>"123", "page"=>"2", "sort"=>"date"} -->
```

### Check Request Location

```liquid
Pathname: {{ context.location.pathname }}
Search: {{ context.location.search }}
Host: {{ context.location.host }}
```

### Verify HTTP Method

```liquid
{% if context.method == "post" %}
  Form was posted
{% else %}
  Regular page load
{% endif %}
```

### Trace Route Matching

```liquid
<!-- File: app/views/pages/posts/:id.liquid -->
Accessed: {{ context.location.pathname }}
ID param: {{ context.params.id }}
All params: {{ context.params | inspect }}
```

## See Also

- [Configuration](./configuration.md) - Slug syntax, routing rules, content types
- [API Reference](./api.md) - context properties, response control
- [Patterns](./patterns.md) - RESTful routes, best practices
- [Advanced](./advanced.md) - Route priority, complex scenarios
