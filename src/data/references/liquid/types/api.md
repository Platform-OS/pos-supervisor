# Liquid Types -- API Reference

This document is a complete reference of all type-related constructs, operators, and filters in platformOS Liquid.

## Type Declaration Syntax

### assign

Creates a variable of any type.

```liquid
{% assign my_string = "hello" %}
{% assign my_number = 42 %}
{% assign my_float = 3.14 %}
{% assign my_bool = true %}
```

### parse_json (filter)

Converts a JSON string to a Hash or Array.

```liquid
{% assign hash = '{"key": "value"}' | parse_json %}
{% assign arr = '[1, 2, 3]' | parse_json %}
```

### assign with hash/array literals

Create hashes and arrays directly. Variable references are used without quoting.

```liquid
{% assign variable_name = { "key": value } %}
{% assign items = [1, 2, 3] %}
```

### parse_json (tag) -- DEPRECATED

The `{% parse_json %}...{% endparse_json %}` block tag is deprecated. Use `{% assign %}` with hash/array literals instead (shown above).

### capture

Captures block output as a String.

```liquid
{% capture html %}
  <div>{{ content }}</div>
{% endcapture %}
```

## Type Checking

Liquid has no `typeof` operator. Use comparison patterns instead.

### Check for nil

```liquid
{% if value == nil %}nil{% endif %}
{% if value == null %}also nil{% endif %}
{% if value %}not nil and not false{% endif %}
```

### Check for blank (nil, empty string, empty array)

```liquid
{% if value == blank %}blank{% endif %}
{% if value != blank %}has content{% endif %}
```

### Check for empty (empty string, empty array/hash)

```liquid
{% if value == empty %}empty collection or string{% endif %}
```

### Check for boolean

```liquid
{% if value == true %}true{% endif %}
{% if value == false %}false{% endif %}
```

### Check for numeric

No direct type check. Compare after arithmetic:

```liquid
{% assign test = value | plus: 0 %}
{% if test == value %}likely numeric{% endif %}
```

## String API

### Output

```liquid
{{ variable }}                         {% comment %} Raw output {% endcomment %}
{{ variable | escape }}                {% comment %} HTML-escaped {% endcomment %}
{{ variable | url_encode }}            {% comment %} URL-encoded {% endcomment %}
{{ variable | json }}                  {% comment %} JSON-encoded (adds quotes) {% endcomment %}
{{ variable | base64_encode }}         {% comment %} Base64-encoded {% endcomment %}
```

### Manipulation filters

```liquid
{{ str | downcase }}
{{ str | upcase }}
{{ str | capitalize }}
{{ str | strip }}
{{ str | lstrip }}
{{ str | rstrip }}
{{ str | strip_html }}
{{ str | strip_newlines }}
{{ str | newline_to_br }}
{{ str | replace: "old", "new" }}
{{ str | replace_first: "old", "new" }}
{{ str | remove: "substring" }}
{{ str | remove_first: "substring" }}
{{ str | append: " suffix" }}
{{ str | prepend: "prefix " }}
{{ str | truncate: 50, "..." }}
{{ str | truncatewords: 10, "..." }}
{{ str | slice: 0, 5 }}
{{ str | split: "," }}
{{ str | md5 }}
{{ str | sha256 }}
{{ str | hmac_sha256: "secret" }}
```

### String properties

```liquid
{{ str | size }}                        {% comment %} Character count {% endcomment %}
{{ str.size }}                          {% comment %} Same thing {% endcomment %}
```

## Number API

### Arithmetic filters

```liquid
{{ num | plus: 5 }}
{{ num | minus: 3 }}
{{ num | times: 2 }}
{{ num | divided_by: 4 }}
{{ num | modulo: 3 }}
{{ num | abs }}
{{ num | at_least: 0 }}
{{ num | at_most: 100 }}
```

### Rounding filters

```liquid
{{ float | floor }}
{{ float | ceil }}
{{ float | round }}
{{ float | round: 2 }}                 {% comment %} 2 decimal places {% endcomment %}
```

### Type coercion

```liquid
{% comment %} String to number {% endcomment %}
{{ "42" | plus: 0 }}                   {% comment %} -> 42 {% endcomment %}

{% comment %} Number to string {% endcomment %}
{{ 42 | append: "" }}                  {% comment %} -> "42" {% endcomment %}
```

## Boolean API

### Comparison operators

All operators require spaces on both sides.

