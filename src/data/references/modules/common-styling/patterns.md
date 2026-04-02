# modules/common-styling - Common Patterns

## Layout Patterns

### Basic Page Layout
```liquid
{% render 'modules/common-styling/init' %}

<div class="pos-app">
  <div class="pos-container">
    <header class="pos-header">
      <h1>My App</h1>
    </header>
    <main class="pos-main">
      {{ content_for_layout }}
    </main>
    <footer class="pos-footer">
      <p>&copy; 2024</p>
    </footer>
  </div>
</div>
```

### Two-Column Layout
```html
<div class="pos-container">
  <div class="pos-row">
    <div class="pos-col-8">
      <div class="pos-card">Main content</div>
    </div>
    <div class="pos-col-4">
      <div class="pos-card">Sidebar</div>
    </div>
  </div>
</div>
```

## Form Patterns

### Login Form
```html
<form class="pos-form" method="post">
  <div class="pos-form-group">
    <label class="pos-label">Email</label>
    <input type="email" class="pos-input" required>
  </div>
  <div class="pos-form-group">
    <label class="pos-label">Password</label>
    <input type="password" class="pos-input" required>
  </div>
  <button type="submit" class="pos-btn pos-btn-primary">
    Sign In
  </button>
</form>
```

### Search Form
```html
<form class="pos-form pos-form-inline">
  <div class="pos-form-group">
    <input type="text" class="pos-input" placeholder="Search...">
  </div>
  <button type="submit" class="pos-btn pos-btn-primary">
    Search
  </button>
</form>
```

## Data Display Patterns

### Card List
```html
<div class="pos-container">
  {% for item in items %}
    <div class="pos-card">
      <div class="pos-card-header">
        <h3>{{ item.title }}</h3>
      </div>
      <div class="pos-card-body">
        <p>{{ item.description }}</p>
      </div>
      <div class="pos-card-footer">
        <a href="{{ item.url }}" class="pos-btn pos-btn-secondary">
          View More
        </a>
      </div>
    </div>
  {% endfor %}
</div>
```

### Notification Display
```html
{% if message %}
  <div class="pos-alert pos-alert-success">
    {{ message }}
  </div>
{% endif %}

{% if error %}
  <div class="pos-alert pos-alert-danger">
    {{ error }}
  </div>
{% endif %}
```

## Pagination Pattern
```html
<nav class="pos-pagination">
  {% if paginate.previous_page %}
    <a href="?page={{ paginate.previous_page }}" class="pos-page-link">
      Previous
    </a>
  {% endif %}

  {% for page in paginate.pages %}
    <a href="?page={{ page }}"
       class="pos-page-link {% if page == paginate.current_page %}active{% endif %}">
      {{ page }}
    </a>
  {% endfor %}

  {% if paginate.next_page %}
    <a href="?page={{ paginate.next_page }}" class="pos-page-link">
      Next
    </a>
  {% endif %}
</nav>
```

## See Also
- configuration.md - Setup instructions
- api.md - Component reference
- gotchas.md - Common mistakes
- advanced.md - Advanced customization
