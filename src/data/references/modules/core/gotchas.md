# pos-module-core -- Gotchas & Troubleshooting

Common errors, limits, and debugging guidance for the core module.

## Common Errors

### "Liquid error: modules/core/commands/build not found"

**Cause:** The core module is not installed, or the deployment did not include the module files.

**Solution:** Run `pos-cli modules install core` and redeploy with `pos-cli deploy`.

### "object.errors is always blank even with invalid data"

**Cause:** The validators array is malformed, empty, or the property names do not match the object keys.

**Solution:** Verify the JSON validators array is valid. Ensure each `"property"` value exactly matches a key in the object passed to `build`. Use `{% log validators, type: 'debug' %}` to inspect.

### "Uniqueness validator fails with 'table not found'"

**Cause:** The `table` option references a schema table name that does not exist or has a typo.

**Solution:** Check your `app/schema/` directory for the correct table name. The table value must match the filename without the `.yml` extension.

### "Execute command returns nil instead of the created record"

**Cause:** The `selection` parameter does not match the GraphQL mutation's return field name.

**Solution:** If your mutation uses `record_create`, set `selection: 'record_create'`. For updates use `record_update`. For deletes use `record_delete`. Check the mutation file to confirm the exact field name.

### "Events are published but consumers never fire"

**Cause:** The event consumer is not registered correctly, or the event type string does not match between publisher and consumer.

**Solution:** Verify the consumer file exists in the correct path. Ensure the event `type` string is identical in both the `publish` call and the consumer registration. Check logs for consumer errors.

### "Flash message appears on wrong page or not at all"

**Cause:** The `from` parameter in `session/set` does not match the current page path, or the flash is cleared before being displayed.

**Solution:** Pass `from: context.location.pathname` when setting the flash. Read and display the flash in your layout before any partials clear it. Ensure `session/clear` is called after rendering, not before.

### "Validation error messages are not translated"

**Cause:** Validators return default English error messages. Translation must be handled in the display layer.

**Solution:** Map error keys to translation keys in your form partial. The errors hash uses field names as keys and arrays of error messages as values.

### "Cannot override a core module file"

**Cause:** The override file is placed in the wrong path. Overrides must mirror the exact path structure.

**Solution:** Copy from `modules/core/public/lib/...` to `app/modules/core/public/lib/...`. The relative path after `public/` must be identical.

## Limits

| Resource                        | Limit              | Notes                                          |
|---------------------------------|--------------------|-------------------------------------------------|
| Validators per check call       | No hard limit      | Performance degrades beyond ~20 validators      |
| Session value size              | 4 KB               | Per key; use database for larger data           |
| Event payload size              | 1 MB               | Keep payloads lean; pass IDs not full objects   |
| Events published per request    | No hard limit      | Each event adds latency; batch where possible   |
| Nested command depth            | 3 levels           | Commands calling commands calling commands       |
| GraphQL mutation file path      | 255 characters     | Relative to `app/graphql/`                      |

## See Also

- [Core Overview](README.md) -- introduction and key concepts
- [Core Configuration](configuration.md) -- installation and setup
- [Core API](api.md) -- all available functions
- [Core Patterns](patterns.md) -- real-world usage examples
- [Core Advanced](advanced.md) -- custom validators and edge cases