```liquid
{% if a == b %}equal{% endif %}
{% if a != b %}not equal{% endif %}
{% if a <> b %}not equal (alternate){% endif %}
{% if a > b %}greater{% endif %}
{% if a >= b %}greater or equal{% endif %}
{% if a < b %}less{% endif %}
{% if a <= b %}less or equal{% endif %}
{% if arr contains "x" %}contains{% endif %}
```

### Boolean operators

```liquid
{% if a and b %}both true{% endif %}
{% if a or b %}either true{% endif %}
```

`and` evaluates before `or`. No parentheses. No `not` operator. No `&&` or `||`.

### Negation patterns

```liquid
{% unless condition %}negated if{% endunless %}
{% if condition == false %}explicit false check{% endif %}
{% if condition != true %}not true{% endif %}
```

## Hash API

### Access

```liquid
{{ hash.key }}                         {% comment %} Dot notation {% endcomment %}
{{ hash["key"] }}                      {% comment %} Bracket notation {% endcomment %}
{{ hash[variable] }}                   {% comment %} Dynamic key {% endcomment %}
```

### Modification

```liquid
{% assign hash["key"] = "value" %}
{% assign hash["nested"]["key"] = "value" %}
{% assign merged = hash1 | hash_merge: hash2 %}
```

### Hash filters

```liquid
{{ hash | json }}                      {% comment %} Serialize {% endcomment %}
{{ hash | keys }}                      {% comment %} Array of keys {% endcomment %}
{{ hash | size }}                      {% comment %} Number of keys {% endcomment %}
```

### Iterating hashes

```liquid
{% for pair in hash %}
  {{ pair[0] }}: {{ pair[1] }}
{% endfor %}
```

## Array API

### Access

```liquid
{{ arr[0] }}                           {% comment %} First (0-indexed) {% endcomment %}
{{ arr[-1] }}                          {% comment %} Last {% endcomment %}
{{ arr.first }}                        {% comment %} First {% endcomment %}
{{ arr.last }}                         {% comment %} Last {% endcomment %}
{{ arr.size }}                         {% comment %} Length {% endcomment %}
```

### Add / remove filters

```liquid
{{ arr | push: item }}
{{ arr | unshift: item }}
{{ arr | pop }}
{{ arr | shift }}
{{ arr | concat: other_arr }}
{{ arr | array_add: item }}
```

### Transform filters

```liquid
{{ arr | sort }}
{{ arr | sort: "property" }}
{{ arr | sort_natural }}
{{ arr | reverse }}
{{ arr | uniq }}
{{ arr | compact }}
{{ arr | flatten }}
{{ arr | map: "property" }}
{{ arr | where: "property", "value" }}
```

### Search filters

```liquid
{% if arr contains "value" %}          {% comment %} String match only {% endcomment %}
{{ arr | array_any: value }}           {% comment %} Broader type matching {% endcomment %}
```

### Conversion

```liquid
{{ arr | join: ", " }}                 {% comment %} Array to string {% endcomment %}
{{ arr | json }}                       {% comment %} Array to JSON {% endcomment %}
{{ str | split: "," }}                 {% comment %} String to array {% endcomment %}
```

## Truthiness Reference

### Complete table

| Expression | Result |
|------------|--------|
| `{% if "hello" %}` | truthy |
| `{% if "" %}` | **truthy** |
| `{% if 0 %}` | **truthy** |
| `{% if 1 %}` | truthy |
| `{% if true %}` | truthy |
| `{% if false %}` | falsy |
| `{% if nil %}` | falsy |
| `{% if null %}` | falsy |
| `{% if empty_array %}` | truthy (use `== empty` to test) |
| `{% if empty_hash %}` | truthy (use `== empty` to test) |

### Blank vs empty vs nil

| Value | `== nil` | `== blank` | `== empty` | Falsy? |
|-------|----------|------------|------------|--------|
| `nil` | true | true | false | Yes |
| `false` | false | false | false | Yes |
| `""` | false | true | true | No |
| `"hi"` | false | false | false | No |
| `[]` | false | true | true | No |
| `[1]` | false | false | false | No |
| `{}` | false | true | true | No |
| `0` | false | false | false | No |

## See Also

- [Types Overview](README.md) -- introduction and getting started
- [Types Configuration](configuration.md) -- initialization syntax and options
- [Flow Control](../flow-control/README.md) -- conditionals using type comparisons
- [Liquid Filters](../filters/README.md) -- complete filter reference
