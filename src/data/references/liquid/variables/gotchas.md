# Liquid Variables: Common Gotchas

Common pitfalls and how to avoid them when using platformOS Liquid variables.

## Scope Gotchas

### Problem: Variables Don't Cross Partial Boundaries
```liquid
{%- comment %} Parent template {%- endcomment %}
{%- assign greeting = 'Hello' -%}
{%- include_partial 'child' -%}

{%- comment %} Child partial {%- endcomment %}
{{ greeting }}
{%- comment %} UNDEFINED - greeting doesn't exist in child {%- endcomment %}
```

**Solution:** Pass as parameter:
```liquid
{%- comment %} Parent {%- endcomment %}
{%- include_partial 'child', greeting: greeting -%}

{%- comment %} Child - greeting is now available {%- endcomment %}
{{ greeting }}
```

### Problem: Loop Variables Leak Out
```liquid
{%- for item in items -%}
  {%- assign current = item -%}
{%- endfor -%}
{{ current }}
{%- comment %} Still has last value from loop {%- endcomment %}
```

**Solution:** Reset after loop:
```liquid
{%- for item in items -%}
  {%- assign current = item -%}
{%- endfor -%}
{%- assign current = nil -%}
```

### Problem: Nested Partial Variables Lost
```liquid
{%- comment %} A includes B, B includes C {%- endcomment %}
{%- comment %} Variables in C not automatically in A {%- endcomment %}
```

**Solution:** Use export/return at each level:
```liquid
{%- comment %} C {%- endcomment %}
{%- export result = calculated -%}

{%- comment %} B {%- endcomment %}
{%- include_partial 'c' -%}
{%- export result = context.exports.result -%}

{%- comment %} A {%- endcomment %}
{%- include_partial 'b' -%}
{{ context.exports.result }}
```

## Assignment Gotchas

### Problem: Assigning Nil
```liquid
{%- assign value = nil -%}
{{ value }}
{%- comment %} Empty output, but nil persists {%- endcomment %}
```

**Solution:** Use unset or just don't reference:
```liquid
{%- assign value = nil -%}
{%- if value -%}
  Has value
{%- else -%}
  Nil or empty
{%- endif -%}
```

### Problem: Overwriting Without Intent
```liquid
{%- assign item = 'first' -%}
{%- if condition -%}
  {%- assign item = 'second' -%}
{%- endif -%}
{{ item }}
{%- comment %} Always 'second' in if block, may be confusing {%- endcomment %}
```

**Solution:** Use different variables or clear names:
```liquid
{%- assign original_item = 'first' -%}
{%- assign result_item = original_item -%}
{%- if condition -%}
  {%- assign result_item = 'second' -%}
{%- endif -%}
{{ result_item }}
```

### Problem: Reassigning in Loop
```liquid
{%- for item in items -%}
  {%- assign current_item = item -%}
{%- endfor -%}
{%- comment %} current_item only has last item {%- endcomment %}
```

**Solution:** Use array instead of reassigning:
```liquid
{%- assign all_items = '' | split: '' -%}
{%- for item in items -%}
  {%- assign all_items = all_items | array_add: item -%}
{%- endfor -%}
```

## Capture Gotchas

### Problem: Extra Whitespace in Capture
```liquid
{%- capture message -%}
  Hello
  World
{%- endcapture -%}

{{ message }}
{%- comment %} May have unwanted spaces/newlines {%- endcomment %}
```

**Solution:** Use `{%- -%}` for tight control:
```liquid
{%- capture message -%}
Hello
World
{%- endcapture -%}
```

### Problem: Capture Variable Scope
```liquid
{%- capture output -%}
  {{ non_existent_var }}
{%- endcapture -%}
{{ output }}
{%- comment %} Captured empty string {%- endcomment %}
```

**Solution:** Ensure variables exist before capturing:
```liquid
{%- if variable_exists -%}
  {%- capture output -%}
    {{ variable_exists }}
  {%- endcapture -%}
{%- else -%}
  {%- assign output = 'default' -%}
{%- endif -%}
```

## JSON Gotchas

### Problem: Missing | json Filter
```liquid
<script>
  var data = {{ object }};
{%- comment %} May not be valid JSON {%- endcomment %}
</script>
```

**Solution:** Always use | json:
```liquid
<script>
  var data = {{ object | json }};
{%- comment %} Valid JSON guaranteed {%- endcomment %}
</script>
```

### Problem: parse_json Filter with Invalid JSON
```liquid
{%- assign data = invalid_json | parse_json -%}
{%- comment %} Returns nil silently {%- endcomment %}
```

