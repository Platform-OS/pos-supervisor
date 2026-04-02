# Sessions Gotchas

## Session Not Persisting Across Requests

### Session Set But Not Visible Next Request

```liquid
<!-- Page A: Set session -->
{% session user_id = '123' %}

<!-- Page B: Access session -->
{{ context.session.user_id }}  <!-- May be blank if cookie not transmitted -->
```

**Issue:** Browser may not transmit session cookies on cross-site requests.

**Solution:** Ensure cookies domain matches or use `SameSite=None` with `Secure`.

## Type Conversion Issues

### Numbers Stored as Strings

```liquid
<!-- WRONG: Stored as string "5" -->
{% session count = context.params.quantity %}

<!-- RIGHT: Explicit conversion to number -->
{% session count = context.params.quantity | plus: 0 %}

<!-- Math works differently -->
{{ context.session.count | plus: 1 }}  <!-- "51" vs 6 -->
```

Always convert types explicitly when needed for math operations.

## Session Size Limitations

### Exceeding 4KB Limit

```liquid
<!-- WRONG: Storing too much data -->
{% session all_products = page.products | json %}
<!-- Exceeds size limit if many products -->

<!-- RIGHT: Store IDs only, fetch when needed -->
{% session product_ids = page.products | map: 'id' | join: ',' %}
```

Store references, not entire objects. Fetch full data via GraphQL query.

## Session Data Types Not Supported

### Complex Objects

```liquid
<!-- WRONG: Objects don't serialize properly -->
{% session user = page.user %}

<!-- RIGHT: Store serializable primitives -->
{% session user_id = page.user.id %}
{% session user_name = page.user.name %}
```

Sessions only support strings, numbers, booleans. Convert complex data.

## Timing Issues with Session Writes

### Session Not Available Immediately

```liquid
<!-- WRONG: Reading immediately after write -->
{% session cart_id = new_id %}
{{ context.session.cart_id }}  <!-- May be old value temporarily -->

<!-- RIGHT: Use the variable directly -->
{% session cart_id = new_id %}
{% assign current_cart = new_id %}
```

The write may not be visible immediately in the same request. Use the assigned variable instead.

## Debugging Session Data

### Session Appears Empty

```liquid
<!-- Check if session exists -->
{% if context.session %}
  Session active
{% else %}
  No session
{% endif %}

<!-- Check specific key -->
{% if context.session.my_key %}
  Key exists: {{ context.session.my_key }}
{% else %}
  Key not found
{% endif %}
```

Use conditional checks to verify session state before access.

## Session Sharing in Shared Hosting

### Accidentally Sharing Session Between Users

In shared hosting scenarios, session cookies may bleed:

```liquid
<!-- WRONG: Trust session without validation -->
{% assign user_id = context.session.user_id %}
<!-- User could spoof this value -->

<!-- RIGHT: Validate against authenticated user -->
{% assign user_id = context.current_user.id %}
```

Always validate session data against server-side authentication.

## Browser Privacy Mode

### Sessions Cleared on Browser Close

Sessions stored in cookies are cleared when browser closes in privacy mode. Users may lose data unexpectedly.

**Best practice:** Warn users about data loss or use persistent storage alternatives.

## Cookie Consent Issues

### Session Cookies Blocked by Consent Managers

Some consent managers may block all cookies including session cookies:

```liquid
<!-- Ensure session cookie is considered necessary -->
<!-- In cookie consent policy: "Session cookies are essential for functionality" -->
```

Configure consent managers to allow essential session cookies.

## Session Hijacking Risks

### Insecure Session Handling

```liquid
<!-- WRONG: Exposing session ID in URL -->
<a href="/page?sessionid={{ context.session | json | base64_encode }}">

<!-- RIGHT: Let browser handle session cookies automatically -->
<a href="/page">
```

Never expose session IDs in URLs or JavaScript. Use HttpOnly, Secure cookies.

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Patterns Guide](./patterns.md)
- [Advanced Techniques](./advanced.md)
