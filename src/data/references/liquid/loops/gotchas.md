# Liquid Loops: Common Gotchas

Common pitfalls and how to avoid them when using platformOS Liquid loops.

## Iteration Index Gotchas

### Problem: forloop.index Starts at 1
```liquid
{%- for item in items limit:5 offset:10 -%}
  {{ forloop.index }}  {%- comment %} Starts at 1, not 11 {%- endcomment %}
{%- endfor -%}
```

**Solution:** Calculate actual index:
```liquid
{%- assign offset = 10 -%}
{%- for item in items limit:5 offset:10 -%}
  {{ forloop.index | plus: offset | minus: 1 }}
{%- endfor -%}
```

### Problem: forloop.index vs forloop.index0
```liquid
{%- for item in items -%}
  {%- if forloop.index == 0 -%}
    {%- comment %} This never matches {%- endcomment %}
  {%- endif -%}
{%- endfor -%}
```

**Solution:** Use correct property:
```liquid
{%- if forloop.index0 == 0 -%}
  First item (0-based)
{%- endif -%}
```

### Problem: parentloop Not Available Outside Nested Loop
```liquid
{%- for item in items -%}
  {{ forloop.parentloop.index }}
  {%- comment %} Nil - not nested {%- endcomment %}
{%- endfor -%}
```

**Solution:** Only access in actually nested loop:
```liquid
{%- for category in categories -%}
  {%- for product in category.products -%}
    {{ forloop.parentloop.index }}
    {%- comment %} Now it exists {%- endcomment %}
  {%- endfor -%}
{%- endfor -%}
```

## Looping Over Collections Gotchas

### Problem: Looping Over Nil
```liquid
{%- for item in nil -%}
  {{ item }}
{%- else -%}
  Empty
{%- endfor -%}
```

**Solution:** Check for nil first:
```liquid
{%- if items -%}
  {%- for item in items -%}
    {{ item }}
  {%- endfor -%}
{%- else -%}
  No items
{%- endif -%}
```

### Problem: Hash Iteration Returns Array Pairs
```liquid
{%- assign hash = 'name:John,age:30' | split: ',' -%}
{%- for item in hash -%}
  {{ item }}  {%- comment %} Returns array [key, value] {%- endcomment %}
{%- endfor -%}
```

**Solution:** Access as array indices:
```liquid
{%- for pair in hash -%}
  {{ pair[0] }}: {{ pair[1] }}
{%- endfor -%}
```

### Problem: Range Behavior
```liquid
{%- for i in (1..10) -%}
  {%- for j in (1..10) -%}
    {%- comment %} Both loop 1..10 {%- endcomment %}
  {%- endfor -%}
{%- endfor -%}
```

**Solution:** Use variable for dynamic range:
```liquid
{%- assign max = 20 -%}
{%- for i in (1..max) -%}
  {{ i }}
{%- endfor -%}
```

## cycle Gotchas

### Problem: cycle Across Multiple for Loops
```liquid
{%- for row1 in data1 -%}
  {% cycle 'odd', 'even' %}
{%- endfor -%}
{%- for row2 in data2 -%}
  {% cycle 'odd', 'even' %}  {%- comment %} Continues cycling {%- endcomment %}
{%- endfor -%}
```

**Solution:** Use named groups:
```liquid
{%- for row1 in data1 -%}
  {% cycle 'table1': 'odd', 'even' %}
{%- endfor -%}
{%- for row2 in data2 -%}
  {% cycle 'table2': 'odd', 'even' %}
{%- endfor -%}
```

### Problem: cycle Variable Scope
```liquid
{%- assign class = '' -%}
{%- for item in items -%}
  {%- assign class = cycle 'odd', 'even' -%}
  {%- comment %} cycle doesn't return value to assign {%- endcomment %}
{%- endfor -%}
```

**Solution:** Use cycle directly in output:
```liquid
{%- for item in items -%}
  <tr class="{% cycle 'odd', 'even' %}">
{%- endfor -%}
```

## tablerow Gotchas

### Problem: Column Reset Per Row
```liquid
{%- tablerow item in items cols:3 -%}
  Column: {{ tablerowloop.col }}
{%- endtablerow -%}
{%- comment %} Column resets to 1 at start of each row {%- endcomment %}
```

**Solution:** Calculate global column if needed:
```liquid
{%- tablerow item in items cols:3 -%}
  {%- assign global_col = tablerowloop.index | modulo: 3 -%}
{%- endtablerow -%}
```

### Problem: table Structure Automatic
```liquid
{%- tablerow item in items cols:3 -%}
  {{ item }}
{%- endtablerow -%}
{%- comment %} Generates <table><tr><td>...</td></tr></table> {%- endcomment %}
```

**Solution:** Understand the HTML generated:
```html
<table>
  <tr>
    <td>Item 1</td>
    <td>Item 2</td>
    <td>Item 3</td>
  </tr>
  <tr>
    <td>Item 4</td>
    ...
  </tr>
</table>
```

## break and continue Gotchas

