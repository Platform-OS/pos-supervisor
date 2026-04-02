# modules/common-styling - Advanced Customization

## Theme Customization

### CSS Variables Override
Customize the theme by overriding CSS variables:

```scss
// app/assets/styles/theme.scss

:root {
  --pos-primary-color: #007bff;
  --pos-secondary-color: #6c757d;
  --pos-success-color: #28a745;
  --pos-danger-color: #dc3545;
  --pos-warning-color: #ffc107;
  --pos-info-color: #17a2b8;

  --pos-text-primary: #212529;
  --pos-text-secondary: #6c757d;
  --pos-background: #ffffff;
  --pos-border-color: #dee2e6;
}
```

### Dark Mode Support
Implement dark mode:

```scss
@media (prefers-color-scheme: dark) {
  :root {
    --pos-background: #1e1e1e;
    --pos-text-primary: #f0f0f0;
    --pos-text-secondary: #b0b0b0;
    --pos-border-color: #404040;
  }
}
```

## Custom Component Creation

### Extending Components
Create custom component variants:

```scss
// app/assets/styles/components.scss

.pos-btn-custom {
  @extend .pos-btn;
  background-color: var(--pos-primary-color);
  text-transform: uppercase;
  letter-spacing: 1px;

  &:hover {
    background-color: darken(var(--pos-primary-color), 10%);
  }
}
```

### Component Mixins
Create reusable component styles:

```scss
@mixin pos-card-variant($bg, $border) {
  background-color: $bg;
  border-color: $border;

  .pos-card-header {
    background-color: darken($bg, 5%);
  }
}

.pos-card-premium {
  @include pos-card-variant(#f8f9fa, #dee2e6);
}
```

## Responsive Design

### Breakpoints
Use framework breakpoints:

```scss
$pos-breakpoints: (
  'xs': 0,
  'sm': 576px,
  'md': 768px,
  'lg': 992px,
  'xl': 1200px
);

@media (min-width: 768px) {
  .pos-col-md-6 {
    width: 50%;
  }
}
```

### Mobile-First Approach
Build mobile designs first:

```html
<div class="pos-container">
  <div class="pos-row">
    <div class="pos-col-12 pos-col-md-6">
      Full width on mobile, half on desktop
    </div>
    <div class="pos-col-12 pos-col-md-6">
      Full width on mobile, half on desktop
    </div>
  </div>
</div>
```

## Animation and Transitions

### Add Smooth Transitions
```scss
.pos-btn {
  transition: all 0.3s ease-in-out;
}

.pos-card {
  transition: box-shadow 0.3s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
}
```

### Custom Animations
```scss
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.pos-alert {
  animation: slideIn 0.3s ease-out;
}
```

## Performance Optimization

### Lazy Loading Components
Load heavy components on demand:

```liquid
{% if show_advanced_ui %}
  {% render 'modules/common-styling/components/advanced-form' %}
{% endif %}
```

### CSS Purging
Remove unused styles in production:

```yml
# platformos.yml
assets:
  purge:
    enabled: true
    content:
      - 'app/**/*.liquid'
      - 'app/**/*.html'
```

## Accessibility Enhancements

### Semantic HTML
Use proper semantic elements:

```html
<button class="pos-btn pos-btn-primary" aria-label="Submit form">
  Submit
</button>

<div class="pos-alert pos-alert-info" role="alert">
  Important information
</div>
```

### Color Contrast
Ensure sufficient contrast:

```scss
.pos-btn-primary {
  background-color: #0062cc; // WCAG AAA compliant
  color: #ffffff;
}
```

## See Also
- configuration.md - Basic setup
- api.md - Component reference
- patterns.md - Common patterns
- gotchas.md - Common mistakes
