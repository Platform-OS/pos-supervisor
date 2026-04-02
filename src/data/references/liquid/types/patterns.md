# Liquid Types -- Patterns and Best Practices

Common workflows and real-world examples for working with Liquid types in platformOS.

## Pattern: Safe Value Checking

The most common source of bugs is incorrect truthiness checks. Empty strings are truthy.

### Wrong: truthy check for string presence

```liquid
{% comment %} BUG: empty string "" passes this check {% endcomment %}
{% if user.name %}
  Hello {{ user.name }}
{% endif %}
```

### Correct: blank check for string presence

```liquid
{% if user.name != blank %}
  Hello {{ user.name }}
{% endif %}
```

### Correct: nil check when you only care about existence

```liquid
{% if user.name != nil %}
  Name field exists (might be empty)
{% endif %}
```

## Pattern: Building Hashes Dynamically

### Accumulating key-value pairs

```liquid
{% assign params = {} %}
{% assign params["page"] = current_page %}
{% assign params["per_page"] = 20 %}

{% if search_term != blank %}
  {% assign params["query"] = search_term %}
{% endif %}

{% if category_id != blank %}
  {% assign params["category"] = category_id %}
{% endif %}

{% graphql results = 'products/search', args: params %}
```

### Merging configuration defaults

```liquid
{% assign defaults = { "per_page": 20, "sort": "created_at", "order": "desc" } %}

{% assign user_prefs = {
  "per_page": context.params.per_page | default: 20,
  "sort": context.params.sort | default: "created_at"
} %}

{% assign config = defaults | hash_merge: user_prefs %}
```

## Pattern: Building Arrays Dynamically

### Collecting items conditionally

```liquid
{% assign errors = [] %}

{% if title == blank %}
  {% assign errors = errors | push: "Title is required" %}
{% endif %}

{% if price == blank %}
  {% assign errors = errors | push: "Price is required" %}
{% endif %}

{% if errors.size > 0 %}
  {% assign valid = false %}
{% else %}
  {% assign valid = true %}
{% endif %}
```

### Building a filtered list

```liquid
{% assign visible_items = [] %}

{% for item in all_items %}
  {% if item.published == true %}
    {% if item.visible != false %}
      {% assign visible_items = visible_items | push: item %}
    {% endif %}
  {% endif %}
{% endfor %}
```

## Pattern: Safe Hash Construction

Use hash literals with `assign` to build hashes. Variable references are used directly -- no quoting or `| json` filter needed.

**Note:** The `{% parse_json %}...{% endparse_json %}` tag is deprecated. Use `{% assign %}` with hash/array literals instead.

### Direct variable references in hash literals

```liquid
{% assign user = { "name": name, "bio": bio } %}
```

### Numbers and booleans work directly

```liquid
{% assign product = {
  "title": title,
  "price": price | default: 0,
  "active": active | default: false
} %}
```

## Pattern: Type Coercion for Comparisons

URL parameters from `context.params` are always strings. Convert before comparing.

### Comparing numeric URL params

```liquid
{% assign page_num = context.params.page | plus: 0 %}
{% if page_num > 1 %}
  {% render 'shared/prev_link', page: page_num %}
{% endif %}
```

### Comparing boolean-like URL params

```liquid
{% comment %} context.params.active is the string "true", not boolean true {% endcomment %}
{% if context.params.active == "true" %}
  {% assign show_active = true %}
{% else %}
  {% assign show_active = false %}
{% endif %}
```

## Pattern: Null-safe Property Access

Chain defaults to avoid nil errors in nested access.

```liquid
{% assign city = user.address.city | default: "Unknown" %}
{% assign role = context.current_user.role | default: "guest" %}
```

### Deeply nested safe access

```liquid
{% if user.settings != nil %}
  {% if user.settings.notifications != nil %}
    {% assign notify = user.settings.notifications.email %}
  {% endif %}
{% endif %}
{% assign notify = notify | default: true %}
```

## Pattern: Working with GraphQL Results

GraphQL results are hashes. Access nested data carefully.

```liquid
{% graphql result = 'products/search', page: 1 %}

{% assign products = result.records.results %}
{% assign total = result.records.total_entries %}
{% assign has_more = result.records.has_next_page %}

{% for product in products %}
  {% render 'products/card', product: product %}
{% endfor %}

{% if total == 0 %}
  {% render 'shared/empty_state', message: "No products found" %}
{% endif %}
```

## Pattern: Array Membership Testing

### String arrays: use contains

```liquid
{% assign roles = "admin,editor,viewer" | split: "," %}
{% if roles contains "admin" %}
  Admin access granted
{% endif %}
```

### Non-string values: use array_any

```liquid
{% assign allowed_ids = [1, 5, 10, 25] %}
{% assign current_id = context.params.id | plus: 0 %}

{% assign is_allowed = allowed_ids | array_any: current_id %}
{% if is_allowed %}
  Access granted
{% endif %}
```

## Pattern: Hash Iteration for Dynamic UI

### Rendering key-value pairs

```liquid
{% assign meta = { "Author": "Jane Doe", "Published": "2024-01-15", "Category": "Tech" } %}

<dl>
{% for pair in meta %}
  <dt>{{ pair[0] }}</dt>
  <dd>{{ pair[1] }}</dd>
{% endfor %}
</dl>
```

## Pattern: Default Values Chain

```liquid
{% assign title = product.seo_title | default: product.title | default: "Untitled" %}
{% assign image = product.hero_image | default: product.thumbnail | default: "/assets/placeholder.png" %}
{% assign per_page = context.params.per_page | plus: 0 | at_least: 1 | at_most: 100 | default: 20 %}
```

## Pattern: Comparing Arrays and Hashes for Emptiness

```liquid
{% comment %} Array emptiness {% endcomment %}
{% if items == empty %}no items{% endif %}
{% if items.size == 0 %}also no items{% endif %}
{% if items == blank %}nil or empty{% endif %}

{% comment %} Hash emptiness {% endcomment %}
{% if config == empty %}no keys{% endif %}
{% if config.size == 0 %}also no keys{% endif %}
```

## See Also

- [Types Overview](README.md) -- introduction and truthiness rules
- [Types Gotchas](gotchas.md) -- common errors with types
- [Variables Patterns](../variables/patterns.md) -- variable sharing patterns
- [Flow Control Patterns](../flow-control/patterns.md) -- conditional patterns
