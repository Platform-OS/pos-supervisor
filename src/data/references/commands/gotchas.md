# Commands -- Gotchas and Troubleshooting

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax). The most
> common cause of mysterious "partial not found" errors is calling a
> phantom `modules/core/commands/build` or `…/check` — see TOP GOTCHA below.

## TOP GOTCHA: `modules/core/commands/build` and `…/check` DO NOT EXIST

There is **no** `modules/core/commands/build.liquid` and **no**
`modules/core/commands/check.liquid`. The build/check phases are
**app-level** files inside your own command directory, e.g.
`app/lib/commands/products/create/build.liquid` and
`app/lib/commands/products/create/check.liquid`.

```liquid
{% comment %} ✗ FAILS — no such file in core 2.1.8+ {% endcomment %}
{% function object = 'modules/core/commands/build', object: params %}
{% function object = 'modules/core/commands/check',
   object: object, validators: validators %}

{% comment %} ✓ Correct — your own phase partials {% endcomment %}
{% function object = 'commands/products/create/build', object: params %}
{% function object = 'commands/products/create/check', object: object %}
```

Only `modules/core/commands/execute` runs at the module top level.
Generate the orchestrator + build + check trio with:

```bash
pos-cli generators run crud --resource <name> --include-views
```

## Common Errors

### "Template not found: modules/core/commands/build"

**Cause:** You're calling the phantom module-level build/check helpers
(see TOP GOTCHA). They don't exist regardless of whether the core
module is installed.

**Solution:** Replace with calls to your app's phase partials. The
build phase normalizes input; the check phase chains validator calls.
See [patterns.md](patterns.md) for the canonical layout.

### "Template not found: modules/core/validations/<name>"

**Cause:** Wrong path. The validators live at
`modules/core/lib/validations/<name>` — note the `lib/` segment.

**Solution:** Use the canonical path:

```liquid
{% function c = 'modules/core/lib/validations/presence',
   c: c, field_name: 'title', object: object %}
```

### "Template not found: modules/core/<anything>"

**Cause:** The `pos-module-core` module is not installed or not synced.

**Solution:** Run `pos-cli modules install core` and deploy or sync.

### "Validators don't fire" / `object.errors` always empty

**Cause:** The check phase isn't threading the contract `c` through
each validator call. Each validator returns the contract; you must
pass that result back as the next call's `c:` argument. At the end,
set `object.errors = c` and `object.valid = c == empty`.

**Solution:**

```liquid
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'title', object: object
  function c = 'modules/core/lib/validations/length',
    c: c, field_name: 'title', object: object, min: 3

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

### "Validator argument order seems wrong"

**Cause:** The argument order for every validator is
`c, field_name, object, [options...]` — matching the validator file's
`@param` order. Any other order may pass arguments to the wrong
parameter.

**Solution:** Always:

```liquid
{% function c = 'modules/core/lib/validations/<name>',
   c: c, field_name: '<field>', object: object, <options...> %}
```

### "Legacy validator names fail at function-resolve"

**Cause:** Older docs and code use names that were renamed in pos-cli
6.0.7+:

| Legacy            | Modern replacement                  |
|-------------------|-------------------------------------|
| `numericality`    | `number` (options `gt`/`gte`/`lt`/`lte`/`eq`/`ne`) |
| `format`          | `matches` (option `regexp`)         |
| `confirmation`    | `equal` with `to: '<other_field>'`  |
| `inclusion`       | `included` with `in: [...]`         |

**Solution:** Replace the validator name and options. The legacy names
are no longer aliased.

### "`validators: validators` array shape no longer works"

**Cause:** The legacy shape passed a JSON array of validator hashes to
a single check helper:

```liquid
{% comment %} ✗ Legacy — no longer supported {% endcomment %}
{% assign validators = [
  { "name": "presence", "property": "title" },
  { "name": "numericality", "property": "price" }
] %}
{% function object = 'modules/core/commands/check',
   object: object, validators: validators %}
