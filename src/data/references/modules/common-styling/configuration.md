# modules/common-styling - Configuration

## Overview
The `modules/common-styling` is a required module providing a comprehensive CSS framework with platformOS-specific styling. It includes pre-built components and utility classes.

## Installation and Initialization

### Initialize in Application Layout
Add the init include to your main layout:

```liquid
# app/layouts/application.html.liquid

{% render 'modules/common-styling/init' %}

<!DOCTYPE html>
<html>
<head>
  <title>{{ page.title }}</title>
</head>
<body class="pos-app">
  {{ content_for_layout }}
</body>
</html>
```

### Required Wrapper Class
Always wrap your content with `pos-app`:

```html
<body class="pos-app">
  <!-- all your content -->
</body>
```

## Core CSS Framework

### Class Naming Convention
All framework classes use `pos-` prefix:

```html
<div class="pos-card">
  <div class="pos-card-header">
    <h2>Card Title</h2>
  </div>
  <div class="pos-card-body">
    Content here
  </div>
</div>
```

### Not Bootstrap or Tailwind
This is a custom framework designed specifically for platformOS:

```liquid
<!-- DO NOT USE -->
<div class="container">
<div class="btn btn-primary">

<!-- USE INSTEAD -->
<div class="pos-container">
<button class="pos-btn pos-btn-primary">
```

## Component Library

Available pre-built components:
- Buttons
- Cards
- Forms
- Alerts
- Pagination
- File Upload
- Toast Notifications
- Tables
- Modals

## Style Guide Access

View all available components and styles:

```
http://yourinstance.platformos.com/style-guide
```

The style guide demonstrates:
- All available components
- Color palette
- Typography
- Spacing system
- Responsive behavior

## Custom Styling Integration

### Extending Styles
Add custom CSS alongside framework:

```scss
// app/assets/styles/custom.scss
@import 'modules/common-styling/init';

// Your custom styles here
.my-custom-class {
  color: var(--pos-primary-color);
}
```

### CSS Variables
Use platformOS CSS variables:

```css
.custom-element {
  color: var(--pos-text-primary);
  background: var(--pos-background);
  border: 1px solid var(--pos-border-color);
}
```

## See Also
- api.md - Component API reference
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced customization
