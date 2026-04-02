# Liquid Types -- Configuration Reference

This document covers the syntax, initialization, and available options for every Liquid type in platformOS.

## String Configuration

### Declaration syntax

```liquid
{% assign single = 'single quotes' %}
{% assign double = "double quotes" %}
```

Single and double quotes are interchangeable. No escaping differences between them.

### String interpolation

Strings do not support inline interpolation. Use `capture` or filter chaining instead:

```liquid
{% capture greeting %}Hello {{ user.name }}, welcome to {{ site_name }}{% endcapture %}

{% assign slug = title | downcase | replace: " ", "-" %}
```

### Common string filters

| Filter | Purpose | Example |
|--------|---------|---------|
| `downcase` | Lowercase | `{{ "HI" \| downcase }}` -> `hi` |
| `upcase` | Uppercase | `{{ "hi" \| upcase }}` -> `HI` |
| `strip` | Trim whitespace | `{{ " hi " \| strip }}` -> `hi` |
| `replace` | Replace substring | `{{ "hi" \| replace: "hi", "bye" }}` |
| `append` | Add to end | `{{ "hi" \| append: "!" }}` -> `hi!` |
| `prepend` | Add to start | `{{ "!" \| prepend: "hi" }}` -> `hi!` |
| `split` | String to array | `{{ "a,b,c" \| split: "," }}` |
| `size` | Character count | `{{ "hello" \| size }}` -> `5` |
| `truncate` | Limit length | `{{ text \| truncate: 50 }}` |
| `url_encode` | URL-safe encoding | `{{ query \| url_encode }}` |
| `json` | JSON-safe string | `{{ name \| json }}` |
| `sha256` | SHA256 hash | `{{ secret \| sha256 }}` |

## Number Configuration

### Integer declaration

```liquid
{% assign count = 42 %}
{% assign negative = -7 %}
{% assign zero = 0 %}
```

### Float declaration

```liquid
{% assign price = 19.99 %}
{% assign rate = 0.075 %}
```

### Arithmetic filters

| Filter | Purpose | Example |
|--------|---------|---------|
| `plus` | Addition | `{{ 4 \| plus: 2 }}` -> `6` |
| `minus` | Subtraction | `{{ 4 \| minus: 2 }}` -> `2` |
| `times` | Multiplication | `{{ 4 \| times: 2 }}` -> `8` |
| `divided_by` | Division | `{{ 10 \| divided_by: 3 }}` -> `3` |
| `modulo` | Remainder | `{{ 10 \| modulo: 3 }}` -> `1` |
| `floor` | Round down | `{{ 4.7 \| floor }}` -> `4` |
| `ceil` | Round up | `{{ 4.1 \| ceil }}` -> `5` |
| `round` | Round nearest | `{{ 4.5 \| round }}` -> `5` |
| `abs` | Absolute value | `{{ -5 \| abs }}` -> `5` |

**Note:** Integer division returns an integer. Use `| times: 1.0` to force float division:

```liquid
{{ 10 | divided_by: 3 }}              -> 3
{{ 10 | times: 1.0 | divided_by: 3 }} -> 3.333...
```

### Type conversion

```liquid
{% assign num = "42" | plus: 0 %}
{% assign str = 42 | append: "" %}
```

## Boolean Configuration

### Declaration

```liquid
{% assign enabled = true %}
{% assign disabled = false %}
```

No quotes. `"true"` is a string, not a boolean.

### Checking boolean values

```liquid
{% if enabled %}yes{% endif %}
{% if enabled == true %}explicit check{% endif %}
{% unless disabled %}not disabled{% endunless %}
```

## Nil Configuration

Nil cannot be explicitly assigned. It results from:

- Accessing an undefined variable
- Accessing a missing hash key
- A GraphQL query returning no results
- A `function` call to a partial that does not `{% return %}` a value

```liquid
{% comment %} All of these produce nil {% endcomment %}
{{ undefined_var }}
{{ user.nonexistent_key }}
```

### Nil vs blank vs empty

| Check | Nil | Empty string `""` | Empty array `[]` | `false` |
|-------|-----|-------------------|-------------------|---------|
| `== nil` | true | false | false | false |
| `== blank` | true | true | true | false |
| `== empty` | false | true | true | false |
| Falsy? | Yes | No | No | Yes |

## Hash Configuration

### Initialization via hash literal

```liquid
{% assign config = { "key": "value" } %}
```

### Hash literal with variables

```liquid
{% assign user = { "name": name, "email": email, "age": age, "active": true } %}
```

### Initialization via parse_json filter

```liquid
{% assign config = '{"key": "value"}' | parse_json %}
```

### Modifying hashes

```liquid
{% assign user["role"] = "admin" %}
{% assign user["address"]["city"] = "New York" %}
{% assign merged = defaults | hash_merge: overrides %}
```

### Hash filters

| Filter | Purpose | Example |
|--------|---------|---------|
| `hash_merge` | Merge two hashes | `{{ a \| hash_merge: b }}` |
| `keys` | Get all keys | `{{ hash \| keys }}` |
| `json` | Serialize to JSON | `{{ hash \| json }}` |
| `size` | Key count | `{{ hash \| size }}` |

## Array Configuration

### Initialization via split

```liquid
{% assign colors = "red,green,blue" | split: "," %}
```

### Initialization via array literal

```liquid
{% assign ids = [1, 2, 3, 4, 5] %}
```

### Array access

```liquid
{{ arr[0] }}           {% comment %} First element (0-indexed) {% endcomment %}
{{ arr[-1] }}          {% comment %} Last element {% endcomment %}
{{ arr.first }}        {% comment %} First element {% endcomment %}
{{ arr.last }}         {% comment %} Last element {% endcomment %}
{{ arr.size }}         {% comment %} Length {% endcomment %}
```

### Array filters

| Filter | Purpose | Example |
|--------|---------|---------|
| `push` | Add to end | `{{ arr \| push: "d" }}` |
| `unshift` | Add to start | `{{ arr \| unshift: "z" }}` |
| `pop` | Remove from end | `{{ arr \| pop }}` |
| `shift` | Remove from start | `{{ arr \| shift }}` |
| `concat` | Merge arrays | `{{ arr1 \| concat: arr2 }}` |
| `uniq` | Remove duplicates | `{{ arr \| uniq }}` |
| `compact` | Remove nils | `{{ arr \| compact }}` |
| `sort` | Sort ascending | `{{ arr \| sort }}` |
| `sort_natural` | Case-insensitive sort | `{{ arr \| sort_natural }}` |
| `reverse` | Reverse order | `{{ arr \| reverse }}` |
| `map` | Extract property | `{{ users \| map: "name" }}` |
| `where` | Filter by property | `{{ users \| where: "active", true }}` |
| `join` | Array to string | `{{ arr \| join: ", " }}` |
| `size` | Element count | `{{ arr \| size }}` |
| `contains` | Check membership | String comparison only |
| `array_any` | Broader check | Works with more types |

### Membership testing

```liquid
{% comment %} contains works with string comparison only {% endcomment %}
{% if arr contains "red" %}found{% endif %}

{% comment %} array_any provides broader type matching {% endcomment %}
{{ arr | array_any: target_value }}
```

## See Also

- [Types Overview](README.md) -- introduction and truthiness rules
- [Types API](api.md) -- complete reference of type-related constructs
- [Variables Configuration](../variables/configuration.md) -- variable declaration options
- [Liquid Filters](../filters/README.md) -- all available filters
