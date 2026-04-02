# Liquid Loops: API Reference

Complete API reference for looping constructs in platformOS Liquid.

## for Loop API

### Basic Syntax
```liquid
{%- for item in collection -%}
  {{ item }}
{%- endfor -%}
```

Iterates over arrays, hashes, or ranges.

### Array Iteration
```liquid
{%- for product in products -%}
  <p>{{ product.name }} - ${{ product.price }}</p>
{%- endfor -%}
```

### Hash Iteration
```liquid
{%- for entry in hash_data -%}
  Key: {{ entry[0] }}, Value: {{ entry[1] }}
{%- endfor -%}
```

Hash values available as [key, value] pairs.

### Range Iteration
```liquid
{%- for i in (1..5) -%}
  {{ i }}
{%- endfor -%}

{%- for i in (1..max) -%}
  {{ i }}
{%- endfor -%}
```

### With limit Argument
```liquid
{%- for item in items limit:10 -%}
  {{ item }}
{%- endfor -%}
```

Maximum of 10 iterations.

### With offset Argument
```liquid
{%- for item in items offset:5 -%}
  {{ item }}
{%- endfor -%}
```

Skip first 5 items.

### With reversed Argument
```liquid
{%- for item in items reversed -%}
  {{ item }}
{%- endfor -%}
```

Iterate in reverse order.

### Combined Arguments
```liquid
{%- for item in items limit:10 offset:20 reversed -%}
  {{ item }}
{%- endfor -%}
```

All arguments work together.

### With else Clause
```liquid
{%- for item in items -%}
  <p>{{ item }}</p>
{%- else -%}
  <p>No items</p>
{%- endfor -%}
```

Renders else block if collection empty.

### With break
```liquid
{%- for item in items -%}
  {%- if item.id == target -%}
    {%- break -%}
  {%- endif -%}
  {{ item }}
{%- endfor -%}
```

Exits loop immediately.

### With continue
```liquid
{%- for item in items -%}
  {%- if item.inactive -%}
    {%- continue -%}
  {%- endif -%}
  {{ item }}
{%- endfor -%}
```

Skips to next iteration.

## forloop Object API

### forloop.first
```liquid
{%- for item in items -%}
  {%- if forloop.first -%}<ul>{%- endif -%}
  <li>{{ item }}</li>
{%- endfor -%}
```

Boolean: true on first iteration.

### forloop.last
```liquid
{%- for item in items -%}
  <li>{{ item }}</li>
  {%- if forloop.last -%}</ul>{%- endif -%}
{%- endfor -%}
```

Boolean: true on last iteration.

### forloop.index
```liquid
{%- for item in items -%}
  {{ forloop.index }}: {{ item }}
{%- endfor -%}
```

Current iteration number (1-based).

### forloop.index0
```liquid
{%- for item in items -%}
  {{ forloop.index0 }}: {{ item }}
{%- endfor -%}
```

Current iteration number (0-based).

### forloop.rindex
```liquid
{%- for item in items -%}
  {{ forloop.rindex }} items remaining
{%- endfor -%}
```

Remaining iterations (1-based from end).

### forloop.rindex0
```liquid
{%- for item in items -%}
  {{ forloop.rindex0 }} items remaining
{%- endfor -%}
```

Remaining iterations (0-based from end).

### forloop.length
```liquid
{%- for item in items -%}
  {{ forloop.index }} of {{ forloop.length }}
{%- endfor -%}
```

Total number of iterations.

### forloop.parentloop
```liquid
{%- for category in categories -%}
  {%- for product in category.products -%}
    Outer: {{ forloop.parentloop.index }}
    Inner: {{ forloop.index }}
  {%- endfor -%}
{%- endfor -%}
```

Access outer loop from nested loop.

## cycle Tag API

### Basic Cycling
```liquid
{%- for item in items -%}
  <tr class="{% cycle 'row-1', 'row-2' %}">
  <td>{{ item }}</td>
  </tr>
{%- endfor -%}
```

Alternates between provided values.

### Three-Way Cycle
```liquid
{%- for item in items -%}
  <div class="{% cycle 'first', 'second', 'third' %}">
  {{ item }}
  </div>
{%- endfor -%}
```

