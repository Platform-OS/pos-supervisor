# Liquid Loops: Patterns & Examples

Common patterns and practical examples for looping in platformOS Liquid.

## Pagination Patterns

### Basic Pagination
```liquid
{%- assign page = context.params.page | default: 1 | plus: 0 -%}
{%- assign per_page = 20 -%}
{%- assign offset = page | minus: 1 | times: per_page -%}

{%- for product in products limit:per_page offset:offset -%}
  <p>{{ product.name }} - ${{ product.price }}</p>
{%- endfor -%}

{%- assign total_pages = products.size | divided_by: per_page | ceil -%}
```

### Pagination Navigation
```liquid
{%- for p in (1..total_pages) -%}
  <a href="?page={{ p }}"
     class="{% if p == current_page %}active{% endif %}">
    {{ p }}
  </a>
{%- endfor -%}
```

### Cursor-Based Pagination
```liquid
{%- for item in items limit:10 -%}
  <p>{{ item.name }}</p>
  {%- assign last_cursor = item.id -%}
{%- endfor -%}

<a href="?cursor={{ last_cursor }}">Load more</a>
```

## List Display Patterns

### Striped Rows
```liquid
<table>
{%- for row in data -%}
  <tr class="{% cycle 'odd', 'even' %}">
    {%- for cell in row -%}
      <td>{{ cell }}</td>
    {%- endfor -%}
  </tr>
{%- endfor -%}
</table>
```

### Alternating Colors
```liquid
{%- for item in items -%}
  <div class="card {% cycle 'color-1', 'color-2', 'color-3' %}">
    <h3>{{ item.title }}</h3>
    <p>{{ item.description }}</p>
  </div>
{%- endfor -%}
```

### Grid Layout
```liquid
{%- tablerow product in products cols:4 -%}
  <div class="product-card">
    <img src="{{ product.image_url }}" alt="{{ product.name }}">
    <h4>{{ product.name }}</h4>
    <p>${{ product.price }}</p>
  </div>
{%- endtablerow -%}
```

## Hierarchical Display Patterns

### Grouped by Category
```liquid
{%- assign categories = products | array_group_by: 'category' -%}

{%- for category in categories -%}
  <h2>{{ category[0] }}</h2>
  <ul>
  {%- for product in category[1] -%}
    <li>{{ product.name }}</li>
  {%- endfor -%}
  </ul>
{%- endfor -%}
```

### Grouped with Change Detection
```liquid
{%- for product in products_sorted -%}
  {%- ifchanged product.category -%}
    <h3>{{ product.category }}</h3>
    <ul>
  {%- endifchanged -%}

  <li>{{ product.name }}</li>

  {%- ifchanged product.category -%}
    </ul>
  {%- endifchanged -%}
{%- endfor -%}
```

### Multi-Level Nesting
```liquid
{%- for region in regions -%}
  <h2>{{ region.name }}</h2>
  {%- for country in region.countries -%}
    <h3>{{ country.name }}</h3>
    <ul>
    {%- for city in country.cities -%}
      <li>{{ city.name }}</li>
    {%- endfor -%}
    </ul>
  {%- endfor -%}
{%- endfor -%}
```

## Data Filtering Patterns

### Filtering While Looping
```liquid
{%- for item in all_items -%}
  {%- if item.active and item.price > 0 -%}
    <p>{{ item.name }} - ${{ item.price }}</p>
  {%- endif -%}
{%- endfor -%}
```

### Counting Matching Items
```liquid
{%- assign active_count = 0 -%}
{%- for item in items -%}
  {%- if item.status == 'active' -%}
    {%- assign active_count = active_count | plus: 1 -%}
  {%- endif -%}
{%- endfor -%}

<p>Active: {{ active_count }} of {{ items.size }}</p>
```

### Early Exit Optimization
```liquid
{%- assign target_found = false -%}
{%- for item in items -%}
  {%- if item.id == target_id -%}
    <p>Found: {{ item.name }}</p>
    {%- assign target_found = true -%}
    {%- break -%}
  {%- endif -%}
{%- endfor -%}

{%- unless target_found -%}
  <p>Not found</p>
{%- endunless -%}
```

## Batch Processing Patterns

