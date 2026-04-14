# Design System

This project uses a custom CSS design system. All pages and partials, including files from scaffold and  must use its classes and token variables exclusively.

## Quick Setup

1. CSS files live in `app/assets/styles/` — four files: `design-tokens.css`, `base.css`, `utilities.css`, `components.css`
2. Load them in `app/views/layouts/application.html.liquid` using `{{ 'filename.css' | asset_url }}`
3. Use the documented classes in templates — `.container`, `.section`, `.layout-grid`, `.col-4/6/8/12`, `.card`, `.btn`, `.btn-primary`, `.hero`, `.feature-grid`
4. No inline `style=""` attributes. Token variables in `{% content_for 'head' %}` only.

See `domain_guide(domain: "design-system", section: "overview")` for the full integration guide.
See `domain_guide(domain: "design-system", section: "patterns")` for ready-to-use page templates.

## If modules/common-styling is installed

Load order: `{% render 'modules/common-styling/init', reset: true %}` FIRST, then design system
`<link>` tags AFTER, so design tokens override common-styling's tokens.

Keep using common-styling's `pos-button`, `pos-form`, `pos-link`, `pos-heading-*` classes.
Use design system's `container`, `section`, `feature-grid`, `card` for layout and content structure.

See `domain_guide(domain: "design-system", section: "common-styling-migration")` for the full
coexistence guide including the flex inline-style exception, form patterns, and auth URL patterns.