### Problem: break Doesn't Skip else
```liquid
{%- for item in items -%}
  {%- if item.id == target -%}
    Found!
    {%- break -%}
  {%- endif -%}
{%- else -%}
  {%- comment %} else DOES execute if loop has items {%- endcomment %}
{%- endfor -%}
```

**Solution:** Use flag for break detection:
```liquid
{%- assign found = false -%}
{%- for item in items -%}
  {%- if item.id == target -%}
    Found!
    {%- assign found = true -%}
    {%- break -%}
  {%- endif -%}
{%- endfor -%}
{%- unless found -%}
  Not found
{%- endunless -%}
```

### Problem: continue in Empty Check
```liquid
{%- for item in items -%}
  {%- if item.skip -%}
    {%- continue -%}
  {%- endif -%}
  {{ item }}
{%- else -%}
  No items
{%- endfor -%}
{%- comment %} else triggers if items exist (even if all skipped) {%- endcomment %}
```

**Solution:** Track actual processing:
```liquid
{%- assign processed = false -%}
{%- for item in items -%}
  {%- if item.skip -%}
    {%- continue -%}
  {%- endif -%}
  {%- assign processed = true -%}
  {{ item }}
{%- endfor -%}
{%- unless processed -%}
  No items processed
{%- endunless -%}
```

## Nested Loop Gotchas

### Problem: forloop Variable Shadowing
```liquid
{%- for item in items1 -%}
  {%- for item in items2 -%}
    {%- comment %} Inner loop shadows outer 'item' {%- endcomment %}
  {%- endfor -%}
{%- endfor -%}
```

**Solution:** Use descriptive variable names:
```liquid
{%- for category in categories -%}
  {%- for product in category.products -%}
    {{ product }}
  {%- endfor -%}
{%- endfor -%}
```

### Problem: Loop Length Changes in Nested
```liquid
{%- for outer in items1 -%}
  Outer length: {{ forloop.length }}
  {%- for inner in items2 -%}
    Inner length: {{ forloop.length }}
  {%- endfor -%}
{%- endfor -%}
```

**Solution:** Use specific references:
```liquid
{%- assign outer_len = items1.size -%}
{%- assign inner_len = items2.size -%}
```

## Limit and Offset Gotchas

### Problem: Reversed with Limit
```liquid
{%- for item in items limit:5 reversed -%}
  {%- comment %} Gets last 5 items, then reverses them {%- endcomment %}
{%- endfor -%}
```

**Solution:** Be aware of order:
```liquid
{%- comment %} To get first 5 items reversed: {%- endcomment %}
{%- assign sorted = items | array_reverse -%}
{%- for item in sorted limit:5 -%}
```

### Problem: Pagination with changed offset
```liquid
{%- for item in items limit:10 offset:page -%}
  {%- comment %} Page variable is offset itself, not page number {%- endcomment %}
{%- endfor -%}
```

**Solution:** Calculate offset properly:
```liquid
{%- assign page_num = context.params.page | default: 1 | plus: 0 -%}
{%- assign offset = page_num | minus: 1 | times: 10 -%}
{%- for item in items limit:10 offset:offset -%}
```

## ifchanged Gotchas

### Problem: ifchanged Comparison Scope
```liquid
{%- for item in items -%}
  {%- ifchanged item.category -%}
    {{ item.category }}
  {%- endifchanged -%}
{%- endfor -%}
{%- comment %} Only tracks within this loop {%- endcomment %}
```

**Solution:** ifchanged state is per-loop.

### Problem: Multiple ifchanged Tags
```liquid
{%- for item in items -%}
  {%- ifchanged item.category -%}
    Category: {{ item.category }}
  {%- endifchanged -%}
  {%- ifchanged item.type -%}
    Type: {{ item.type }}
  {%- endifchanged -%}
{%- endfor -%}
```

**Solution:** Each ifchanged tracks independently.

## Empty Collection Gotchas

### Problem: Checking Empty After Loop
```liquid
{%- for item in items -%}
  <p>{{ item }}</p>
{%- endfor -%}

{%- if items.size == 0 -%}
  {%- comment %} Loop already rendered, now showing empty {%- endcomment %}
{%- endif -%}
```

**Solution:** Use else clause:
```liquid
{%- for item in items -%}
  <p>{{ item }}</p>
{%- else -%}
  <p>No items</p>
{%- endfor -%}
```

## Performance Gotchas

### Problem: Large Limit Values
```liquid
{%- for item in items limit:1000000 -%}
  {%- comment %} May cause performance issues {%- endcomment %}
{%- endfor -%}
```

**Solution:** Use reasonable limits:
```liquid
{%- for item in items limit:100 -%}
  {{ item }}
{%- endfor -%}
```

### Problem: Deep Nesting Performance
```liquid
{%- for a in items1 -%}
  {%- for b in items2 -%}
    {%- for c in items3 -%}
      {%- comment %} O(n^3) complexity {%- endcomment %}
    {%- endfor -%}
  {%- endfor -%}
{%- endfor -%}
```

**Solution:** Use GraphQL for complex queries.

## See Also

- [Loops Configuration](configuration.md)
- [Loops API Reference](api.md)
- [Loops Patterns & Examples](patterns.md)
- [Advanced Techniques](advanced.md)
