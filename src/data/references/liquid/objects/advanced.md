# Liquid Objects: Advanced Techniques

Advanced patterns and professional techniques for using platformOS Liquid objects.

## Advanced Context Usage

### Building Dynamic Navigation with Current Path
```liquid
{%- assign current_path = context.location.pathname -%}
{%- assign path_parts = current_path | split: '/' | compact -%}

<nav class="breadcrumb">
  <a href="/">Home</a>
  {%- for part in path_parts -%}
    {%- assign path_so_far = '/' | append: path_parts | join: '/' -%}
    <a href="{{ path_so_far }}">{{ part | capitalize }}</a>
  {%- endfor -%}
</nav>
```

### Conditional Behavior Based on Query Parameters
```liquid
{%- assign preview_mode = context.params.preview | default: false -%}
{%- assign show_draft = context.params.draft | default: false -%}
{%- assign mode = context.environment.is_staging | default: false -%}

{%- assign should_show_drafts = show_draft or mode -%}
{%- if should_show_drafts -%}
  {%- assign items = all_items -%}
{%- else -%}
  {%- assign items = published_items -%}
{%- endif -%}
```

### Complex Device Detection
```liquid
{%- assign device_type = context.device.type -%}
{%- assign is_ios = context.device.os | matches: 'iOS' -%}
{%- assign is_android = context.device.os | matches: 'Android' -%}
{%- assign is_app = is_ios or is_android -%}

{%- if is_app -%}
  {%- comment %} Mobile app-specific optimizations {%- endcomment %}
{%- elsif context.device.is_mobile -%}
  {%- comment %} Mobile web optimizations {%- endcomment %}
{%- else -%}
  {%- comment %} Desktop optimizations {%- endcomment %}
{%- endif -%}
```

## Advanced Session Patterns

### Implementing Shopping Cart with Session
```liquid
{%- assign cart = context.session.shopping_cart | default: '[]' | parse_json -%}

<div class="cart">
  {%- assign total = 0 -%}
  {%- for item in cart -%}
    {%- assign item_total = item.price | times: item.quantity -%}
    {%- assign total = total | plus: item_total -%}
    <div class="cart-item">
      <span>{{ item.name }}</span>
      <span>{{ item.quantity }}x</span>
      <span>${{ item_total | divided_by: 100 }}</span>
    </div>
  {%- endfor -%}
  <div class="cart-total">${{ total | divided_by: 100 }}</div>
</div>
```

### User Preference Cascade
```liquid
{%- assign system_theme = 'light' -%}
{%- assign user_theme = context.exports.user.theme -%}
{%- assign session_theme = context.session.theme -%}
{%- assign param_theme = context.params.theme -%}

{%- comment %} Priority: param > session > user > system {%- endcomment %}
{%- assign active_theme = param_theme | default: session_theme -%}
{%- assign active_theme = active_theme | default: user_theme -%}
{%- assign active_theme = active_theme | default: system_theme -%}

<html class="theme-{{ active_theme }}">
```

## Advanced Loop Techniques

### Creating Paginated Index
```liquid
{%- assign page = context.params.page | default: 1 | plus: 0 -%}
{%- assign per_page = 10 -%}
{%- assign start_index = page | minus: 1 | times: per_page -%}
{%- assign total_pages = items | size | divided_by: per_page | ceil -%}

{%- for i in (0..total_pages) -%}
  {%- assign current_page = i | plus: 1 -%}
  <a href="?page={{ current_page }}"
     class="{% if current_page == page %}active{% endif %}">
    {{ current_page }}
  </a>
{%- endfor -%}
```

### Complex Nested Structure Rendering
```liquid
{%- for category in context.exports.categories -%}
  <section class="category">
    <h2>{{ category.name }}</h2>
    {%- for subcategory in category.subcategories -%}
      <div class="subcategory">
        <h3>{{ subcategory.name }}</h3>
        {%- for product in subcategory.products -%}
          <article class="product {%- if forloop.last %} last{%- endif %}">
            <h4>{{ product.name }}</h4>
            <p>Nesting Level: {{ forloop.index }} in {{ forloop.length }}</p>
            <p>Category: {{ forloop.parentloop.parentloop.index }}</p>
          </article>
        {%- endfor -%}
      </div>
    {%- endfor -%}
  </section>
{%- endfor -%}
```

### Alternate Color Grid Layout
```liquid
{%- assign columns = 4 -%}
{%- tablerow item in items cols:columns -%}
  {%- assign row = tablerowloop.index | minus: 1 | divided_by: columns | floor -%}
  {%- assign is_even_row = row | modulo: 2 -%}
  {%- assign is_even_col = tablerowloop.col | modulo: 2 -%}

  <div class="grid-item {%- if is_even_row and is_even_col %} alternate{%- endif %}">
    {{ item }}
  </div>
{%- endtablerow -%}
```

