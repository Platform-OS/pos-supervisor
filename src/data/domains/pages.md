[platformOS:pages] Pages are controllers — put logic here, not in partials.
MUST: only graphql/render/function/redirect_to tags inside pages (no inline HTML except structural wrappers).
Set page title with: {% content_for 'title' %}My Title{% endcontent_for %}
→ domain_guide({ domain: "pages", section: "patterns" }) and domain_guide({ domain: "pages", section: "gotchas" })