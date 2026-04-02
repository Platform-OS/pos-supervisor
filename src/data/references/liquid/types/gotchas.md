# Liquid Types -- Gotchas and Common Errors

## Common Errors

### "Empty string passes my if check"

**Cause:** Empty strings `""` are truthy in Liquid. Only `nil` and `false` are falsy.

**Solution:** Use `!= blank` instead of a bare truthiness check:

```liquid
{% comment %} WRONG {% endcomment %}
{% if user.name %}show name{% endif %}

{% comment %} CORRECT {% endcomment %}
{% if user.name != blank %}show name{% endif %}
```

### "parse_json gives invalid JSON error"

**Cause:** The `{% parse_json %}` tag is deprecated. If you are still using it, interpolated string values containing unescaped quotes break the JSON structure.

**Solution:** Use `{% assign %}` with hash literals instead. Variable references are used directly -- no quoting or `| json` filter needed:

```liquid
{% comment %} DEPRECATED: parse_json tag {% endcomment %}
{% parse_json obj %}{ "name": {{ name | json }} }{% endparse_json %}

{% comment %} MODERN: assign with hash literal {% endcomment %}
{% assign obj = { "name": name } %}
```

### "Comparing number from URL param fails"

**Cause:** All `context.params` values are strings. `"5" > 3` does not behave as expected.

**Solution:** Convert to number first with `| plus: 0`:

```liquid
{% assign page = context.params.page | plus: 0 %}
{% if page > 1 %}show prev link{% endif %}
```

### "contains does not find my number in the array"

**Cause:** The `contains` operator performs string comparison. It will not match numeric array elements.

**Solution:** Use `array_any` for non-string matching:

```liquid
{% comment %} WRONG: contains uses string comparison {% endcomment %}
{% if ids contains 5 %}found{% endif %}

{% comment %} CORRECT: array_any handles type matching {% endcomment %}
{% assign found = ids | array_any: 5 %}
{% if found %}found{% endif %}
```

### "Zero evaluates as truthy in my conditional"

**Cause:** `0` is truthy in Liquid. This differs from most programming languages.

**Solution:** Explicitly compare against zero:

```liquid
{% comment %} WRONG: 0 is truthy, this always passes for numbers {% endcomment %}
{% if count %}has items{% endif %}

{% comment %} CORRECT: explicit comparison {% endcomment %}
{% if count != 0 %}has items{% endif %}
{% if count > 0 %}has items{% endif %}
```

### "Boolean from hash literal acts like a string"

**Cause:** Using quotes around `true`/`false` creates strings, not booleans.

**Solution:** Do not quote boolean or number values:

```liquid
{% comment %} WRONG: "true" is a string {% endcomment %}
{% assign config = { "enabled": "true" } %}

{% comment %} CORRECT: true without quotes is boolean {% endcomment %}
{% assign config = { "enabled": true } %}
```

### "Assigning to a hash key does not create a new hash"

**Cause:** `{% assign hash["key"] = ... %}` modifies an existing hash. If the variable is nil, it fails silently. Note: `{% hash_assign %}` is deprecated -- use `{% assign %}` instead.

**Solution:** Initialize the hash first:

```liquid
{% assign my_hash = {} %}
{% assign my_hash["key"] = "value" %}
```

### "My array from split contains empty strings"

**Cause:** Splitting a string with leading/trailing delimiters or consecutive delimiters produces empty string elements.

**Solution:** Use `compact` or manually filter:

```liquid
{% assign items = ",a,,b,c," | split: "," | compact %}
{% comment %} Note: compact removes nil, not empty strings. Use where or manual filtering {% endcomment %}
```

### "Accessing a nested hash key returns nil unexpectedly"

**Cause:** An intermediate key in the chain is nil, so the entire chain returns nil.

**Solution:** Check each level or use `default`:

```liquid
{% assign value = data.level1.level2.level3 | default: "fallback" %}
```

## Limits

| Constraint | Limit | Notes |
|------------|-------|-------|
| String size | No hard limit | Very large strings may slow rendering |
| Number range | Standard float range | Platform dependent, no BigInt |
| Hash nesting | No hard limit | Deep nesting impacts readability |
| Array size | No hard limit | Large arrays slow iteration |
| Hash/array literals | Must use valid syntax | Trailing commas not allowed |
| Integer division | Truncates to int | Use `times: 1.0` for float division |
| contains operator | String comparison only | Use `array_any` for other types |

## See Also

- [Types Overview](README.md) -- truthiness rules and type basics
- [Types Patterns](patterns.md) -- correct patterns for common tasks
- [Types Advanced](advanced.md) -- edge cases and deep dives
- [Variables Gotchas](../variables/gotchas.md) -- variable scoping pitfalls
