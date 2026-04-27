# pos-module-core — Gotchas & Troubleshooting

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## TOP GOTCHA: `modules/core/commands/build` and `…/check` DO NOT EXIST

There is no `modules/core/commands/build.liquid` and no
`modules/core/commands/check.liquid`. The build/check phases are
APP-LEVEL — your own command directory contains them as nested partials,
e.g. `app/lib/commands/products/create/build.liquid` and `…/check.liquid`.

```liquid
{% comment %} ✗ FAILS — no such file in core 2.1.8 {% endcomment %}
{% function object = 'modules/core/commands/build', object: params %}

{% comment %} ✓ Correct — your own build partial {% endcomment %}
{% function object = 'commands/products/create/build', object: params %}
```

The only top-level command runner the core module ships is
`modules/core/commands/execute`. Generate the build/check/execute trio
with `pos-cli generators run crud --resource <name>`.

---

## Validator Renames (legacy → modern)

If you copied validator config from older docs, these will fail at
function-resolve time:

| Legacy name      | Modern replacement               | Notes |
|------------------|----------------------------------|-------|
| `numericality`   | `number`                         | options renamed `greater_than`/`less_than` → `gt`/`gte`/`lt`/`lte`/`eq`/`ne` |
| `format`         | `matches`                        | option renamed `pattern` → `regexp` |
| `confirmation`   | `equal` with `to: '<other_field>'`| explicit pair-comparison |
| `inclusion`      | `included` with `in: [...]`      | option renamed `values` → `in` |

The validator files at `modules/core/lib/validations/` are the canonical
source. Calling `'modules/core/lib/validations/format'` (with no file
behind it) is the same kind of failure as calling phantom build/check.

---

## Validators Take Direct Args, Not a JSON Hash

Modern validators are CALLED INDIVIDUALLY with named parameters, not
config-driven through a single `validators` array passed to a checker:

```liquid
{% comment %} ✓ Modern shape — chain validators in your check partial {% endcomment %}
{% function c = 'modules/core/lib/validations/presence',
   c: c, field_name: 'title', object: object %}
{% function c = 'modules/core/lib/validations/number',
   c: c, field_name: 'price', object: object, gt: 0 %}
```

```liquid
{% comment %} ✗ Legacy shape — no longer supported {% endcomment %}
{% assign validators = [
  { "name": "presence", "property": "title" },
  { "name": "numericality", "property": "price", "options": { "greater_than": 0 } }
] %}
{% function object = 'modules/core/commands/check',
   object: object, validators: validators %}
```

---

## Common Errors

### "object.errors is always blank even with invalid data"

**Cause:** Your `check` partial is not threading the contract `c` through
each validator call.

**Solution:** Each validator returns a contract; pass the result back as
the `c:` argument of the next call. At the end, set `object.errors = c`
and `object.valid = c == empty`. See patterns.md for the canonical shape.

### "Uniqueness validator fails with 'table not found'"

**Cause:** The `table` option does not match a schema name.

**Solution:** Check `app/schema/<name>.yml`. The table value must equal
the filename without `.yml`. The `scope` option, if used, is a list of
field names that further narrow uniqueness (e.g. unique-per-tenant).

### "Execute command returns nil instead of the created record"

**Cause:** The `selection:` parameter doesn't match the mutation's
top-level result field. The default is `'record'`; record CRUD ops
typically use `'record_create'`, `'record_update'`, `'record_delete'`.

**Solution:** Inspect the mutation file (`app/graphql/<...>.graphql`) and
match the top-level alias literally.

### "Events are published but consumers never fire"

**Cause:** Consumer file path or `type` string mismatch.

**Solution:** Verify the consumer file exists under `app/lib/events/<type>/...`.
The `type` argument to `events/publish` must match exactly. Tail the
instance log for consumer errors.

### "Flash message appears on wrong page or not at all"

**Cause:** `from:` does not match the current page path, or the flash is
cleared before display.

**Solution:** Pass `from: context.location.pathname` when setting. Read +
clear the flash in your layout once per request. The `from` value lets
the flash auto-clear on subsequent unrelated navigation.

### "Validation error messages are not translated"

**Cause:** Validators emit translation KEYS (e.g.
`'modules/core/validation.matches'`); translation happens in your display
layer.

**Solution:** In the form partial, run each error message through `| t`,
or look up custom translations in your locale files.

### "Cannot override a core module file"

**Cause:** Override placed at the wrong path.

**Solution:** Override path mirrors the module tree under
`app/modules/core/public/...`. The path after `public/` must be identical.

---

## Limits

| Resource                  | Limit            | Notes                                  |
|---------------------------|------------------|----------------------------------------|
| Validators per check      | No hard limit    | Performance degrades beyond ~20        |
| Session value size        | 4 KB             | Per key; use a record for larger data  |
| Event payload size        | 1 MB             | Pass IDs not full objects when possible|
| Nested command depth      | ~3 levels        | Commands calling commands calling …    |
| GraphQL mutation path     | 255 characters   | Relative to `app/graphql/`             |

## See Also

- [Core Overview](README.md)
- [Core API](api.md)
- [Core Configuration](configuration.md)
- [Core Patterns](patterns.md)
- [Core Advanced](advanced.md)
