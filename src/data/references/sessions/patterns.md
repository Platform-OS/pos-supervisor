# Sessions Patterns

## Shopping Cart Pattern

Track cart state across pages:

```liquid
<!-- Add to cart -->
{% capture cart_items %}{{ context.session.cart_items | default: '' }}{% endcapture %}
{% capture updated_items %}{{ cart_items }},{{ context.params.product_id }}{% endcapture %}
{% session cart_items = updated_items | split: ',' | uniq | join: ',' %}

<!-- Display cart -->
<div class="cart">
  {% assign items = context.session.cart_items | split: ',' %}
  <p>Items: {{ items | size }}</p>
</div>
```

## Multi-Step Wizard Pattern

Manage wizard state progression:

```liquid
<!-- Start wizard -->
{% unless context.session.wizard_active %}
  {% session wizard_step = 1 %}
  {% session wizard_active = true %}
  {% session wizard_start_time = 'now' %}
{% endunless %}

<!-- Check current step -->
{% if context.session.wizard_step == 1 %}
  {% include 'wizard/step-personal-info' %}
{% elsif context.session.wizard_step == 2 %}
  {% include 'wizard/step-address' %}
{% elsif context.session.wizard_step == 3 %}
  {% include 'wizard/step-payment' %}
{% endif %}

<!-- Next button handler -->
{% if context.params.next %}
  {% session wizard_step = context.session.wizard_step | plus: 1 %}
{% endif %}

<!-- Reset button handler -->
{% if context.params.reset %}
  {% session wizard_step = 1 %}
  {% session wizard_data = null %}
{% endif %}
```

## User Preferences Pattern

Store non-critical user settings:

```liquid
<!-- Store preferences from form -->
{% if context.params.preferences %}
  {% session theme = context.params.theme %}
  {% session language = context.params.language %}
  {% session font_size = context.params.font_size %}
{% endif %}

<!-- Apply preferences -->
<html lang="{{ context.session.language | default: 'en' }}">
  <head>
    <style>
      :root {
        --theme: {{ context.session.theme | default: 'light' }};
        --font-size: {{ context.session.font_size | default: 'normal' }};
      }
    </style>
  </head>
</html>
```

## Flash Message Pattern

Display one-time messages:

```liquid
<!-- Set flash message -->
{% if context.params.action == 'save' %}
  {% session flash_message = 'Settings saved successfully!' %}
  {% session flash_type = 'success' %}
{% endif %}

<!-- Display and clear flash -->
{% if context.session.flash_message %}
  <div class="flash flash--{{ context.session.flash_type }}">
    {{ context.session.flash_message }}
  </div>
  {% session flash_message = null %}
  {% session flash_type = null %}
{% endif %}
```

## Search History Pattern

Track recent searches:

```liquid
<!-- Record search -->
{% if context.params.q %}
  {% capture history %}{{ context.session.search_history | default: '' }}{% endcapture %}
  {% assign searches = history | split: '|' %}
  {% assign searches = searches | unshift: context.params.q %}
  {% assign searches = searches | slice: 0, 10 %}
  {% session search_history = searches | join: '|' %}
{% endif %}

<!-- Display history -->
<ul class="search-history">
  {% for search in context.session.search_history | split: '|' %}
    {% unless search == blank %}
      <li><a href="?q={{ search }}">{{ search }}</a></li>
    {% endunless %}
  {% endfor %}
</ul>
```

## Feature Flag Pattern

Toggle features per user:

```liquid
<!-- Admin sets feature flags -->
{% if context.user.is_admin %}
  {% session beta_new_ui = true %}
  {% session beta_advanced_search = false %}
{% endif %}

<!-- Use flags in templates -->
{% if context.session.beta_new_ui %}
  {% include 'components/new-ui' %}
{% else %}
  {% include 'components/legacy-ui' %}
{% endif %}
```

## Authentication State Pattern

Track login and permissions:

```liquid
<!-- On successful login -->
{% graphql res = 'get_user', id: context.params.user_id %}
{% session user_id = res.user.id %}
{% session user_email = res.user.email %}
{% session logged_in = true %}

<!-- Check auth in pages -->
{% if context.session.logged_in %}
  <p>Welcome, {{ context.session.user_email }}</p>
{% else %}
  <a href="/login">Please log in</a>
{% endif %}

<!-- Logout -->
{% if context.params.logout %}
  {% session user_id = null %}
  {% session user_email = null %}
  {% session logged_in = null %}
{% endif %}
```

## See Also

- [Configuration Guide](./configuration.md)
- [API Reference](./api.md)
- [Advanced Techniques](./advanced.md)
- [Gotchas & Issues](./gotchas.md)
