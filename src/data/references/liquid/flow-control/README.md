# Liquid Flow Control

## if / elsif / else / endif

```liquid
{% if user.age > 18 %}
  Welcome
{% elsif user.age > 13 %}
  Teen access
{% else %}
  Too young
{% endif %}
```

## unless / endunless

Reverse of `if`. Do NOT use `elsif` or `else` with `unless`.

```liquid
{% unless user.name == 'admin' %}
  Regular user
{% endunless %}
```

## Comparison Operators

| Operator | Description |
|----------|-------------|
| `==` | Equal |
| `!=` or `<>` | Not equal |
| `<` | Less than |
| `<=` | Less than or equal |
| `>` | Greater than |
| `>=` | Greater than or equal |
| `contains` | String/array includes value |

**Important**: Spaces around operators are REQUIRED.
```liquid
{% if rs.enabled == 'true' %}    ← CORRECT
{% if rs.enabled=='true' %}      ← WRONG (no spaces)
```

## Boolean Operators

| Operator | Description |
|----------|-------------|
| `and` | Both conditions true |
| `or` | Either condition true |

**`and` is evaluated before `or`**. Parentheses are NOT supported.

```liquid
{% if user.role == 'admin' and user.active == true %}
{% if status == 'draft' or status == 'review' %}
```

**`&&` and `||` do NOT work in Liquid.** Use `and` / `or`.

There is NO `not` operator. Use `unless` or `!= true`.

## case / when / endcase

```liquid
{% case template %}
  {% when 'product' %}
    {{ product.title }}
  {% when 'category' %}
    {{ category.name }}
  {% when 'home' or 'landing' %}
    Welcome page
  {% else %}
    Default content
{% endcase %}
```

## Truthiness

- **Truthy**: Everything except `nil` and `false` (including empty string `""` and `0`)
- **Falsy**: Only `nil` and `false`
- `empty` and `blank` are special comparison values for arrays

```liquid
{% if user.payments == empty %}
  No payments
{% endif %}

{% if value != blank %}
  Has value
{% endif %}
```
