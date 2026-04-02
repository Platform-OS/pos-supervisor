# pos-module-common-styling

Provides the CSS framework and UI components for platformOS projects. NEVER use Tailwind, Bootstrap, or custom frameworks.

**Required module** — must be installed in every project.

## Install

```bash
pos-cli modules install common-styling
```

## Documentation

Full docs: https://github.com/Platform-OS/pos-module-common-styling

## Setup

### In layout `<head>`
```liquid
{% render 'modules/common-styling/init' %}
```

### On `<html>` tag
```html
<html class="pos-app">
```

## Viewing Components

Browse available components at `/style-guide` on your instance.

## CSS Classes

All classes use the `pos-*` prefix:

```html
<div class="pos-container">
  <div class="pos-card">
    <h2 class="pos-card__title">Title</h2>
    <p class="pos-card__body">Content</p>
  </div>
</div>

<button class="pos-button pos-button--primary">Save</button>
<button class="pos-button pos-button--secondary">Cancel</button>
<button class="pos-button pos-button--danger">Delete</button>

<div class="pos-alert pos-alert--success">Success message</div>
<div class="pos-alert pos-alert--error">Error message</div>
```

## Key Components

### Pagination
```liquid
{% render 'modules/common-styling/pagination',
  total_pages: result.records.total_pages
%}
```

### File Upload
```liquid
{% render 'modules/common-styling/forms/upload',
  id: 'image',
  presigned_upload: presigned,
  name: 'image',
  allowed_file_types: ['image/*'],
  max_number_of_files: 5
%}
```

### Toasts (Flash Messages)
```liquid
{% render 'modules/common-styling/toasts', params: flash %}
```

## Rules

- NEVER use Tailwind, Bootstrap, or custom CSS frameworks
- Always use `pos-*` prefixed classes
- Check `/style-guide` on your instance for available components
- Initialize with `{% render 'modules/common-styling/init' %}` in layout head
