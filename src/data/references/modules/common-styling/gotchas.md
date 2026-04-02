# modules/common-styling - Common Gotchas

## Critical: Do NOT Use Tailwind or Bootstrap

Never import or use Bootstrap or Tailwind classes:

```html
<!-- WRONG -->
<div class="container">
  <button class="btn btn-primary">Click me</button>
</div>

<!-- CORRECT -->
<div class="pos-container">
  <button class="pos-btn pos-btn-primary">Click me</button>
</div>
```

Mixing frameworks causes CSS conflicts and breaks the design system.

## Missing pos-app Class

Always wrap your entire application with `pos-app`:

```html
<!-- WRONG -->
<body>
  <div class="pos-container">
    <!-- content -->
  </div>
</body>

<!-- CORRECT -->
<body class="pos-app">
  <div class="pos-container">
    <!-- content -->
  </div>
</body>
```

Without `pos-app`, many styles won't apply correctly.

## Forgetting to Initialize

Always include the init render in your main layout:

```liquid
<!-- WRONG - styles don't load -->
<!DOCTYPE html>
<html>
<body>
  {{ content_for_layout }}
</body>
</html>

<!-- CORRECT -->
{% render 'modules/common-styling/init' %}
<!DOCTYPE html>
<html>
<body class="pos-app">
  {{ content_for_layout }}
</body>
</html>
```

## Class Name Typos

Common typos cause styles to not apply:

```html
<!-- WRONG - common typos -->
<button class="pos-btn-primary">Wrong</button>
<div class="pos-containter">Wrong</div>
<input class="pos-imput">Wrong</input>

<!-- CORRECT -->
<button class="pos-btn pos-btn-primary">Right</button>
<div class="pos-container">Right</div>
<input class="pos-input">
```

## Nested Card Structure

Don't nest cards without proper structure:

```html
<!-- WRONG - improper nesting -->
<div class="pos-card">
  <div class="pos-card">
    <!-- double nesting breaks layout -->
  </div>
</div>

<!-- CORRECT -->
<div class="pos-card">
  <div class="pos-card-body">
    <div class="pos-card">
      Nested card content
    </div>
  </div>
</div>
```

## Form Group Mistakes

Don't skip form-group wrapper:

```html
<!-- WRONG -->
<form>
  <label>Email</label>
  <input type="email" class="pos-input">
</form>

<!-- CORRECT -->
<form class="pos-form">
  <div class="pos-form-group">
    <label class="pos-label">Email</label>
    <input type="email" class="pos-input">
  </div>
</form>
```

## Inline vs Block Buttons

Understand button sizing:

```html
<!-- These are different -->
<button class="pos-btn pos-btn-small">Small</button>
<button class="pos-btn pos-btn-large">Large</button>

<!-- Full width button needs wrapper -->
<div class="pos-btn-block">
  <button class="pos-btn pos-btn-primary">Full Width</button>
</div>
```

## Alert Auto-Dismissal

Alerts don't auto-dismiss:

```html
<!-- WRONG - won't disappear automatically -->
<div class="pos-alert pos-alert-success">
  Message persists forever
</div>

<!-- CORRECT - add close button and JavaScript -->
<div class="pos-alert pos-alert-success" id="myAlert">
  <span>Success!</span>
  <button class="pos-alert-close" onclick="this.parentElement.style.display='none';">
    ×
  </button>
</div>
```

## See Also
- configuration.md - Setup instructions
- api.md - Component reference
- patterns.md - Common patterns
- advanced.md - Advanced customization
