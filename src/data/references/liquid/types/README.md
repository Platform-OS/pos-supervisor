# Liquid Types

Liquid in platformOS supports six core data types: String, Number, Boolean, Nil, Hash (Object), and Array. Understanding these types -- and especially their truthiness rules -- is essential for writing correct conditionals and data handling logic.

## Key Purpose

Every value in Liquid has a type that determines how it behaves in output, comparisons, and iteration. platformOS extends standard Liquid with Hash and Array initialization via `assign` with hash/array literals (or the `parse_json` filter), and adds operators like `array_any` for richer data manipulation. Note: the `{% parse_json %}` tag and `{% hash_assign %}` tag are deprecated -- use `{% assign %}` instead.

## When to Use

- **String** -- text content, template fragments, user input, identifiers
- **Number** -- counters, pagination, arithmetic, record IDs
- **Boolean** -- feature flags, conditional rendering, form state
- **Nil** -- absence of value, unset variables, failed lookups
- **Hash** -- structured data from GraphQL results, configuration objects, JSON payloads
- **Array** -- collections for iteration, multi-value form fields, split strings

## How It Works

### String

Declared with single or double quotes. Both are identical in behavior.

```liquid
{% assign greeting = "Hello World!" %}
{% assign name = 'platformOS' %}
```

Strings support concatenation via `append` / `prepend` filters and interpolation inside `{{ }}` output tags.

### Number

Integers and floats. No quotes.

```liquid
{% assign count = 25 %}
{% assign price = 39.99 %}
{% assign negative = -7 %}
```

Arithmetic is done via filters: `plus`, `minus`, `times`, `divided_by`, `modulo`, `floor`, `ceil`, `round`.

### Boolean

Literal `true` or `false` without quotes.

```liquid
{% assign is_active = true %}
{% assign show_price = false %}
```

### Nil

The absence of a value. Returned when a variable is not set, a key does not exist, or a query returns no results. Nil outputs nothing and evaluates as falsy.

```liquid
{% if user %}
  Hello {{ user.name }}
{% endif %}
```

### Hash (Object)

Key-value dictionaries. Initialize with `assign` using hash literals, or with the `parse_json` filter.

```liquid
{% assign user = { "name": "Alice", "role": "admin", "score": 42 } %}

{% assign config = '{"theme": "dark", "lang": "en"}' | parse_json %}
```

Access values with dot notation or bracket notation:

```liquid
{{ user.name }}
{% assign key = "role" %}
{{ user[key] }}
```

### Array

Ordered collections. Initialize via `split`, array literals, or the `parse_json` filter.

```liquid
{% assign tags = "ruby,python,go" | split: "," %}
{% assign ids = [1, 2, 3, 4, 5] %}
{{ ids[0] }}
```

### Truthiness Rules

This is the single most important concept. Only **nil** and **false** are falsy. Everything else is truthy.

| Value | Truthy? |
|-------|---------|
| `"hello"` | Yes |
| `""` (empty string) | **Yes** |
| `0` | **Yes** |
| `true` | Yes |
| `false` | No |
| `nil` / `null` | No |
| Empty array `[]` | Yes |
| Empty hash `{}` | Yes |

Use `!= blank` to check for meaningful content:

```liquid
{% if value != blank %}
  has content
{% endif %}
```

## Getting Started

1. Use `assign` for simple values: `{% assign name = "Alice" %}`
2. Use `assign` with hash/array literals for structured data: `{% assign config = { "key": "value" } %}`
3. Always remember: empty strings are truthy -- use `!= blank` to test for empty
4. Use variable references directly in hash literals: `{% assign obj = { "name": name } %}`
5. Access hash values with dot or bracket notation

## See Also

- [Variables](../variables/README.md) -- how to create and manage variables
- [Flow Control](../flow-control/README.md) -- conditionals that depend on truthiness
- [Liquid Filters](../filters/README.md) -- type conversion and manipulation filters
- [Liquid Objects](../objects/README.md) -- built-in objects like `context`
