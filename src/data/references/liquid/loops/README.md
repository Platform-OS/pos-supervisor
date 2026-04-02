# Liquid Loops

## for

### Arrays
```liquid
{% for item in array %}
  {{ item }}
{% endfor %}
```

### Hashes
```liquid
{% for item in hash %}
  {{ item[0] }}: {{ item[1] }}
{% endfor %}
```

### Ranges
```liquid
{% for i in (1..5) %}
  {{ i }}
{% endfor %}

{% for i in (1..item.quantity) %}
  {{ i }}
{% endfor %}
```

### Optional arguments

| Argument | Description |
|----------|-------------|
| `limit:N` | Take only N items |
| `offset:N` | Skip first N items |
| `reversed` | Reverse iteration order |

```liquid
{% for item in array limit:2 offset:2 %}
  {{ item }}
{% endfor %}

{% for item in collection reversed %}
  {{ item }}
{% endfor %}
```

### Empty collection (else)
```liquid
{% for item in items %}
  {{ item.title }}
{% else %}
  No items found.
{% endfor %}
```

### break / continue
```liquid
{% for page in pages %}
  {% if hidden_pages contains page.url %}
    {% continue %}
  {% endif %}
  {{ page.title }}
  {% if page.url == cutoff %}
    {% break %}
  {% endif %}
{% endfor %}
```

### forloop helper variables

| Variable | Description |
|----------|-------------|
| `forloop.index` | Current index (1-based) |
| `forloop.index0` | Current index (0-based) |
| `forloop.rindex` | Reverse index (1-based) |
| `forloop.rindex0` | Reverse index (0-based) |
| `forloop.first` | true on first iteration |
| `forloop.last` | true on last iteration |
| `forloop.length` | Total iterations |
| `forloop.parentloop` | Parent loop in nested loops |

## cycle

Loops through values in sequence.

```liquid
{% for i in (1..4) %}
  {% cycle 'odd', 'even' %}
{% endfor %}
→ odd even odd even
```

Named groups:
```liquid
{% cycle 'group1': 'a', 'b', 'c' %}
{% cycle 'group2': 'x', 'y', 'z' %}
{% cycle 'group1': 'a', 'b', 'c' %}
→ a x b
```

## tablerow

Generates HTML table rows.

```liquid
<table>
  {% tablerow product in products cols:3 %}
    {{ product.title }}
  {% endtablerow %}
</table>
```

Parameters: `cols`, `limit`, `offset`, range `(1..n)`.

## ifchanged

Only outputs if value changed since last iteration.

```liquid
{% assign list = "1,1,1,3,3,2,1" | split: "," %}
{% for item in list %}
  {% ifchanged %}{{ item }}{% endifchanged %}
{% endfor %}
→ 1 3 2 1
```