## Advanced Parameter Handling

### Multi-Level Filter System
```liquid
{%- assign filters = context.params | hash_keys -%}
{%- assign results = all_items -%}

{%- for filter_key in filters -%}
  {%- assign filter_value = context.params[filter_key] -%}
  {%- unless filter_value == 'all' or filter_value == '' -%}
    {%- assign results = results | array_select: filter_key, filter_value -%}
  {%- endunless -%}
{%- endfor -%}

{%- assign sorted = results -%}
{%- if context.params.sort -%}
  {%- assign sorted = results | array_sort_by: context.params.sort -%}
  {%- if context.params.order == 'desc' -%}
    {%- assign sorted = sorted | array_reverse -%}
  {%- endif -%}
{%- endif -%}
```

### Search Query Builder
```liquid
{%- assign query = context.params.q | default: '' -%}
{%- assign filters = context.params -%}

{%- assign search_results = products -%}
{%- if query != '' -%}
  {%- capture search_regex -%}{{ query }}{%- endcapture -%}
  {%- assign search_results = products | array_select: 'name', search_regex -%}
{%- endif -%}

{%- for key in filters -%}
  {%- unless key == 'q' -%}
    {%- assign value = context.params[key] -%}
    {%- assign search_results = search_results | array_select: key, value -%}
  {%- endunless -%}
{%- endfor -%}
```

## Advanced Header Analysis

### Accept-Language Processing
```liquid
{%- assign lang_header = context.headers['Accept-Language'] | default: 'en-US' -%}
{%- assign languages = lang_header | split: ',' -%}
{%- assign primary_lang = languages | first | split: '-' | first -%}

{%- assign supported_langs = 'en,es,fr,de' | split: ',' -%}
{%- if supported_langs | contains: primary_lang -%}
  Language: {{ primary_lang }}
{%- else -%}
  Language: en (default)
{%- endif -%}
```

### Custom Header Handling
```liquid
{%- assign api_key = context.headers['X-API-Key'] -%}
{%- assign api_version = context.headers['X-API-Version'] | default: 'v1' -%}
{%- assign client_id = context.headers['X-Client-ID'] -%}

{%- if api_key and api_version -%}
  Using API {{ api_version }} with key validation
{%- endif -%}
```

## Advanced Visitor Detection

### GeoIP-Based Content Personalization
```liquid
{%- assign visitor_country = context.visitor.country -%}
{%- assign visitor_timezone = context.visitor.timezone -%}

{%- case visitor_country -%}
  {%- when 'US' -%}
    {%- assign currency = 'USD' -%}
    {%- assign tax_rate = 0.08 -%}
  {%- when 'CA' -%}
    {%- assign currency = 'CAD' -%}
    {%- assign tax_rate = 0.05 -%}
  {%- when 'GB' -%}
    {%- assign currency = 'GBP' -%}
    {%- assign tax_rate = 0.20 -%}
  {%- else -%}
    {%- assign currency = 'USD' -%}
    {%- assign tax_rate = 0.00 -%}
{%- endcase -%}
```

### Location-Based Language Selection
```liquid
{%- assign visitor_country = context.visitor.country -%}
{%- assign user_language = context.language -%}

{%- case visitor_country -%}
  {%- when 'ES' -%}
    {%- assign default_lang = 'es' -%}
  {%- when 'FR' -%}
    {%- assign default_lang = 'fr' -%}
  {%- when 'DE' -%}
    {%- assign default_lang = 'de' -%}
  {%- else -%}
    {%- assign default_lang = 'en' -%}
{%- endcase -%}

{%- assign active_lang = user_language | default: default_lang -%}
```

## Performance Optimization

### Lazy Load Pattern
```liquid
{%- assign viewport = context.params.view | default: 'initial' -%}

{%- if viewport == 'initial' -%}
  {%- assign items = context.exports.items | array_first: 20 -%}
{%- elsif viewport == 'paginated' -%}
  {%- assign page = context.params.page | default: 1 | plus: 0 -%}
  {%- assign offset = page | minus: 1 | times: 20 -%}
  {%- assign items = context.exports.items | array_first: 20 -%}
{%- else -%}
  {%- assign items = context.exports.items -%}
{%- endif -%}
```

### Conditional Export Usage
```liquid
{%- comment %} Only query heavy data when needed {%- endcomment %}
{%- if context.params.detailed_view -%}
  {%- assign detailed_data = context.exports.detailed_data -%}
{%- else -%}
  {%- assign detailed_data = nil -%}
{%- endif -%}
```

## See Also

- [Objects Configuration](configuration.md)
- [Objects API Reference](api.md)
- [Objects & Patterns](patterns.md)
- [Common Gotchas](gotchas.md)