**Solution:** Validate first:
```liquid
{%- if json_string | is_json_valid -%}
  {%- assign data = json_string | parse_json -%}
{%- else -%}
  {%- assign data = {} -%}
{%- endif -%}
```

### Problem: Deprecated parse_json Tag with Interpolation
The `parse_json` tag is deprecated. It was error-prone because string interpolation could break JSON syntax:
```liquid
{%- comment %} DEPRECATED - do not use {%- endcomment %}
{%- parse_json data -%}
{
  "user_id": {{ user.id }},
  "timestamp": "{{ now }}"
}
{%- endparse_json -%}
```

**Solution:** Use `assign` with hash literals and direct variable references:
```liquid
{%- assign data = { "user_id": user.id, "timestamp": now } -%}
```

## Type Gotchas

### Problem: String vs Number
```liquid
{%- assign age = "30" -%}
{%- assign next_age = age | plus: 1 -%}
{%- comment %} Works but may have unexpected behavior {%- endcomment %}
```

**Solution:** Convert explicitly:
```liquid
{%- assign age = "30" | plus: 0 -%}
{%- assign next_age = age | plus: 1 -%}
```

### Problem: Empty String is Truthy
```liquid
{%- assign empty = "" -%}
{%- if empty -%}
  {%- assign value = 'empty string is truthy' -%}
{%- endif -%}
```

**Solution:** Check explicitly:
```liquid
{%- assign empty = "" -%}
{%- if empty == "" -%}
  Empty string
{%- endif -%}
```

### Problem: Array vs String Split
```liquid
{%- assign colors = "red,green,blue" -%}
{%- assign first = colors | first -%}
{%- comment %} Returns "r" not "red" {%- endcomment %}
```

**Solution:** Split first:
```liquid
{%- assign colors = "red,green,blue" | split: "," -%}
{%- assign first = colors | first -%}
```

## Hash and Array Gotchas

### Problem: Hash Key Assignment Doesn't Return Value

> **Note:** The `hash_assign` tag is deprecated. Use `assign` with bracket notation instead.

```liquid
{%- assign config['key'] = 'value' -%}
{{ config['key'] }}
{%- comment %} Works but assign with bracket notation returns nil {%- endcomment %}
```

**Solution:** Assign then reference:
```liquid
{%- assign config['key'] = 'value' -%}
{%- if config -%}
  {{ config['key'] }}
{%- endif -%}
```

### Problem: Array Index Type
```liquid
{%- assign items = array -%}
{%- assign index = "0" -%}
{{ items[index] }}
{%- comment %} May not work as string index {%- endcomment %}
```

**Solution:** Convert to number:
```liquid
{%- assign index = "0" | plus: 0 -%}
{{ items[index] }}
```

## increment/decrement Gotchas

### Problem: Scope of Counter
```liquid
{%- for i in (1..3) -%}
  {%- increment counter -%}
{%- endfor -%}
{{ increment counter }}
{%- comment %} Counter persists across loops {%- endcomment %}
```

**Solution:** Reset if needed:
```liquid
{%- assign counter = 0 -%}
{%- for i in (1..3) -%}
  {%- assign counter = counter | plus: 1 -%}
{%- endfor -%}
```

### Problem: No Decrement Below Zero
```liquid
{%- assign x = 0 -%}
{%- decrement x -%}
{%- comment %} Decrements to -1, no bounds checking {%- endcomment %}
```

**Solution:** Add bounds checking:
```liquid
{%- if counter > 0 -%}
  {%- decrement counter -%}
{%- endif -%}
```

## Export/Return Gotchas

### Problem: Export Not Returning Value
```liquid
{%- export result = calculation -%}
{{ result }}
{%- comment %} result still available in same template {%- endcomment %}
```

**Solution:** Export is for parent access only:
```liquid
{%- assign result = calculation -%}
{%- export result = result -%}
{%- comment %} Both work in same template {%- endcomment %}
```

### Problem: Multiple Returns in Partial
```liquid
{%- if condition1 -%}
  {%- return value1 -%}
{%- endif -%}
{%- if condition2 -%}
  {%- return value2 -%}
{%- endif -%}
{%- comment %} Only first return matters {%- endcomment %}
```

**Solution:** Use single return point:
```liquid
{%- if condition1 -%}
  {%- assign return_value = value1 -%}
{%- elsif condition2 -%}
  {%- assign return_value = value2 -%}
{%- else -%}
  {%- assign return_value = default_value -%}
{%- endif -%}
{%- return return_value -%}
```

## See Also

- [Variables Configuration](configuration.md)
- [Variables API Reference](api.md)
- [Variables Patterns & Examples](patterns.md)
- [Advanced Techniques](advanced.md)
