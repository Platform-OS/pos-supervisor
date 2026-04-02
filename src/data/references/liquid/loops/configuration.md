# Liquid Loops: Configuration

Configuration and setup for looping constructs in platformOS Liquid templates.

## Overview

platformOS Liquid provides powerful iteration constructs for arrays, hashes, ranges, and special looping scenarios. Each loop provides context objects for tracking position and managing flow.

## Looping Constructs

### for Loop
Iterates over arrays, hashes, ranges:
```liquid
{%- for item in items -%}
  {{ item }}
{%- endfor -%}
```

Most common looping mechanism.

### cycle Tag
Alternates between values:
```liquid
{%- for item in items -%}
  <tr class="{% cycle 'odd', 'even' %}">
{%- endfor -%}
```

Useful for striping rows/columns.

### tablerow Tag
Creates HTML table rows:
```liquid
{%- tablerow product in products cols:4 -%}
  {{ product.name }}
{%- endtablerow -%}
```

Generates `<tr>` and `<td>` automatically.

### ifchanged Tag
Detects when value changes:
```liquid
{%- for item in items -%}
  {%- ifchanged item.category -%}
    <h2>{{ item.category }}</h2>
  {%- endifchanged -%}
{%- endfor -%}
```

Renders only when value differs from previous.

## Loop Arguments

### for Loop Arguments

#### limit
```liquid
{%- for item in items limit:10 -%}
  {{ item }}
{%- endfor -%}
```

Maximum iterations to perform.

#### offset
```liquid
{%- for item in items offset:20 -%}
  {{ item }}
{%- endfor -%}
```

Skip first N items before looping.

#### reversed
```liquid
{%- for item in items reversed -%}
  {{ item }}
{%- endfor -%}
```

Iterate in reverse order.

#### Combining Arguments
```liquid
{%- for item in items limit:10 offset:20 reversed -%}
  {{ item }}
{%- endfor -%}
```

All arguments can be combined.

## Loop Context Objects

### forloop Object
Available inside for loops:
- `forloop.first` - Boolean, first iteration
- `forloop.last` - Boolean, last iteration
- `forloop.index` - Current position (1-based)
- `forloop.index0` - Current position (0-based)
- `forloop.rindex` - Remaining iterations (1-based)
- `forloop.rindex0` - Remaining iterations (0-based)
- `forloop.length` - Total iterations
- `forloop.parentloop` - Parent loop object (nested)

### tablerowloop Object
Extends forloop, adds:
- `tablerowloop.col` - Column number (1-based)
- `tablerowloop.col0` - Column number (0-based)
- `tablerowloop.col_first` - First column in row
- `tablerowloop.col_last` - Last column in row

## Loop Control

### break Statement
```liquid
{%- for item in items -%}
  {%- if item.id == target_id -%}
    {%- break -%}
  {%- endif -%}
  {{ item.name }}
{%- endfor -%}
```

Exit loop immediately.

### continue Statement
```liquid
{%- for item in items -%}
  {%- if item.inactive -%}
    {%- continue -%}
  {%- endif -%}
  {{ item.name }}
{%- endfor -%}
```

Skip to next iteration.

### else Clause
```liquid
{%- for item in items -%}
  {{ item }}
{%- else -%}
  No items available
{%- endfor -%}
```

Renders if collection is empty.

## cycle Tag

### Basic Cycling
```liquid
{%- cycle 'odd', 'even' -%}
{%- cycle 'odd', 'even' -%}
{%- cycle 'odd', 'even' -%}
```

Cycles through values in sequence.

### Named Groups
```liquid
{%- cycle 'colors': 'red', 'green', 'blue' -%}
{%- cycle 'colors': 'red', 'green', 'blue' -%}
```

Separate cycles don't affect each other.

## tablerow Tag

### Basic Syntax
```liquid
{%- tablerow product in products cols:3 -%}
  {{ product.name }}
{%- endtablerow -%}
```

Creates HTML table with specified columns.

### Arguments
```liquid
{%- tablerow item in items cols:4 limit:20 offset:10 -%}
  {{ item }}
{%- endtablerow -%}
```

Supports limit, offset like for loop.

## ifchanged Tag

### Basic Detection
```liquid
{%- for item in items -%}
  {%- ifchanged item.type -%}
    <h3>{{ item.type }}</h3>
  {%- endifchanged -%}
{%- endfor -%}
```

Renders when value changes from previous.

### Implicit Last Value
```liquid
{%- for item in items -%}
  {%- ifchanged item.type -%}
    {{ item.type }}
  {%- endifchanged -%}
  <p>{{ item.name }}</p>
{%- endfor -%}
```

Tracks last value automatically.

## Nested Loops

### Basic Nesting
```liquid
{%- for category in categories -%}
  <h2>{{ category.name }}</h2>
  {%- for product in category.products -%}
    <p>{{ product.name }}</p>
  {%- endfor -%}
{%- endfor -%}
```

Nested loops have separate contexts.

### Access Parent Loop
```liquid
{%- for category in categories -%}
  {%- for product in category.products -%}
    Category {{ forloop.parentloop.index }}, Product {{ forloop.index }}
  {%- endfor -%}
{%- endfor -%}
```

`parentloop` accesses outer loop context.

## Loop Data Types

### Array Looping
```liquid
{%- for item in array -%}
  {{ item }}
{%- endfor -%}
```

Simplest case.

### Hash Looping
```liquid
{%- for key_value in hash -%}
  {{ key_value[0] }}: {{ key_value[1] }}
{%- endfor -%}
```

Key-value pairs accessible by index.

### Range Looping
```liquid
{%- for i in (1..10) -%}
  {{ i }}
{%- endfor -%}

{%- for i in (1..max_value) -%}
  {{ i }}
{%- endfor -%}
```

Generates integer sequence.

## Best Practices

1. **Use limit and offset for pagination** - Don't load all items
2. **Check forloop.first/last for formatting** - Don't use if index == 1
3. **Use continue for skipping** - Cleaner than if-wrapping content
4. **Prefer for over cycle for HTML** - Cycle better for alternating classes
5. **Use tablerow for actual tables** - Generates proper HTML structure
6. **Name cycle groups** - Avoid interaction between independent cycles
7. **Test empty collections** - Always include else clause
8. **Limit deeply nested loops** - Performance impact increases exponentially

## Common Patterns

### Striped Rows
```liquid
{%- for item in items -%}
  <tr class="{% cycle 'odd', 'even' %}">
{%- endfor -%}
```

### Pagination
```liquid
{%- for item in items limit:20 offset:0 -%}
  {{ item }}
{%- endfor -%}
```

### Conditional Grouping
```liquid
{%- for item in items -%}
  {%- ifchanged item.category -%}
    <h3>{{ item.category }}</h3>
  {%- endifchanged -%}
{%- endfor -%}
```

## See Also

- [Loops API Reference](api.md)
- [Loops Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
