# Constants -- Gotchas & Troubleshooting

Common errors, limits, and debugging guidance for constants.

## Common Errors

### "context.constants.KEY returns blank"

**Cause:** The constant was never set on the current environment, or the name has a typo.

**Solution:** Run `pos-cli constants list ENVIRONMENT` to verify the constant exists. Check for case sensitivity -- `Api_Key` and `API_KEY` are different constants.

### "Constant value appears in page output"

**Cause:** You are outputting a constant directly in HTML without understanding the security implications, e.g., `{{ context.constants.STRIPE_SK_KEY }}` in a rendered template.

**Solution:** Never output secret key values in browser-visible HTML. Only use secret constants server-side (in GraphQL variables, API call headers). Public keys like `STRIPE_PK_KEY` are acceptable in client-facing output.

### "Cannot iterate over context.constants"

**Cause:** You tried to use `{% for %}` on `context.constants` or output `{{ context.constants }}`.

**Solution:** This is by design. Constants are not enumerable for security reasons. You must access each constant by its exact name: `{{ context.constants.SPECIFIC_KEY }}`.

### "Constant value is 'true' but if-check fails"

**Cause:** Comparing a string constant with a boolean: `if context.constants.FLAG == true`.

**Solution:** Constant values are always strings. Compare with the string `'true'`: `if context.constants.FLAG == 'true'`.

### "constant_set mutation returns error"

**Cause:** The GraphQL mutation is called with incorrect argument types or missing required fields.

**Solution:** Ensure both `name` and `value` arguments are provided as strings:
```graphql
mutation { constant_set(name: "KEY", value: "val") { name } }
```

### "Constants not available after deploy"

**Cause:** Constants are set per-environment, not per-deploy. A fresh deploy does not change constants.

**Solution:** Constants persist independently of code deployment. If you need to set constants on a new environment, do so via CLI or migration before relying on them.

### "Migration sets wrong constants in production"

**Cause:** A migration seeds constants without checking `context.environment`, applying staging values to production.

**Solution:** Always guard migration constant-setting with an environment check:
```liquid
{% if context.environment == 'staging' %}
  {% graphql _ = 'constants/set', name: 'KEY', value: 'staging_value' %}
{% endif %}
```

### "Secret key exposed in logs"

**Cause:** Using `{% log context.constants.SECRET %}` or logging an object that contains the constant value.

**Solution:** Avoid logging constant values. If you must log for debugging, use a placeholder: `{% log 'SECRET is set', type: 'debug' %}`.

## Limits

| Resource                       | Limit              | Notes                                          |
|--------------------------------|--------------------|-------------------------------------------------|
| Constant name length           | 255 characters     | Use concise UPPER_SNAKE_CASE names             |
| Constant value size            | 64 KB              | For larger config, use database records instead |
| Number of constants per env    | No hard limit      | Hundreds are fine; thousands may slow listing  |
| Value type                     | String only        | Parse JSON/numbers in Liquid as needed          |
| Access speed                   | Instant            | Constants are loaded with the request context   |
| Enumeration                    | Not supported      | Cannot iterate or list from Liquid              |

## Troubleshooting Flowchart

```
Constant not working?
├── Value is blank?
│   ├── Run pos-cli constants list ENV
│   ├── Check exact name (case-sensitive)
│   ├── Verify correct environment in .pos
│   └── Set with pos-cli constants set if missing
├── Value is wrong?
│   ├── Check you are on the right environment
│   ├── Overwrite with pos-cli constants set
│   └── Verify no migration is overwriting it
├── Feature flag not toggling?
│   ├── Compare with string 'true' not boolean
│   ├── Check spelling of constant name
│   └── Verify value was set on this environment
├── Secret appears in output?
│   ├── Remove {{ context.constants.SECRET }} from HTML
│   ├── Only use secrets in server-side operations
│   └── Check partials for accidental output
└── Migration seeding fails?
    ├── Verify GraphQL file exists at expected path
    ├── Check migration runs on correct environment
    └── Guard with context.environment check
```

## See Also

- [Constants Overview](README.md) -- introduction and key concepts
- [Constants Configuration](configuration.md) -- CLI and GraphQL setup
- [Constants API](api.md) -- runtime access patterns
- [Constants Advanced](advanced.md) -- edge cases and optimization
- [Configuration Gotchas](../configuration/gotchas.md) -- related environment config issues