### Named Cycle Groups
```liquid
{%- for item in items -%}
  Color: {% cycle 'colors': 'red', 'green', 'blue' %}
  Size: {% cycle 'sizes': 'small', 'large' %}
{%- endfor -%}
```

Each named group cycles independently.

## tablerow Tag API

### Basic Syntax
```liquid
{%- tablerow product in products cols:3 -%}
  {{ product.name }}
{%- endtablerow -%}
```

Creates HTML table with 3 columns.

### With limit Argument
```liquid
{%- tablerow item in items cols:4 limit:12 -%}
  {{ item }}
{%- endtablerow -%}
```

Maximum 12 items.

### With offset Argument
```liquid
{%- tablerow item in items cols:5 offset:10 -%}
  {{ item }}
{%- endtablerow -%}
```

Skip first 10 items.

### tablerowloop.col
```liquid
{%- tablerow product in products cols:3 -%}
  Column {{ tablerowloop.col }} of row
{%- endtablerow -%}
```

Current column number (1-based).

### tablerowloop.col0
```liquid
{%- tablerow product in products cols:3 -%}
  Column {{ tablerowloop.col0 }} (0-based)
{%- endtablerow -%}
```

Current column number (0-based).

### tablerowloop.col_first
```liquid
{%- tablerow product in products cols:3 -%}
  {%- if tablerowloop.col_first -%}<p>Row start{%- endif -%}
{%- endtablerow -%}
```

Boolean: true in first column of row.

### tablerowloop.col_last
```liquid
{%- tablerow product in products cols:3 -%}
  {%- if tablerowloop.col_last -%}<p>Row end{%- endif -%}
{%- endtablerow -%}
```

Boolean: true in last column of row.

### All forloop Properties in tablerowloop
```liquid
{%- tablerow product in products cols:3 -%}
  {{ tablerowloop.index }}: {{ product }}
  {%- if tablerowloop.last -%}Last item{%- endif -%}
{%- endtablerow -%}
```

tablerowloop includes all forloop properties.

## ifchanged Tag API

### Basic Change Detection
```liquid
{%- for item in items -%}
  {%- ifchanged item.category -%}
    <h3>{{ item.category }}</h3>
  {%- endifchanged -%}
  <p>{{ item.name }}</p>
{%- endfor -%}
```

Renders only when value changes from previous.

### Multiple Value Tracking
```liquid
{%- for item in items -%}
  {%- ifchanged item.category, item.type -%}
    <h3>{{ item.category }}: {{ item.type }}</h3>
  {%- endifchanged -%}
{%- endfor -%}
```

Detects change in any tracked value.

### With else Clause
```liquid
{%- for item in items -%}
  {%- ifchanged item.status -%}
    <h2>{{ item.status }}</h2>
  {%- else -%}
    {%- comment %} Status unchanged from previous {%- endcomment %}
  {%- endifchanged -%}
{%- endfor -%}
```

### Implicit Comparison
```liquid
{%- for item in items -%}
  {%- ifchanged item -%}
    New item: {{ item }}
  {%- endifchanged -%}
{%- endfor -%}
```

If no value specified, compares entire item.

## break and continue API

### break Statement
```liquid
{%- for item in items -%}
  {%- if item == target -%}
    Found!
    {%- break -%}
  {%- endif -%}
{%- endfor -%}
```

Immediately exits loop.

### continue Statement
```liquid
{%- for item in items -%}
  {%- if item.skip -%}
    {%- continue -%}
  {%- endif -%}
  Process: {{ item }}
{%- endfor -%}
```

Skips to next iteration.

## Loop Combination Examples

### for with cycle
```liquid
{%- for item in items -%}
  <tr class="{% cycle 'odd', 'even' %}">
  <td>{{ item }}</td>
  </tr>
{%- endfor -%}
```

### for with ifchanged
```liquid
{%- for item in items -%}
  {%- ifchanged item.category -%}
    <h2>{{ item.category }}</h2>
  {%- endifchanged -%}
  <p>{{ item.name }}</p>
{%- endfor -%}
```

### tablerow with break
```liquid
{%- tablerow product in products cols:4 -%}
  {%- if forloop.index > 8 -%}
    {%- break -%}
  {%- endif -%}
  {{ product }}
{%- endtablerow -%}
```

## See Also

- [Loops Configuration](configuration.md)
- [Loops Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
