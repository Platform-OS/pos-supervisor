# Design System — Page Patterns

Complete, copy-ready templates for the most common platformOS page types.
All patterns use only valid design system classes and correct platformOS Liquid syntax.

---

## Landing Page

```liquid
---
slug: ''
metadata:
  title: Community Marketplace
---
<section class="hero">
  <div class="container layout-grid">
    <div class="col-8">
      <h1>Welcome to the Marketplace</h1>
      <p>Find unique items from local sellers.</p>
      <a href="/items" class="btn btn-primary">Browse Items</a>
    </div>
    <div class="col-4">
      <div class="card">
        <h3>{{ 'app.site.tagline' | t }}</h3>
      </div>
    </div>
  </div>
</section>

<section class="section section-alt">
  <div class="container">
    <h2>Featured Items</h2>
    {% liquid
      function items = 'queries/items/search', limit: 6
      render 'items/list', items: items.results
    %}
  </div>
</section>
```

---

## Listing Page (index)

```liquid
---
slug: items
metadata:
  title: Items for Sale
---
{% liquid
  function items = 'queries/items/search', page: context.params.page, limit: 20
  render 'items/list', items: items.results
%}
```

**Partial `app/views/partials/items/list.liquid`:**

```liquid
{% doc %}
  @param items {array} - Array of item records
{% enddoc %}

<section class="section">
  <div class="container">
    <div class="feature-grid">
      {% for item in items %}
        {% render 'items/card', item: item %}
      {% endfor %}
    </div>
  </div>
</section>
```

**Partial `app/views/partials/items/card.liquid`:**

```liquid
{% doc %}
  @param item {object} - Item record for card display
{% enddoc %}

<div class="card">
  <h3><a href="/items/{{ item.id }}">{{ item.title }}</a></h3>
  <p>{{ item.description }}</p>
  <a href="/items/{{ item.id }}" class="btn btn-primary">View</a>
</div>
```

---

## Detail Page (show)

```liquid
---
slug: items/:id
metadata:
  title: Item Detail
---
{% liquid
  function item = 'queries/items/find', id: context.params.id
  render 'items/show', item: item
%}
```

**Partial `app/views/partials/items/show.liquid`:**

```liquid
{% doc %}
  @param item {object} - Item record to display
{% enddoc %}

<section class="section">
  <div class="container layout-grid">
    <div class="col-8">
      <article class="card">
        <h1>{{ item.title }}</h1>
        <p>{{ item.description }}</p>
      </article>
    </div>
    <div class="col-4">
      <div class="card">
        <h3>Seller Info</h3>
        <p>{{ item.seller_id }}</p>
        <a href="/contact" class="btn btn-primary">Contact Seller</a>
      </div>
    </div>
  </div>
</section>
```

---

## Auth Page (login/register)

```liquid
---
slug: sign-in
metadata:
  title: Sign In
---
<section class="section">
  <div class="container">
    <div class="layout-grid">
      <div class="col-6">
        <div class="card">
          <h2>Sign In</h2>
          {% render 'shared/auth_form', action: '/session', method: 'POST' %}
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## Dashboard (two-column admin)

```liquid
---
slug: dashboard
metadata:
  title: Dashboard
---
<section class="section">
  <div class="container layout-grid">
    <div class="col-4">
      {% render 'shared/sidebar' %}
    </div>
    <div class="col-8">
      <div class="card">
        <h2>Recent Activity</h2>
        {% render 'dashboard/activity_feed' %}
      </div>
    </div>
  </div>
</section>
```

---

## Layout Template

Full `app/views/layouts/application.html.liquid`:

```liquid
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ context.page.metadata.title | default: "My App" }}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">
  <link rel="stylesheet" href="{{ 'design-tokens.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'base.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'utilities.css' | asset_url }}">
  <link rel="stylesheet" href="{{ 'components.css' | asset_url }}">
  {% yield 'head' %}
</head>
<body>
  {% render 'shared/header' %}

  {{ content_for_layout }}

  {% yield 'footer_scripts' %}
</body>
</html>
```

---

## Header Partial

`app/views/partials/shared/header.liquid` (no params needed):

```liquid
<header class="section-alt">
  <div class="container layout-grid">
    <div class="col-4">
      <a href="/">{{ 'app.site.title' | t }}</a>
    </div>
    <nav class="col-8">
      <a href="/items">{{ 'app.items.title' | t }}</a>
      {% if context.current_user %}
        <a href="/dashboard">Dashboard</a>
        <a href="/sign-out" class="btn btn-primary">Sign Out</a>
      {% else %}
        <a href="/sign-in" class="btn btn-primary">Sign In</a>
      {% endif %}
    </nav>
  </div>
</header>
```

> **Note:** This partial has no `{% doc %}` block because it takes no params.
> pos-supervisor only requires `{% doc %}` when a partial has `@param` declarations.
