[platformOS:translations] Translation files are YAML in app/translations/.
Access via {{ 'key' | t }} or with variables: {{ 'key' | t: name: user.name }}.
Nested keys use dot notation: {{ 'scope.key' | t }}. Pluralization: define one:/other: sub-keys.
→ domain_guide({ domain: "translations", section: "gotchas" }) and domain_guide({ domain: "translations", section: "patterns" })