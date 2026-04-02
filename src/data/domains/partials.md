[platformOS:partials] Partials receive ONLY explicitly passed variables — no outer scope leaks.
MUST NOT run {% graphql %} in a partial; fetch data in the page and pass it down via render parameters.
Document the public contract: {% comment %}@prompt: what this partial renders{% endcomment %}
→ domain_guide({ domain: "partials", section: "api" }) and domain_guide({ domain: "partials", section: "patterns" })