### Process in Chunks
```liquid
{%- assign batch_size = 10 -%}
{%- assign batch_count = items.size | divided_by: batch_size | ceil -%}

{%- for i in (1..batch_count) -%}
  {%- assign offset = i | minus: 1 | times: batch_size -%}
  <div class="batch">
    {%- for item in items limit:batch_size offset:offset -%}
      <p>{{ item }}</p>
    {%- endfor -%}
  </div>
{%- endfor -%}
```

### Batch with Header/Footer
```liquid
{%- assign page_size = 20 -%}
{%- for item in items limit:page_size -%}
  {%- if forloop.first -%}
    <section class="batch">
  {%- endif -%}

  <p>{{ item }}</p>

  {%- if forloop.last -%}
    </section>
  {%- endif -%}
{%- endfor -%}
```

## Special Index Patterns

### First/Last Item Styling
```liquid
<ul>
{%- for item in items -%}
  <li class="
    {%- if forloop.first %} first{% endif %}
    {%- if forloop.last %} last{% endif %}
    {%- if forloop.index is odd %} odd{% endif %}
  ">
    {{ item }}
  </li>
{%- endfor -%}
</ul>
```

### Position-Based Content
```liquid
{%- for item in items -%}
  {%- if forloop.first -%}
    <h2>Featured: {{ item }}</h2>
  {%- elsif forloop.index <= 3 -%}
    <p>{{ item }}</p>
  {%- elsif forloop.last -%}
    <p>Latest: {{ item }}</p>
  {%- endif -%}
{%- endfor -%}
```

### Index Offset Calculation
```liquid
{%- assign start_index = 100 -%}
{%- for item in items -%}
  {%- assign position = forloop.index | plus: start_index | minus: 1 -%}
  {{ position }}: {{ item }}
{%- endfor -%}
```

## Table Rendering Patterns

### Table with Headers
```liquid
<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Price</th>
      <th>Quantity</th>
    </tr>
  </thead>
  <tbody>
  {%- for product in products -%}
    <tr class="{% cycle 'odd', 'even' %}">
      <td>{{ product.name }}</td>
      <td>${{ product.price }}</td>
      <td>{{ product.quantity }}</td>
    </tr>
  {%- endfor -%}
  </tbody>
</table>
```

### Responsive Table Layout
```liquid
{%- tablerow product in products cols:6 -%}
  <article class="product">
    <h4>{{ product.name }}</h4>
    <p>${{ product.price }}</p>
    <button>Add to Cart</button>
  </article>
{%- endtablerow -%}
```

## Empty State Patterns

### No Items Available
```liquid
{%- for item in items -%}
  <p>{{ item }}</p>
{%- else -%}
  <p class="empty-state">
    No items available.
    <a href="/create">Create one</a>
  </p>
{%- endfor -%}
```

### Conditional Display
```liquid
{%- if items.size > 0 -%}
  <ul>
  {%- for item in items -%}
    <li>{{ item }}</li>
  {%- endfor -%}
  </ul>
{%- else -%}
  <div class="placeholder">
    Start by adding items
  </div>
{%- endif -%}
```

## Aggregation Patterns

### Sum and Count
```liquid
{%- assign total = 0 -%}
{%- assign count = 0 -%}

{%- for item in items -%}
  {%- if item.active -%}
    {%- assign total = total | plus: item.price -%}
    {%- assign count = count | plus: 1 -%}
  {%- endif -%}
{%- endfor -%}

<p>Total: ${{ total }}, Count: {{ count }}</p>
```

### Group Counting
```liquid
{%- assign region_counts = {} -%}

{%- for item in items -%}
  {%- assign region = item.region -%}
  {%- assign current = region_counts[region] | default: 0 -%}
  {%- assign region_counts[region] = current | plus: 1 -%}
{%- endfor -%}
```

## Reverse and Sorted Patterns

### Reverse Display
```liquid
{%- for item in items reversed -%}
  <p>{{ item.name }} ({{ forloop.index }})</p>
{%- endfor -%}
```

### Sorted Display
```liquid
{%- assign sorted = items | array_sort_by: 'price' -%}
{%- for item in sorted -%}
  <p>{{ item.name }} - ${{ item.price }}</p>
{%- endfor -%}
```

## See Also

- [Loops Configuration](configuration.md)
- [Loops API Reference](api.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
