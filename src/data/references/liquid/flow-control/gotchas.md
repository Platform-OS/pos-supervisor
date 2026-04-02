# Liquid Flow Control: Common Gotchas

Common pitfalls and how to avoid them when using platformOS Liquid flow control.

## Operator Gotchas

### Problem: Using Parentheses in Conditions
```liquid
{%- comment %} WRONG - Parentheses not allowed {%- endcomment %}
{%- if (x == 5) -%}
{%- if (a and b) or c -%}

{%- comment %} CORRECT {%- endcomment %}
{%- if x == 5 -%}
{%- if a and b or c -%}
```

**Solution:** Remove all parentheses from conditions.

### Problem: Using && or || Operators
```liquid
{%- comment %} WRONG {%- endcomment %}
{%- if status == 'active' && user.verified -%}

{%- comment %} CORRECT {%- endcomment %}
{%- if status == 'active' and user.verified -%}
```

**Solution:** Use `and`/`or` instead of `&&`/`||`.

### Problem: Using NOT Operator
```liquid
{%- comment %} WRONG {%- endcomment %}
{%- if not active -%}

{%- comment %} CORRECT {%- endcomment %}
{%- unless active -%}
```

**Solution:** Use `unless` instead of `if not`.

### Problem: Forgetting Spaces Around Operators
```liquid
{%- comment %} WRONG - May not work {%- endcomment %}
{%- if x==5 -%}
{%- if name!='John' -%}
{%- if age>18 -%}

{%- comment %} CORRECT {%- endcomment %}
{%- if x == 5 -%}
{%- if name != 'John' -%}
{%- if age > 18 -%}
```

**Solution:** Always include spaces around operators.

## Truthiness Gotchas

### Problem: Empty String is Truthy
```liquid
{%- assign empty = "" -%}
{%- if empty -%}
  {%- assign x = 'empty string is truthy' -%}
{%- endif -%}
```

**Why it's a problem:**
- Different from most programming languages
- Empty arrays/hashes also truthy

**Solution:** Check explicitly:
```liquid
{%- if empty != "" -%}
{%- if empty and empty != "" -%}
```

### Problem: Zero is Truthy
```liquid
{%- assign count = 0 -%}
{%- if count -%}
  {%- comment %} Zero IS truthy {%- endcomment %}
{%- endif -%}
```

**Solution:** Check explicitly:
```liquid
{%- if count > 0 -%}
{%- if count != 0 -%}
```

### Problem: Nil vs False vs Empty String
```liquid
{%- if nil -%}{%- else -%}nil is falsy{%- endif -%}
{%- if false -%}{%- else -%}false is falsy{%- endif -%}
{%- if "" -%}empty string is truthy{%- endif -%}
```

**Solution:** Be explicit about what you're checking:
```liquid
{%- if variable == nil -%}
  Nil
{%- elsif variable == false -%}
  False
{%- elsif variable == "" -%}
  Empty string
{%- else -%}
  Truthy
{%- endif -%}
```

## Operator Precedence Gotchas

### Problem: and/or Evaluation Order
```liquid
{%- if a == 1 and b == 2 or c == 3 -%}
  {%- comment %} Evaluates: (a == 1 AND b == 2) OR c == 3 {%- endcomment %}
{%- endif -%}
```

**Solution:** Restructure for clarity:
```liquid
{%- if a == 1 and b == 2 -%}
  First condition
{%- elsif c == 3 -%}
  Second condition
{%- endif -%}
```

### Problem: Complex Boolean Logic
```liquid
{%- if user.premium or user.trial and user.trial_active -%}
  {%- comment %} Confusing: which condition takes priority? {%- endcomment %}
{%- endif -%}
```

**Solution:** Use nested if or rewrite:
```liquid
{%- if user.premium -%}
  Premium access
{%- elsif user.trial and user.trial_active -%}
  Trial access
{%- endif -%}
```

## Comparison Gotchas

### Problem: String vs Number Comparison
```liquid
{%- assign age = "30" -%}
{%- if age > 18 -%}
  {%- comment %} Might not work as expected (string comparison) {%- endcomment %}
{%- endif -%}
```

