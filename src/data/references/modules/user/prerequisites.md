# modules/user - Required Setup

## CRITICAL: Custom Permission Actions Require permissions.liquid

If you use `can_do_or_redirect`, `can_do`, or `can_do_or_unauthorized` with **any custom action**
(i.e., anything other than built-in role names like `authenticated` or `admin`), you MUST create
this file first:

```
app/views/partials/permissions.liquid
```

**Without this file, all custom permission checks silently return false.**
This means `can_do_or_redirect` will redirect every user — including logged-in ones — back to the
home page, with no error message. This is the most common auth setup mistake.

### Minimal permissions.liquid

The file must handle the actions you define. Use `{% case action %}` to map actions to conditions:

```liquid
{% case action %}
  {% when 'blog_post.create' %}
    {% if context.current_user %}
      {% assign result = true %}
    {% endif %}

  {% when 'blog_post.update' %}
    {% if context.current_user.id == object.user_id %}
      {% assign result = true %}
    {% endif %}

  {% when 'blog_post.delete' %}
    {% if context.current_user.id == object.user_id %}
      {% assign result = true %}
    {% endif %}
{% endcase %}
```

The module checks `result`. If `result` is not `true`, the user is denied.

### "Any authenticated user" pattern

For actions that any logged-in user can perform:

```liquid
{% case action %}
  {% when 'blog_post.create' %}
    {% if context.current_user %}
      {% assign result = true %}
    {% endif %}
{% endcase %}
```

### Built-in role actions (no permissions.liquid needed)

These work without a custom permissions file because the module handles them internally:

- Checking `roles contains 'admin'`
- Using `with_action: 'authenticated'` (any logged-in user)

Only custom string actions like `'blog_post.create'` require the file.

---

## IMPORTANT: include vs render for Auth Helpers

Auth helpers (`can_do`, `can_do_or_redirect`, `can_do_or_unauthorized`) **must use `include`**,
not `render`. They need access to the caller's variable scope to set `can_do` and similar
variables that your template reads after the call.

```liquid
<!-- CORRECT — use include for auth helpers -->
{% include 'modules/user/helpers/can_do' with_action: 'edit_post' %}
{% if can_do %}
  <!-- accessible because include shares scope -->
{% endif %}

<!-- WRONG — render does not share scope -->
{% render 'modules/user/helpers/can_do' with_action: 'edit_post' %}
{% if can_do %} <!-- always nil here -->
{% endif %}
```

The linter flags `include` as deprecated. **This warning is expected and unavoidable for auth helpers.**
The module API explicitly requires `include` for scope sharing. Use `include` and accept the warning.

Scaffold-generated auth checks use `{% function %}` (which calls commands/queries), so they do not
trigger this warning. The `include` requirement applies only when calling auth helpers directly from
your own partials or pages.

---

## Setup Checklist Before Using Authorization

Before adding any auth checks to your pages or partials:

- [ ] `app/views/partials/permissions.liquid` exists and handles all custom actions you will use
- [ ] You know which actions require `include` (helpers) vs `{% function %}` (commands/queries)
- [ ] Pages that mutate data call the auth check **before** any command is executed
