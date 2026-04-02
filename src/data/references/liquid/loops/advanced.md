# Liquid Loops: Advanced Techniques

Advanced patterns, optimization strategies, and professional techniques for platformOS Liquid loops.

## Advanced Pagination Patterns

### Offset-Based with Page Numbers
```liquid
{%- assign current_page = context.params.page | default: 1 | plus: 0 -%}
{%- assign items_per_page = 20 -%}
{%- assign offset = current_page | minus: 1 | times: items_per_page -%}
{%- assign total_items = all_items.size -%}
{%- assign total_pages = total_items | divided_by: items_per_page | ceil -%}

{%- for item in all_items limit:items_per_page offset:offset -%}
  {{ item }}
{%- endfor -%}

{%- if current_page > 1 -%}
  <a href="?page={{ current_page | minus: 1 }}">Previous</a>
{%- endif -%}

{%- for p in (1..total_pages) -%}
  <a href="?page={{ p }}"
     class="{% if p == current_page %}active{% endif %}">
    {{ p }}
  </a>
{%- endfor -%}

{%- if current_page < total_pages -%}
  <a href="?page={{ current_page | plus: 1 }}">Next</a>
{%- endif -%}
```

### Infinite Scroll Implementation
```liquid
{%- assign page = context.params.page | default: 1 | plus: 0 -%}
{%- assign per_page = 10 -%}
{%- assign offset = page | minus: 1 | times: per_page -%}

{%- for item in items limit:per_page offset:offset -%}
  <article id="item-{{ item.id }}">
    {{ item.content }}
  </article>
{%- endfor -%}

{%- if offset | plus: per_page < items.size -%}
  <button data-next-page="{{ page | plus: 1 }}" class="load-more">
    Load More
  </button>
{%- endif -%}
```

### Keyset-Based Pagination
```liquid
{%- assign start_after = context.params.start_after -%}

{%- assign filtered = all_items -%}
{%- if start_after -%}
  {%- comment %} Filter items after cursor {%- endcomment %}
{%- endif -%}

{%- assign page_size = 20 -%}
{%- assign last_cursor = nil -%}

{%- for item in filtered limit:page_size -%}
  <p>{{ item.name }}</p>
  {%- assign last_cursor = item.id -%}
{%- endfor -%}

{%- if filtered.size > page_size -%}
  <a href="?start_after={{ last_cursor }}">Next Page</a>
{%- endif -%}
```

## Conditional Grouping and Aggregation

### Grouping with Change Detection
```liquid
{%- assign sorted_items = items | array_sort_by: 'category' -%}
{%- assign current_group = nil -%}
{%- assign group_total = 0 -%}

{%- for item in sorted_items -%}
  {%- ifchanged item.category -%}
    {%- if current_group != nil -%}
      <p>Subtotal: ${{ group_total }}</p>
      </div>
    {%- endif -%}

    <div class="category">
    <h3>{{ item.category }}</h3>
    {%- assign group_total = 0 -%}
    {%- assign current_group = item.category -%}
  {%- endifchanged -%}

  <p>{{ item.name }} - ${{ item.price }}</p>
  {%- assign group_total = group_total | plus: item.price -%}
{%- endfor -%}

{%- if current_group != nil -%}
  <p>Subtotal: ${{ group_total }}</p>
  </div>
{%- endif -%}
```

### Hierarchical Accumulation
```liquid
{%- assign total_all = 0 -%}
{%- assign region_totals = {} -%}

{%- for order in orders -%}
  {%- assign amount = order.total -%}
  {%- assign region = order.region -%}

  {%- assign total_all = total_all | plus: amount -%}

  {%- assign current = region_totals[region] | default: 0 -%}
  {%- assign region_totals[region] = current | plus: amount -%}
{%- endfor -%}

{%- for region_key in region_totals | hash_keys -%}
  Region: {{ region_key }}: ${{ region_totals[region_key] }}
{%- endfor -%}

Total: ${{ total_all }}
```

## Advanced Filter Chains in Loops

### Dynamic Multi-Filter
```liquid
{%- assign filtered = all_items -%}

{%- if context.params.category -%}
  {%- assign filtered = filtered | array_select: 'category', context.params.category -%}
{%- endif -%}

{%- if context.params.min_price -%}
  {%- comment %} Filter by price range {%- endcomment %}
{%- endif -%}

{%- assign sorted = filtered -%}
{%- if context.params.sort_by -%}
  {%- assign sorted = filtered | array_sort_by: context.params.sort_by -%}
  {%- if context.params.order == 'desc' -%}
    {%- assign sorted = sorted | array_reverse -%}
  {%- endif -%}
{%- endif -%}

{%- for item in sorted limit:20 -%}
  {{ item.name }}
{%- else -%}
  No items match filters
{%- endfor -%}
```

## Performance-Optimized Loops

### Lazy Index Tracking
```liquid
{%- assign item_index = 0 -%}
{%- assign display_index = context.params.start | default: 1 | plus: 0 -%}

{%- for item in items -%}
  {%- assign item_index = item_index | plus: 1 -%}

  {%- if item_index >= display_index and item_index < display_index | plus: 20 -%}
    {{ item_index }}: {{ item }}
  {%- endif -%}

  {%- if item_index >= display_index | plus: 20 -%}
    {%- break -%}
  {%- endif -%}
{%- endfor -%}
```

### Cached Loop Results
```liquid
{%- unless cached_results -%}
  {%- assign results = items | array_sort_by: 'popularity' -%}
  {%- assign cached_results = results -%}
{%- endunless -%}

{%- for item in cached_results limit:10 -%}
  {{ item }}
{%- endfor -%}
```