**Solution:** Convert to number:
```liquid
{%- assign age = "30" | plus: 0 -%}
{%- if age > 18 -%}
```

### Problem: Case Sensitivity
```liquid
{%- if status == "Active" -%}
  {%- comment %} Won't match "active" or "ACTIVE" {%- endcomment %}
{%- endif -%}
```

**Solution:** Normalize case:
```liquid
{%- assign status_lower = status | downcase -%}
{%- if status_lower == "active" -%}
```

### Problem: contains is Case-Sensitive
```liquid
{%- if text contains "Word" -%}
  {%- comment %} Won't find "word" or "WORD" {%- endcomment %}
{%- endif -%}
```

**Solution:** Normalize before checking:
```liquid
{%- assign text_lower = text | downcase -%}
{%- if text_lower contains "word" -%}
```

## Scope and Variable Gotchas

### Problem: Variable Assignment in Conditional
```liquid
{%- if condition -%}
  {%- assign result = 'true' -%}
{%- else -%}
  {%- assign result = 'false' -%}
{%- endif -%}
{{ result }}
{%- comment %} Result is always available after if {%- endcomment %}
```

**Solution:** Initialize before conditional:
```liquid
{%- assign result = 'default' -%}
{%- if condition -%}
  {%- assign result = 'true' -%}
{%- endif -%}
```

## case Statement Gotchas

### Problem: No Fall-Through in case
```liquid
{%- case x -%}
  {%- when 1 -%}
    Value 1
  {%- when 2 -%}
    Value 2
  {%- comment %} No fall-through like C-style switch {%- endcomment %}
{%- endcase -%}
```

**Solution:** Use multiple values in when:
```liquid
{%- case x -%}
  {%- when 1, 2 -%}
    Value 1 or 2
  {%- when 3 -%}
    Value 3
{%- endcase -%}
```

### Problem: String vs Number in case
```liquid
{%- assign status = "1" -%}
{%- case status -%}
  {%- when 1 -%}
    One (number)
  {%- when "1" -%}
    One (string)
{%- endcase -%}
```

**Solution:** Normalize type before case:
```liquid
{%- assign status = "1" | plus: 0 -%}
{%- case status -%}
  {%- when 1 -%}
    One
{%- endcase -%}
```

## Nil and False Gotchas

### Problem: Testing for Nil
```liquid
{%- if variable -%}
  {%- comment %} False if nil OR false {%- endcomment %}
{%- endif -%}
```

**Solution:** Be explicit:
```liquid
{%- if variable == nil -%}
  Nil
{%- elsif variable == false -%}
  False
{%- else -%}
  Truthy
{%- endif -%}
```

### Problem: Nil Check with Contains
```liquid
{%- if items contains value -%}
  {%- comment %} Fails if items is nil {%- endcomment %}
{%- endif -%}
```

**Solution:** Check for nil first:
```liquid
{%- if items and items contains value -%}
  Found
{%- endif -%}
```

## unless Gotchas

### Problem: Using elsif with unless
```liquid
{%- comment %} WRONG - unless doesn't support elsif {%- endcomment %}
{%- unless condition -%}
{%- elsif other -%}
{%- endunless -%}

{%- comment %} CORRECT - Use if with negation {%- endcomment %}
{%- if condition -%}
{%- elsif other -%}
{%- endif -%}
```

**Solution:** Use if/elsif/else instead of unless with elsif.

### Problem: Nested unless
```liquid
{%- unless outer -%}
  {%- unless inner -%}
    {%- comment %} Works but confusing {%- endcomment %}
  {%- endunless -%}
{%- endunless -%}
```

**Solution:** Use if with and:
```liquid
{%- if outer == false and inner == false -%}
  Both false
{%- endif -%}
```

## Whitespace Gotchas

### Problem: Whitespace in Output
```liquid
{%- if condition %}
  Content with space after condition
{% endif -%}
```

**Solution:** Control whitespace consistently:
```liquid
{%- if condition -%}
  Content without extra space
{%- endif -%}
```

## See Also

- [Flow Control Configuration](configuration.md)
- [Flow Control API Reference](api.md)
- [Flow Control Patterns & Examples](patterns.md)
- [Advanced Techniques](advanced.md)
