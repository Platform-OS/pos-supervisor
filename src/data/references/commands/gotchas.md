# Commands -- Gotchas and Troubleshooting

## Common Errors

### "Template not found: modules/core/commands/build"

**Cause:** The `pos-module-core` module is not installed or not synced.

**Solution:** Run `pos-cli modules install core` and deploy or sync.

### "Liquid error: undefined variable 'object'"

**Cause:** The variable name in the `assign` tag does not match what is passed to `build`. Or the `{% function %}` assignment was skipped.

**Solution:** Ensure `assign` creates a variable called `object` and the build call uses `object: object`.

### "app.errors.blank" on a field that has a value

**Cause:** The value was not properly referenced in the hash literal. Using a quoted string literal instead of a variable reference means the actual variable value is not included.

**Solution:** Use `assign` with hash literals and reference variables directly (without quotes). The deprecated `parse_json` tag required `{{ variable | json }}` for safe interpolation, but modern hash literals take variable names directly.

```liquid
{% comment %} WRONG -- string literal instead of variable reference {% endcomment %}
{% assign object = { "title": "title" } %}

{% comment %} CORRECT -- direct variable reference {% endcomment %}
{% assign object = { "title": title } %}
```

### "record_create returned nil" or empty result after execute

**Cause:** The `selection` parameter does not match the top-level field in the GraphQL mutation response.

**Solution:** If your mutation uses `record_create(...)`, the selection must be `'record_create'`. If it uses `record_update(...)`, use `'record_update'`. Check the `.graphql` file.

### "Validation passed but record was not created"

**Cause:** The `{% if object.valid %}` guard around the execute stage is missing.

**Solution:** Always wrap the execute call in an `{% if object.valid %}` block. Without it, the execute call may silently fail or never run.

### "Cannot read property 'valid' of null"

**Cause:** The command file does not include `{% return object %}` at the end, so the caller receives `nil`.

**Solution:** Every command must end with `{% return object %}`.

### "Mutation variable $object is not defined"

**Cause:** The GraphQL mutation file expects `$object` but the execute helper is not passing it correctly, or the mutation signature is wrong.

**Solution:** Ensure the mutation declares `mutation name($object: HashObject!)` and references `$object.field_name` in property values.

## Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Validators per check call | No hard limit | Keep reasonable for performance (under 50) |
| Nested command depth | No hard limit | Avoid deep nesting; prefer events for decoupling |
| Object properties | No hard limit | Properties must match schema table fields for persistence |
| Background job max_attempts | 1-5 | Commands run as background jobs inherit this limit |
| GraphQL mutation timeout | Platform default | Long-running mutations may time out |
| Uniqueness validator | Requires table option | Queries the database; slower than other validators |

## Troubleshooting Flowchart

```
Command returns unexpected result
├── result is nil
│   └── Missing {% return object %} at end of command
├── result.valid is false unexpectedly
│   ├── Check result.errors for field names and messages
│   ├── Is value present but errors say "blank"?
│   │   └── Used string literal instead of variable reference in assign
│   ├── Is uniqueness failing?
│   │   └── Check table option matches schema table name
│   └── Is format failing?
│       └── Verify regex pattern in validator options
├── result.valid is true but no record created
│   ├── Missing {% if object.valid %} guard around execute
│   ├── Wrong mutation_name (file not found)
│   └── Wrong selection (does not match mutation response field)
├── result has no id after execute
│   ├── Mutation .graphql file missing id in selection set
│   └── selection parameter mismatch
└── "Template not found" error
    ├── pos-module-core not installed
    ├── Command path typo in {% function %} call
    └── File in wrong directory (must be app/lib/commands/)
```

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- Correct file layout
- [api.md](api.md) -- Helper signatures and validator details
- [patterns.md](patterns.md) -- Working examples to compare against
- [advanced.md](advanced.md) -- Edge cases and advanced troubleshooting
