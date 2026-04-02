# pos-module-core -- Configuration Reference

This document covers installation, setup, and configuration options for the core module.

## Installation

```bash
pos-cli modules install core
```

This creates the `modules/core/` directory in your project. This directory is **read-only** -- never edit files inside `modules/core/` directly.

### Verify installation

After installing and deploying, confirm the module is available:

```liquid
{% function test = 'modules/core/commands/build', object: null %}
{% log test, type: 'debug' %}
```

If you see output in logs without errors, the module is installed correctly.

## Directory Structure

```
modules/core/                          # READ-ONLY -- installed module code
  public/
    lib/
      commands/
        build.liquid                   # Construct object hash
        check.liquid                   # Validate with validators array
        execute.liquid                 # Run GraphQL mutation
        events/
          publish.liquid               # Publish an event
        session/
          get.liquid                   # Get session value
          set.liquid                   # Set session value
          clear.liquid                 # Clear session value
      helpers/
        redirect_to.liquid             # Redirect with flash
        flash/
          publish.liquid               # Set flash message
      validators/
        presence.liquid
        numericality.liquid
        uniqueness.liquid
        length.liquid
        format.liquid
        inclusion.liquid
        confirmation.liquid
```

## Overriding Module Files

The `modules/core/` directory is read-only. To customize behavior, copy the specific file to the `app/modules/core/` mirror path:

```bash
# Example: override the presence validator
mkdir -p app/modules/core/public/lib/validators
cp modules/core/public/lib/validators/presence.liquid \
   app/modules/core/public/lib/validators/presence.liquid
```

The file at `app/modules/core/public/...` takes precedence over the one in `modules/core/public/...`.

**Rule:** Only override what you need. Keep overrides minimal to avoid breaking updates.

## Validator Configuration

Validators are configured as a JSON array passed to `check`. Each entry has:

| Property   | Type   | Required | Description                                |
|------------|--------|----------|--------------------------------------------|
| `name`     | String | Yes      | Validator name (e.g., `presence`)          |
| `property` | String | Yes      | Field name on the object to validate       |
| `options`  | Hash   | No       | Validator-specific options                 |

### Validator options reference

| Validator      | Option         | Type    | Description                            |
|----------------|----------------|---------|----------------------------------------|
| `length`       | `minimum`      | Integer | Minimum string length                  |
| `length`       | `maximum`      | Integer | Maximum string length                  |
| `numericality` | `greater_than` | Number  | Value must be greater than this        |
| `numericality` | `less_than`    | Number  | Value must be less than this           |
| `format`       | `pattern`      | String  | Regex pattern the value must match     |
| `inclusion`    | `values`       | Array   | Allowed values list                    |
| `uniqueness`   | `table`        | String  | Table name to check uniqueness against |
| `uniqueness`   | `scope`        | Array   | Additional fields for scoped uniqueness|
| `confirmation` | `field`        | String  | Name of the confirmation field         |

### Example: full validator array

```liquid
{% assign validators = [
  { "name": "presence", "property": "title" },
  { "name": "presence", "property": "email" },
  { "name": "length", "property": "title", "options": { "minimum": 3, "maximum": 255 } },
  { "name": "numericality", "property": "price", "options": { "greater_than": 0 } },
  { "name": "format", "property": "email", "options": { "pattern": "^[^@]+@[^@]+\\.[^@]+$" } },
  { "name": "uniqueness", "property": "slug", "options": { "table": "product" } },
  { "name": "inclusion", "property": "status", "options": { "values": ["draft", "published", "archived"] } },
  { "name": "confirmation", "property": "password" }
] %}
```

## Session Configuration

Session helpers use platformOS built-in session storage. No additional configuration is needed.

| Function      | Key Parameter | Description                       |
|---------------|---------------|-----------------------------------|
| `session/get` | `key`         | Retrieve a value from session     |
| `session/set` | `key`, `value`| Store a value in session          |
| `session/clear`| `key`        | Remove a value from session       |

The `sflash` key is the conventional key used for flash messages (session-flash).

## Flash Message Configuration

The flash system uses `sflash` session key by convention. The `from` parameter on `session/set` ensures the flash auto-clears after display:

```liquid
{% function _ = 'modules/core/commands/session/set',
  key: 'sflash', value: 'Record saved', from: context.location.pathname
%}
```

## Dependencies

pos-module-core has no module dependencies. It is the base module that all others depend on.

| Module               | Depends on core? |
|----------------------|------------------|
| pos-module-user      | Yes              |
| pos-module-payments  | Yes              |
| pos-module-tests     | Yes              |
| pos-module-chat      | Yes              |
| pos-module-openai    | Yes              |

## See Also

- [Core Overview](README.md) -- introduction and key concepts
- [Core API](api.md) -- all available functions and helpers
- [Core Patterns](patterns.md) -- real-world usage patterns
- [Core Gotchas](gotchas.md) -- common errors and limits
- [Core Advanced](advanced.md) -- custom validators and overrides
