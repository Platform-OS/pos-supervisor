# Translations Patterns

## Complete Multi-Language Setup

Implement i18n with language switching via URL parameter:

```liquid
<!-- Set language from parameter -->
{% if context.params.lang %}
  {% context language: context.params.lang %}
{% endif %}

<!-- Language selector in header -->
<div class="language-selector">
  {% assign supported_langs = 'en,de,fr,es' | split: ',' %}
  {% for lang in supported_langs %}
    <a href="?lang={{ lang }}"
       class="{% if lang == context.language %}active{% endif %}">
      {{ 'language_name.' | append: lang | t }}
    </a>
  {% endfor %}
</div>

<!-- Display translated content -->
<h1>{{ 'page.title' | t }}</h1>
<p>{{ 'page.description' | t }}</p>
```

## Dynamic Content Translation

Translate user-provided content with fallback:

```liquid
{% assign user_name = context.current_user.name %}
<p>{{ 'welcome_message' | t: user_name: user_name, default: "Welcome!" }}</p>

<!-- If 'welcome_message' missing, shows "Welcome!" -->
```

## Form Label Translations

Translate form labels and validation messages:

```liquid
<form>
  <label for="name">{{ 'form.labels.name' | t }}</label>
  <input type="text" id="name" name="name" required>

  <label for="email">{{ 'form.labels.email' | t }}</label>
  <input type="email" id="email" name="email" required>

  <button type="submit">{{ 'form.buttons.submit' | t }}</button>
</form>

<!-- Validation messages -->
{% if form.errors %}
  <ul class="errors">
    {% for field, error in form.errors %}
      <li>{{ 'form.errors.' | append: field | t }}</li>
    {% endfor %}
  </ul>
{% endif %}
```

## Email Translation Pattern

Translate email templates:

```liquid
<!-- app/emails/order_confirmation.liquid -->
Subject: {{ 'emails.order_confirmation.subject' | t: order_id: order.id }}

---

{{ 'emails.order_confirmation.greeting' | t: customer_name: order.customer_name }}

{{ 'emails.order_confirmation.body' | t: order_id: order.id, amount: order.total | pricify }}

{{ 'emails.signature' | t }}
```

## Navigation Translation Pattern

Translate navigation menus:

```liquid
<nav>
  <ul>
    <li><a href="/">{{ 'nav.home' | t }}</a></li>
    <li><a href="/products">{{ 'nav.products' | t }}</a></li>
    <li><a href="/about">{{ 'nav.about' | t }}</a></li>
    <li><a href="/contact">{{ 'nav.contact' | t }}</a></li>
  </ul>
</nav>
```

Centralize navigation text for consistent translation.

## Error Message Translation

Translate error and success messages:

```liquid
{% if context.params.action == 'save' %}
  {% graphql result = 'save_data', data: context.params.data %}

  {% if result.error %}
    <div class="error">
      {{ 'messages.error.' | append: result.error_code | t: default: result.error_message }}
    </div>
  {% else %}
    <div class="success">
      {{ 'messages.success.saved' | t }}
    </div>
  {% endif %}
{% endif %}
```

## Contextual Translation Selection

Choose translation based on context:

```liquid
<!-- Greeting varies by time of day -->
{% assign hour = 'now' | date: '%H' | plus: 0 %}

{% if hour < 12 %}
  <p>{{ 'greetings.morning' | t: name: context.current_user.name }}</p>
{% elsif hour < 18 %}
  <p>{{ 'greetings.afternoon' | t: name: context.current_user.name }}</p>
{% else %}
  <p>{{ 'greetings.evening' | t: name: context.current_user.name }}</p>
{% endif %}
```

## Modal and Dialog Translation

Translate modal content:

```liquid
<div class="modal" id="confirmDelete">
  <div class="modal-header">
    <h2>{{ 'dialogs.confirm_delete.title' | t }}</h2>
  </div>
  <div class="modal-body">
    <p>{{ 'dialogs.confirm_delete.message' | t: item: item.name }}</p>
  </div>
  <div class="modal-footer">
    <button class="btn-cancel">{{ 'buttons.cancel' | t }}</button>
    <button class="btn-delete">{{ 'buttons.delete' | t }}</button>
  </div>
</div>
```

## Partial Reusable Translations

Use partials for shared translated content:

```liquid
<!-- app/partials/translated-footer.liquid -->
<footer>
  <p>{{ 'footer.copyright' | t: year: 'now' | date: '%Y' }}</p>
  <p>{{ 'footer.company_name' | t }}</p>
</footer>

<!-- Use in any layout -->
{% include 'translated-footer' %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
