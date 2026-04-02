# Liquid Types -- Advanced Topics

Deep dives into type behavior edge cases, coercion rules, and advanced data manipulation in platformOS Liquid.

## Type Coercion Rules

Liquid performs implicit coercion in several contexts. Understanding when and how this happens prevents subtle bugs.

### Comparison coercion

When comparing values of different types, Liquid follows these rules:

```liquid
{% comment %} String vs Number: string is converted to number if possible {% endcomment %}
{% if "42" == 42 %}true{% endif %}       {% comment %} -> true {% endcomment %}
{% if "abc" == 0 %}true{% endif %}       {% comment %} -> false {% endcomment %}

{% comment %} Nil comparisons {% endcomment %}
{% if nil == nil %}true{% endif %}        {% comment %} -> true {% endcomment %}
{% if nil == false %}true{% endif %}      {% comment %} -> false (different types) {% endcomment %}
{% if nil == "" %}true{% endif %}         {% comment %} -> false {% endcomment %}
```

### Output coercion

All values are converted to strings when output via `{{ }}`:

```liquid
{{ 42 }}          {% comment %} -> "42" {% endcomment %}
{{ true }}        {% comment %} -> "true" {% endcomment %}
{{ nil }}         {% comment %} -> "" (empty, nothing rendered) {% endcomment %}
{{ false }}       {% comment %} -> "false" {% endcomment %}
```

### Filter chain coercion

Filters that expect specific types will coerce input:

```liquid
{{ "hello" | plus: 0 }}      {% comment %} -> 0 (string coerced to 0) {% endcomment %}
{{ "5abc" | plus: 0 }}       {% comment %} -> 5 (partial numeric parse) {% endcomment %}
{{ true | append: "" }}      {% comment %} -> "true" {% endcomment %}
```

## Deep Hash Manipulation

### Nested hash creation from scratch

```liquid
{% assign settings = {} %}
{% assign settings["ui"] = nil %}
{% assign ui_defaults = { "theme": "light", "sidebar": true } %}
{% assign settings["ui"] = ui_defaults %}
{% assign settings["ui"]["theme"] = "dark" %}

{{ settings | json }}
{% comment %} -> {"ui":{"theme":"dark","sidebar":true}} {% endcomment %}
```

### Recursive hash merge behavior

`hash_merge` performs a shallow merge. Nested hashes are replaced, not merged:

```liquid
{% assign base = { "a": 1, "nested": { "x": 1, "y": 2 } } %}
{% assign override = { "nested": { "x": 99 } } %}

{% assign result = base | hash_merge: override %}
{{ result | json }}
{% comment %} -> {"a":1,"nested":{"x":99}} -- note "y" is LOST {% endcomment %}
```

To do a deep merge, merge nested hashes separately:

```liquid
{% assign nested_merged = base.nested | hash_merge: override.nested %}
{% assign base["nested"] = nested_merged %}
{% assign result = base | hash_merge: override_without_nested %}
```

### Converting hash to array of pairs

```liquid
{% assign meta = { "author": "Jane", "year": 2024 } %}
{% assign pairs = [] %}

{% for item in meta %}
  {% assign pair = { "key": item[0], "value": item[1] } %}
  {% assign pairs = pairs | push: pair %}
{% endfor %}
```

## Advanced Array Operations

### Array deduplication by property

```liquid
{% assign seen_ids = [] %}
{% assign unique_items = [] %}

{% for item in items %}
  {% assign id_str = item.id | append: "" %}
  {% unless seen_ids contains id_str %}
    {% assign unique_items = unique_items | push: item %}
    {% assign seen_ids = seen_ids | push: id_str %}
  {% endunless %}
{% endfor %}
```

### Array intersection (items in both arrays)

```liquid
{% assign intersection = [] %}

{% for item in array_a %}
  {% assign item_str = item | append: "" %}
  {% if array_b contains item_str %}
    {% assign intersection = intersection | push: item %}
  {% endif %}
{% endfor %}
```