```

**Solution:** Modern code chains individual validator calls — see
[patterns.md](patterns.md) for the canonical shape.

### "Liquid error: undefined variable 'object'"

**Cause:** The variable name in the `assign` tag doesn't match what
the orchestrator passes. Or the build call's assignment was skipped.

**Solution:** Ensure your orchestrator passes a `params` (or whatever
name) and your build phase declares it via `{% doc %}` `@param`. The
build phase typically returns an `object` for the check phase to
consume.

### "app.errors.blank" on a field that has a value

**Cause:** Value not properly referenced in the hash literal — using a
quoted string literal instead of a variable reference means the actual
variable value isn't passed in.

**Solution:** Hash literals take variable names directly, no quotes:

```liquid
{% comment %} WRONG -- string literal instead of variable reference {% endcomment %}
{% assign object = { "title": "title" } %}

{% comment %} CORRECT -- direct variable reference {% endcomment %}
{% assign object = { "title": title } %}
```

### "record_create returned nil" or empty result after execute

**Cause:** The `selection` parameter doesn't match the top-level field
in the GraphQL mutation response.

**Solution:** Match the mutation's top-level alias literally. CRUD
ops typically use `'record_create'`, `'record_update'`,
`'record_delete'`. Inspect the `.graphql` file to confirm.

### "Validation passed but record was not created"

**Cause:** Missing `{% if object.valid %}` guard around the execute
call, or missing `if object.valid == false / return object` short-
circuit before `execute`.

**Solution:** Always guard the execute call:

```liquid
{% liquid
  function object = 'commands/products/create/build', object: params
  function object = 'commands/products/create/check', object: object
  if object.valid == false
    return object
  endif

  function object = 'modules/core/commands/execute',
    mutation_name: 'products/create',
    selection: 'record_create',
    object: object

  return object
%}
```

### "Cannot read property 'valid' of null"

**Cause:** Command file doesn't include `{% return object %}` at the
end, so the caller receives `nil`.

**Solution:** Every command (orchestrator, build, check) must end with
`{% return <var> %}`.

### "Mutation variable $object is not defined"

**Cause:** GraphQL mutation file expects `$object` but the execute
helper isn't passing it correctly, or the mutation signature is wrong.

**Solution:** Ensure the mutation declares
`mutation name($object: HashObject!)` and references `$object.field_name`
in property values.

## Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Validators per check phase | No hard limit | Performance degrades beyond ~20 |
| Nested command depth | ~3 levels | Prefer events for decoupling beyond that |
| Object properties | No hard limit | Properties must match schema fields for persistence |
| Background job max_attempts | 1-5 | Commands run as background jobs inherit this limit |
| GraphQL mutation timeout | Platform default | Long mutations may time out |
| Uniqueness validator | Requires `table:` option | DB query — slower than other validators; place last in chain |

## Troubleshooting Flowchart

```
Command returns unexpected result
├── result is nil
│   └── Missing {% return object %} at end of command
├── "Template not found: modules/core/commands/build" or "…/check"
│   └── Phantom helpers — replace with your app's phase partials
├── "Template not found: modules/core/validations/<name>"
│   └── Wrong path — use modules/core/lib/validations/<name>
├── result.valid is false unexpectedly
│   ├── Check result.errors for field names and translation keys
│   ├── Is value present but errors say "blank"?
│   │   └── String literal instead of variable reference in hash literal
│   ├── Is uniqueness failing?
│   │   └── Check `table:` option matches schema table name
│   └── Is matches failing?
│       └── Verify regexp, and remember it's `regexp:` not `pattern:`
├── result.valid is true but no record created
│   ├── Missing `if object.valid == false / return object` guard
│   ├── Wrong mutation_name (file not found)
│   └── Wrong selection (does not match mutation response field)
├── result has no id after execute
│   ├── Mutation .graphql file missing id in selection set
│   └── selection parameter mismatch
└── "Template not found" (other)
    ├── pos-module-core not installed
    ├── Command path typo in {% function %} call
    └── File in wrong directory (must be app/lib/commands/)
```

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- Correct file layout
- [api.md](api.md) -- Module-level runner + validator family
- [patterns.md](patterns.md) -- Working examples to compare against
- [advanced.md](advanced.md) -- Edge cases and advanced troubleshooting
- [modules/core/gotchas.md](../modules/core/gotchas.md) -- Authoritative
  source for the phantom build/check error and validator renames.
