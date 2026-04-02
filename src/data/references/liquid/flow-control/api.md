# Liquid Flow Control: API Reference

Complete API reference for control flow tags in platformOS Liquid.

## if/elsif/else/endif API

### Basic Syntax
```liquid
{%- if condition -%}
  Content executes if condition is truthy
{%- endif -%}
```

### With elsif
```liquid
{%- if first_condition -%}
  Executes if first_condition truthy
{%- elsif second_condition -%}
  Executes if first false, second truthy
{%- endif -%}
```

Multiple elsif branches allowed:
```liquid
{%- if x == 1 -%}
  One
{%- elsif x == 2 -%}
  Two
{%- elsif x == 3 -%}
  Three
{%- elsif x == 4 -%}
  Four
{%- endif -%}
```

### With else
```liquid
{%- if condition -%}
  True branch
{%- else -%}
  Default branch
{%- endif -%}
```

### Full if/elsif/else
```liquid
{%- if condition1 -%}
  Branch 1
{%- elsif condition2 -%}
  Branch 2
{%- elsif condition3 -%}
  Branch 3
{%- else -%}
  Default
{%- endif -%}
```

## unless/endunless API

### Basic Syntax
```liquid
{%- unless condition -%}
  Content executes if condition is falsy
{%- endunless -%}
```

Equivalent to `if not condition`.

### With else
```liquid
{%- unless active -%}
  Inactive
{%- else -%}
  Active
{%- endunless -%}
```

No elsif with unless.

## case/when/else/endcase API

### Basic Syntax
```liquid
{%- case variable -%}
  {%- when value -%}
    Executes if variable == value
{%- endcase -%}
```

### Multiple when Branches
```liquid
{%- case status -%}
  {%- when 'pending' -%}
    Waiting
  {%- when 'approved' -%}
    Approved
  {%- when 'rejected' -%}
    Rejected
{%- endcase -%}
```

### Multiple Values per when
```liquid
{%- case priority -%}
  {%- when 'critical', 'high' -%}
    Urgent
  {%- when 'medium' -%}
    Standard
  {%- when 'low', 'minimal' -%}
    Later
{%- endcase -%}
```

Comma-separated values in single when.

### With else
```liquid
{%- case day -%}
  {%- when 'Monday' -%}
    Start of week
  {%- when 'Friday' -%}
    End of work week
  {%- else -%}
    Regular day
{%- endcase -%}
```

## Comparison Operators API

### Equality (==)
```liquid
{%- if user.name == 'John' -%}
{%- if count == 5 -%}
{%- if active == true -%}
```

Exact equality check.

### Inequality (!= and <>)
```liquid
{%- if status != 'inactive' -%}
{%- if role <> 'guest' -%}
```

Both forms equivalent. `!=` more common.

### Less Than (<)
```liquid
{%- if age < 18 -%}
{%- if stock < 10 -%}
```

Numeric comparison.

### Less Than or Equal (<=)
```liquid
{%- if price <= 100 -%}
{%- if level <= 5 -%}
```

### Greater Than (>)
```liquid
{%- if score > 100 -%}
{%- if age > 21 -%}
```

### Greater Than or Equal (>=)
```liquid
{%- if score >= 50 -%}
{%- if inventory >= 100 -%}
```

## String Operator API

### contains
```liquid
{%- if text contains 'keyword' -%}
  Found
{%- endif -%}
```

Case-sensitive substring search. Works on strings.

### contains with Variables
```liquid
{%- assign needle = 'world' -%}
{%- if text contains needle -%}
  Found
{%- endif -%}
```

### contains with Array
```liquid
{%- assign items = 'a,b,c' | split: ',' -%}
{%- if items contains 'b' -%}
  Found
{%- endif -%}
```

## Boolean Operator API

### and (Logical AND)
```liquid
{%- if condition1 and condition2 -%}
  Both must be true
{%- endif -%}
```

Evaluates left-to-right. Both conditions must be truthy.

### or (Logical OR)
```liquid
{%- if condition1 or condition2 -%}
  Either can be true
{%- endif -%}
```

Evaluates left-to-right. At least one must be truthy.

### Combining and/or
```liquid
{%- if a == 1 and b == 2 or c == 3 -%}
  (a == 1 AND b == 2) OR c == 3
{%- endif -%}
```

Evaluates left-to-right, no precedence.

## Inline Conditionals API

### Using Logical Operators in Expressions
```liquid
{{ condition and 'yes' or 'no' }}
```

Not recommended - use if/else instead.

## Type Checking in Conditions

### nil Check
```liquid
{%- if variable == nil -%}
  Nil
{%- endif -%}
```

### Empty Collection Check
```liquid
{%- if items.size > 0 -%}
  Has items
{%- endif -%}
```

### Boolean Check
```liquid
{%- if is_active == true -%}
  Active
{%- endif -%}
```

Or simply:
```liquid
{%- if is_active -%}
  Active
{%- endif -%}
```

## Truthiness Rules in Conditions

### Truthy Evaluation
```liquid
{%- if '' -%}
  Empty string IS truthy
{%- endif -%}

{%- if 0 -%}
  Zero IS truthy
{%- endif -%}

{%- if false -%}
  {%- comment %} This doesn't execute {%- endcomment %}
{%- endif -%}

{%- if nil -%}
  {%- comment %} This doesn't execute {%- endcomment %}
{%- endif -%}
```

## Whitespace Control

### Stripping Whitespace
```liquid
{%- if condition -%}
  Content without surrounding whitespace
{%- endif -%}
```

Use `{%-` and `-%}` to strip whitespace.

### Preserving Whitespace
```liquid
{% if condition %}
  Content with surrounding whitespace
{% endif %}
```

Use `{%` and `%}` to keep whitespace.

## See Also

- [Flow Control Configuration](configuration.md)
- [Flow Control Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
