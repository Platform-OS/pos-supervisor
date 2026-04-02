[platformOS:layouts] Access page-level metadata with {{ context.page.metadata.title }} (set in page front matter under metadata:).
Inject page-specific content into layout slots with {% yield 'slot_name' %} (layout) and {% content_for 'slot_name' %}...{% endcontent_for %} (page).
The default slot is {% yield %} — renders the page body automatically.
→ domain_guide({ domain: "layouts", section: "patterns" }) and domain_guide({ domain: "layouts", section: "gotchas" })