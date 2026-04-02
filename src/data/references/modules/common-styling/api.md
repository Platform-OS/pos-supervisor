# modules/common-styling - API Reference

## Component Classes

### Buttons
```html
<button class="pos-btn pos-btn-primary">Primary</button>
<button class="pos-btn pos-btn-secondary">Secondary</button>
<button class="pos-btn pos-btn-danger">Danger</button>
<button class="pos-btn pos-btn-success">Success</button>
<button class="pos-btn pos-btn-small">Small</button>
<button class="pos-btn pos-btn-large">Large</button>
```

### Cards
```html
<div class="pos-card">
  <div class="pos-card-header">
    <h3>Card Header</h3>
  </div>
  <div class="pos-card-body">
    Card content goes here
  </div>
  <div class="pos-card-footer">
    Footer text
  </div>
</div>
```

### Forms
```html
<form class="pos-form">
  <div class="pos-form-group">
    <label for="email" class="pos-label">Email</label>
    <input type="email" id="email" class="pos-input">
  </div>
  <div class="pos-form-group">
    <label class="pos-checkbox">
      <input type="checkbox">
      Remember me
    </label>
  </div>
</form>
```

### Alerts
```html
<div class="pos-alert pos-alert-info">
  <strong>Info:</strong> This is informational
</div>

<div class="pos-alert pos-alert-success">
  <strong>Success:</strong> Operation completed
</div>

<div class="pos-alert pos-alert-warning">
  <strong>Warning:</strong> Check this
</div>

<div class="pos-alert pos-alert-danger">
  <strong>Error:</strong> Something went wrong
</div>
```

### Pagination
```html
<nav class="pos-pagination">
  <a href="?page=1" class="pos-page-link">Previous</a>
  <a href="?page=2" class="pos-page-link active">2</a>
  <a href="?page=3" class="pos-page-link">3</a>
  <a href="?page=3" class="pos-page-link">Next</a>
</nav>
```

### File Upload
```html
<div class="pos-upload">
  <input type="file" class="pos-file-input" multiple>
  <div class="pos-upload-zone">
    Drop files here or click to upload
  </div>
</div>
```

### Toasts
```html
<div class="pos-toast pos-toast-success">
  <span>Successfully saved!</span>
  <button class="pos-toast-close">×</button>
</div>
```

## Utility Classes

### Spacing
```html
<div class="pos-p-1">Padding 1</div>
<div class="pos-m-2">Margin 2</div>
<div class="pos-p-x-3">Horizontal padding</div>
<div class="pos-m-y-2">Vertical margin</div>
```

### Text
```html
<p class="pos-text-primary">Primary text</p>
<p class="pos-text-secondary">Secondary text</p>
<p class="pos-text-center">Centered</p>
<p class="pos-text-bold">Bold</p>
```

### Display
```html
<div class="pos-flex">Flexbox</div>
<div class="pos-grid">Grid</div>
<div class="pos-hidden">Hidden</div>
```

## See Also
- configuration.md - Setup and initialization
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced customization
