# Partials -- API Reference

## Invocation Tags

### render

Renders a partial as a template. Output is inserted inline.

```liquid
{% render 'path/to/partial' %}
{% render 'path/to/partial', var1: value1, var2: value2 %}
```

- Only explicitly passed variables are accessible inside the partial
- The partial's output replaces the render tag in the caller
- Cannot access caller's local variables

### function

Calls a partial as a function. The partial must `{% return %}` a value.

```liquid
{% function result = 'path/to/partial', arg1: val1, arg2: val2 %}
```

Also supports bracket notation, dot notation, and array append to write results into nested structures:

```liquid
{% comment %} Store result in a nested key {% endcomment %}
{% function data['product'] = 'products/find', id: context.params.id %}

{% comment %} Dot notation {% endcomment %}
{% function ctx.profile = 'modules/user/queries/user/current' %}

{% comment %} Append result to array {% endcomment %}
{% function items << 'products/fetch_item', id: 1 %}
```

- Only explicitly passed variables are accessible
- The partial MUST use `{% return value %}` to return data
- If no return is executed, result is nil

### return

Returns a value from a function-invoked partial to the caller.

```liquid
{% assign output = items | array_map: 'title' %}
{% return output %}
```

- Only meaningful when partial is called via `{% function %}`
- Execution stops at the return tag
- Can return any type: string, number, boolean, hash, array, nil

### export

Makes a variable available via `context.exports` after the partial executes.

```liquid
{% export computed_value, namespace: 'calculator' %}
{% export items, totals, namespace: 'cart' %}
```

- Namespace is required
- Multiple variables can be exported in one tag
- Access via `{{ context.exports.calculator.computed_value }}`

## Standard Liquid Tags in Partials

All standard Liquid tags work inside partials:

| Tag | Usage |
|-----|-------|
| `assign` | Create local variables |
| `capture` | Capture block output as string |
| `assign` (extended) | Create hashes/arrays from literals, set nested values with dot/bracket notation |
| `if/elsif/else` | Conditionals |
| `for` | Loops |
| `render` | Nest partials (partials can render other partials) |
| `function` | Call other function partials |
| `log` | Debug logging |
| `cache` | Fragment caching |

## Forbidden in Partials

| Tag | Why |
|-----|-----|
| `{% graphql %}` | Data fetching belongs in pages only |
| `{% redirect_to %}` | HTTP control belongs in pages only |
| `{% sign_in %}` | Auth actions belong in pages only |
| `{% response_status %}` | HTTP control belongs in pages only |

## See Also

- [Partials Overview](README.md)
- [configuration.md](configuration.md) — file structure and naming
- [patterns.md](patterns.md) — common workflows
- [Liquid Tags](../liquid/tags/README.md) — full tag reference