## Complex Nested Loop Patterns

### Multi-Level Hierarchical Display
```liquid
{%- for region in regions -%}
  <section class="region">
    <h1>{{ region.name }}</h1>

    {%- for country in region.countries -%}
      <article class="country">
        <h2>{{ country.name }}</h2>

        {%- for city in country.cities -%}
          <div class="city">
            <h3>{{ city.name }}</h3>

            {%- if city.attractions.size > 0 -%}
              <ul>
              {%- for attraction in city.attractions -%}
                <li>{{ attraction }}</li>
              {%- endfor -%}
              </ul>
            {%- else -%}
              <p>No attractions</p>
            {%- endif -%}
          </div>
        {%- endfor -%}
      </article>
    {%- endfor -%}
  </section>
{%- endfor -%}
```

### Sibling Loop State Tracking
```liquid
{%- assign prev_category = nil -%}
{%- assign next_category = nil -%}

{%- for i in (0..items.size) -%}
  {%- assign item = items[i] -%}

  {%- if i > 0 -%}
    {%- assign prev_category = items[i | minus: 1].category -%}
  {%- endif -%}

  {%- if i < items.size | minus: 1 -%}
    {%- assign next_category = items[i | plus: 1].category -%}
  {%- endif -%}

  {%- if item.category != prev_category -%}
    <h3>{{ item.category }}</h3>
  {%- endif -%}

  <p>{{ item.name }}</p>

  {%- if item.category != next_category and next_category -%}
    <hr>
  {%- endif -%}
{%- endfor -%}
```

## Advanced tablerow Usage

### Custom Column Layout
```liquid
{%- assign cols = 4 -%}
{%- assign num_items = items.size -%}
{%- assign num_rows = num_items | divided_by: cols | ceil -%}

{%- tablerow item in items cols:cols -%}
  {%- assign row_num = tablerowloop.index | minus: 1 | divided_by: cols | floor -%}
  {%- assign col_num = tablerowloop.index | minus: 1 | modulo: cols -%}

  <div class="item row-{{ row_num }} col-{{ col_num }}">
    {{ item }}
  </div>
{%- endtablerow -%}
```

### Responsive Grid with tablerow
```liquid
{%- assign mobile_cols = 1 -%}
{%- assign tablet_cols = 2 -%}
{%- assign desktop_cols = 4 -%}

{%- assign display_cols = desktop_cols -%}
{%- if context.device.is_mobile -%}
  {%- assign display_cols = mobile_cols -%}
{%- elsif context.device.is_tablet -%}
  {%- assign display_cols = tablet_cols -%}
{%- endif -%}

{%- tablerow product in products cols:display_cols -%}
  <div class="product-card">
    <h3>{{ product.name }}</h3>
    <p>${{ product.price }}</p>
  </div>
{%- endtablerow -%}
```

## Advanced ifchanged Patterns

### Multi-Level Change Detection
```liquid
{%- assign prev_category = nil -%}
{%- assign prev_type = nil -%}

{%- for item in sorted_items -%}
  {%- if item.category != prev_category -%}
    {%- if prev_category != nil -%}
      </section>
    {%- endif -%}
    <section class="category-{{ item.category }}">
    <h2>{{ item.category }}</h2>
  {%- endif -%}

  {%- if item.type != prev_type -%}
    <h3>{{ item.type }}</h3>
  {%- endif -%}

  <p>{{ item.name }}</p>

  {%- assign prev_category = item.category -%}
  {%- assign prev_type = item.type -%}
{%- endfor -%}

{%- if prev_category != nil -%}
  </section>
{%- endif -%}
```

### Conditional Content Based on Change
```liquid
{%- assign last_day = nil -%}

{%- for event in events_sorted_by_date -%}
  {%- capture event_day -%}
{{ event.date | strftime: '%Y-%m-%d' }}
  {%- endcapture -%}

  {%- ifchanged event_day -%}
    {%- if last_day != nil -%}
      </div>
    {%- endif -%}
    <div class="day-{{ event_day }}">
    <h3>{{ event_day | strftime: '%B %d, %Y' }}</h3>
    {%- assign last_day = event_day -%}
  {%- endifchanged -%}

  <p>{{ event.time }} - {{ event.title }}</p>
{%- endfor -%}

{%- if last_day -%}
  </div>
{%- endif -%}
```

## Loop Control Flow Optimization

### Early Exit with Complex Condition
```liquid
{%- assign found = false -%}
{%- assign found_at_index = nil -%}

{%- for item in items -%}
  {%- if item.active and item.priority == 'critical' and item.assigned_to == nil -%}
    {%- assign found = true -%}
    {%- assign found_at_index = forloop.index -%}
    <p>Action needed: {{ item.name }}</p>
    {%- break -%}
  {%- endif -%}
{%- endfor -%}

{%- unless found -%}
  <p>No critical unassigned items</p>
{%- endunless -%}
```

### Skip with Aggregation
```liquid
{%- assign valid_count = 0 -%}
{%- assign valid_total = 0 -%}

{%- for item in items -%}
  {%- if item.status == 'invalid' -%}
    {%- continue -%}
  {%- endif -%}

  {%- assign valid_count = valid_count | plus: 1 -%}
  {%- assign valid_total = valid_total | plus: item.amount -%}

  <p>{{ item.name }}: ${{ item.amount }}</p>
{%- endfor -%}

<p>Total Valid: {{ valid_count }} items, ${{ valid_total }}</p>
```

## See Also

- [Loops Configuration](configuration.md)
- [Loops API Reference](api.md)
- [Loops Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
