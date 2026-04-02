# Layouts -- Gotchas & Troubleshooting

Common errors, limits, and debugging guidance for layout files.

## Common Errors

### "Page content not appearing"

**Cause:** The layout file is missing `{{ content_for_layout }}`.

**Solution:** Add `{{ content_for_layout }}` to the layout body. Every layout must include this exactly once.

### "Common-styling components look broken"

**Cause:** The `<html>` tag is missing `class="pos-app"` or `{% render 'modules/common-styling/init' %}` is not in `<head>`.

**Solution:** Ensure both are present:
```liquid
<html class="pos-app">
<head>
  {% render 'modules/common-styling/init' %}
</head>
```

### "Flash messages not appearing after redirect"

**Cause:** The flash message handling code is missing from the layout, or the `from` parameter does not match the redirect target pathname.

**Solution:** Add the standard flash message block before `</body>`. Ensure the `from` value in `session/set` matches the pathname the user is redirected to.

### "yield renders nothing"

**Cause:** No `{% content_for 'name' %}` block matches the yield slot name, or the content_for block is in a partial that was not rendered.

**Solution:** Verify the slot name matches exactly between `{% yield 'name' %}` and `{% content_for 'name' %}`. Ensure the partial containing `content_for` is actually rendered during page execution.

### "Layout not found" error on deploy

**Cause:** A page references a layout name that does not exist as a file in `app/views/layouts/`.

**Solution:** Create the layout file or fix the `layout:` value in the page's front matter. Layout names map directly to filenames (e.g., `layout: admin` expects `app/views/layouts/admin.liquid`).

### "Duplicate content appearing"

**Cause:** `{{ content_for_layout }}` appears more than once in the layout, or multiple `{% content_for %}` blocks with the same name are appending content unintentionally.

**Solution:** Include `{{ content_for_layout }}` exactly once. If content_for blocks are duplicating, check that partials using `content_for` are not rendered multiple times.

### "CSRF token invalid on forms inside layout"

**Cause:** Forms in layout partials (e.g., search bar, logout button) are missing the CSRF token.

**Solution:** Include the authenticity token in every non-GET form, even those rendered from the layout:
```liquid
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

### "Metadata is blank in layout"

**Cause:** The page front matter does not include a `metadata:` section, or the key name is misspelled.

**Solution:** Add metadata to the page front matter and access it via `context.page.metadata.key_name`. Use the `default` filter for fallbacks: `{{ context.page.metadata.title | default: "My App" }}`.

## Limits

| Resource                          | Limit         | Notes                                      |
|-----------------------------------|---------------|--------------------------------------------|
| Layouts per application           | No hard limit | Keep it practical (3-5 covers most apps)   |
| Layout file size                  | 1 MB          | Keep layouts thin -- delegate to partials  |
| yield slots per layout            | No hard limit | Common: `head`, `footer_scripts`           |
| content_for blocks per page       | No hard limit | Each appends to the slot; no overwrite     |
| Nested render depth in layouts    | 3 levels      | Default `max_deep_level`                   |

## Troubleshooting Flowchart

```
Layout problem?
├── Page content not visible?
│   ├── Check {{ content_for_layout }} exists in layout
│   ├── Check page front matter layout value is correct
│   └── Check layout file exists in app/views/layouts/
├── Styling broken?
│   ├── Check <html class="pos-app"> is present
│   ├── Check common-styling/init is rendered in <head>
│   └── Check yield 'head' is in <head> for page CSS
├── Flash messages missing?
│   ├── Check flash handling block exists before </body>
│   ├── Check 'from' parameter matches redirect target
│   ├── Check session module is installed
│   └── Check toasts partial is rendering correctly
├── yield slot empty?
│   ├── Verify content_for name matches yield name exactly
│   ├── Check content_for is in a partial that gets rendered
│   └── Check for typos in slot name strings
└── Layout not applying?
    ├── Check layout: value in page front matter
    ├── Check layout file exists with .liquid extension
    └── Check for layout: "" which skips layout entirely
```

## See Also

- [Layouts Overview](README.md) -- introduction and key concepts
- [Layouts Configuration](configuration.md) -- file structure and settings
- [Layouts API](api.md) -- tags and objects reference
- [Layouts Advanced](advanced.md) -- edge cases and optimization
- [Pages Gotchas](../pages/gotchas.md) -- page-level troubleshooting