### Array difference (items in A but not B)

```liquid
{% assign difference = [] %}

{% for item in array_a %}
  {% assign item_str = item | append: "" %}
  {% unless array_b contains item_str %}
    {% assign difference = difference | push: item %}
  {% endunless %}
{% endfor %}
```

### Grouping array items by property

```liquid
{% assign groups = {} %}

{% for item in items %}
  {% assign group_key = item.category %}
  {% if groups[group_key] == nil %}
    {% assign empty_arr = [] %}
    {% assign groups[group_key] = empty_arr %}
  {% endif %}
  {% assign updated = groups[group_key] | push: item %}
  {% assign groups[group_key] = updated %}
{% endfor %}
```

## Nil Propagation

Understanding how nil propagates through filter chains prevents unexpected output.

```liquid
{% comment %} Nil through filters {% endcomment %}
{{ nil | upcase }}              {% comment %} -> "" (empty) {% endcomment %}
{{ nil | plus: 5 }}             {% comment %} -> 5 {% endcomment %}
{{ nil | default: "fallback" }} {% comment %} -> "fallback" {% endcomment %}
{{ nil | json }}                {% comment %} -> "null" {% endcomment %}
{{ nil | size }}                {% comment %} -> 0 {% endcomment %}
```

### Default filter edge cases

The `default` filter triggers on nil, false, and empty string:

```liquid
{{ nil | default: "x" }}       {% comment %} -> "x" {% endcomment %}
{{ false | default: "x" }}     {% comment %} -> "x" {% endcomment %}
{{ "" | default: "x" }}        {% comment %} -> "x" {% endcomment %}
{{ 0 | default: "x" }}         {% comment %} -> 0 (0 is NOT nil/false/"") {% endcomment %}
{{ "hi" | default: "x" }}     {% comment %} -> "hi" {% endcomment %}
```

**Note:** `default` treats empty string as "default-worthy" but `if` treats it as truthy. These are inconsistent by design.

## Complex Hash/Array Literal Patterns

### Multi-level nested structure with variables

For structures with dynamic loops, build the result incrementally:

```liquid
{% assign items_arr = [] %}
{% for item in cart_items %}
  {% assign entry = { "id": item.id, "qty": item.quantity, "title": item.title } %}
  {% assign items_arr = items_arr | push: entry %}
{% endfor %}

{% assign payload = {
  "user": { "name": user_name, "email": user_email },
  "items": items_arr,
  "metadata": { "timestamp": "now" | date: "%s", "source": "web" }
} %}
```

### Conditional hash structure

Build the hash incrementally when keys are conditional:

```liquid
{% assign data = { "type": type } %}
{% if description != blank %}
  {% assign data["description"] = description %}
{% endif %}
{% if tags.size > 0 %}
  {% assign data["tags"] = tags %}
{% endif %}
```

## Reference Equality

Liquid does not have reference equality. All comparisons are by value:

```liquid
{% assign a = { "x": 1 } %}
{% assign b = { "x": 1 } %}
{% if a == b %}equal{% endif %}
{% comment %} -> "equal" (compared by value) {% endcomment %}
```

Assigning a hash/array creates a reference, not a copy:

```liquid
{% assign original = { "x": 1 } %}
{% assign copy = original %}
{% assign copy["x"] = 99 %}
{{ original.x }}
{% comment %} -> 99 (both point to same object) {% endcomment %}
```

To create a true copy, round-trip through JSON:

```liquid
{% assign deep_copy = original | json | parse_json %}
```

## See Also

- [Types Overview](README.md) -- introduction and truthiness rules
- [Types Gotchas](gotchas.md) -- common errors to avoid
- [Variables Advanced](../variables/advanced.md) -- advanced variable patterns
- [Liquid Filters](../filters/README.md) -- complete filter reference
