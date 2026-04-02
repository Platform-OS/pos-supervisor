# Liquid Flow Control: Configuration

Configuration and setup for control flow in platformOS Liquid templates.

## Overview

platformOS Liquid provides conditional flow control with strict syntax requirements. No parentheses, no boolean operators like && or ||, specific operator support, and space requirements around operators.

## Conditional Tags

### if/elsif/else/endif
Basic conditional execution:
```liquid
{%- if condition -%}
  True branch
{%- elsif other_condition -%}
  Alternative branch
{%- else -%}
  Default branch
{%- endif -%}
```

Multiple elsif allowed. Only one branch executes.

### unless/endunless
Negation conditional:
```liquid
{%- unless condition -%}
  Only if condition is false
{%- endunless -%}
```

No else/elsif with unless. Cleaner than `if not`.

### case/when/else/endcase
Multi-branch selection:
```liquid
{%- case variable -%}
  {%- when value1 -%}
    Branch 1
  {%- when value2, value3 -%}
    Branch 2 or 3
  {%- else -%}
    Default branch
{%- endcase -%}
```

Compact matching of multiple values per when.

## Supported Operators

### Comparison Operators
- `==` - Equal to
- `!=` or `<>` - Not equal (both forms work)
- `<` - Less than
- `<=` - Less than or equal
- `>` - Greater than
- `>=` - Greater than or equal

### String Operators
- `contains` - String contains substring
- No regex matching in conditions

### Boolean Operators
- `and` - Logical AND (evaluated left-to-right)
- `or` - Logical OR (evaluated left-to-right)

**Important:** No `not` operator, no parentheses, no `&&` or `||`.

## Truthiness Rules

### Truthy Values
- Any string (including empty string "")
- Any number
- Any array
- Any hash
- true boolean
- Any object

### Falsy Values
- nil (null)
- false boolean

**Critical:** Empty string "" is TRUTHY in platformOS Liquid!

## Operator Requirements

### Spacing Around Operators
```liquid
{%- if value == 5 -%}
{%- if name != 'John' -%}
{%- if age > 18 -%}
{%- if text contains 'word' -%}
```

Spaces REQUIRED before and after operators.

### No Parentheses
```liquid
{%- comment %} WRONG {%- endcomment %}
{%- if (x == 5) and (y > 3) -%}

{%- comment %} CORRECT {%- endcomment %}
{%- if x == 5 and y > 3 -%}
```

Parentheses not allowed in conditions.

### No Negation Operator
```liquid
{%- comment %} WRONG {%- endcomment %}
{%- if not active -%}

{%- comment %} CORRECT {%- endcomment %}
{%- unless active -%}
```

Use `unless` instead of `if not`.

## Logical Operator Precedence

### and vs or
Evaluated left-to-right (not traditional precedence):
```liquid
{%- comment %} (a == 1 and b == 2) or c == 3 {%- endcomment %}
{%- if a == 1 and b == 2 or c == 3 -%}
  This is misleading - use separate conditions
{%- endif -%}
```

For clarity, structure as separate conditions.

## Variable Types in Conditions

### String Comparison
```liquid
{%- assign name = 'John' -%}
{%- if name == 'John' -%}
  Match
{%- endif -%}
```

Case-sensitive exact match.

### Number Comparison
```liquid
{%- assign age = 30 -%}
{%- if age > 18 -%}
  Adult
{%- endif -%}
```

Numeric comparison (not string).

### Array/Hash Existence
```liquid
{%- if items -%}
  {%- comment %} True if array/hash exists and has items {%- endcomment %}
{%- endif -%}
```

Truthy if non-empty collection.

### contains Operator
```liquid
{%- assign text = 'Hello World' -%}
{%- if text contains 'World' -%}
  Found
{%- endif -%}
```

Case-sensitive substring search.

## Nil and False Handling

### Nil Detection
```liquid
{%- if variable == nil -%}
  Variable is nil
{%- endif -%}
```

Nil is falsy, equals only nil.

### False Detection
```liquid
{%- if variable == false -%}
  Variable is false
{%- endif -%}
```

False is falsy, equals only false.

### Nil vs False vs Empty String
```liquid
{%- assign var_nil = nil -%}
{%- assign var_false = false -%}
{%- assign var_empty = '' -%}

{%- if var_nil -%}false{%- else -%}nil is falsy{%- endif -%}
{%- if var_false -%}false{%- else -%}false is falsy{%- endif -%}
{%- if var_empty -%}empty string is truthy{%- endif -%}
```

## Best Practices

1. **Use spaces around operators** - Always required, improves readability
2. **Avoid complex boolean logic** - Break into multiple conditions
3. **Prefer unless over if not** - Clearer intent, simpler syntax
4. **Check for nil explicitly** - Don't rely on falsy behavior
5. **Remember empty string is truthy** - Common mistake with string checks
6. **Case expressions for multiple values** - Cleaner than chained if/elsif
7. **Structure conditions clearly** - Each condition should be obvious
8. **Test edge cases** - Especially nil, false, and empty string

## Common Patterns

### Safe String Comparison
```liquid
{%- if user.email != '' and user.email -%}
  Email: {{ user.email }}
{%- endif -%}
```

### Range Checking
```liquid
{%- if age > 18 and age < 65 -%}
  Working age
{%- endif -%}
```

### Multiple Conditions with OR
```liquid
{%- if status == 'active' or status == 'pending' -%}
  Show content
{%- endif -%}
```

## See Also

- [Flow Control API Reference](api.md)
- [Flow Control Patterns & Examples](patterns.md)
- [Common Gotchas](gotchas.md)
- [Advanced Techniques](advanced.md)
