# pos-module-core — Configuration

> Compatible with pos-cli 6.0.7+ (modernized canonical syntax).

## Installation

```bash
pos-cli modules install core
```

This creates `modules/core/` in your project. The directory is **read-only**
— never edit files inside `modules/core/` directly. To customize, override
under `app/modules/core/public/...`.

### Verify installation

```bash
ls modules/core/pos-module.json
```

The manifest reports `version`, `name`, and `dependencies: {}` (core has no
module deps). Re-run `pos-cli modules version core` if `template-values.json`
drifts from `pos-module.json`.

## Live Module Layout (2.1.8)

```
modules/core/
  pos-module.json
  template-values.json           # mirror of pos-module.json (sync via `pos-cli modules version`)
  generators/
    command/templates/           # used by `pos-cli generators run command`
    crud/templates/              # used by `pos-cli generators run crud`
  public/
    lib/
      commands/
        execute.liquid                    # the only top-level command runner
        session/{get,set,clear}.liquid
        events/{create,broadcast,publish}.liquid
        events/create/{build,check,execute}.liquid
        email/send.liquid
        email/send/{build,check}.liquid
        statuses/{create,delete}.liquid
        statuses/{create,delete}/{build,check}.liquid
        variable/set.liquid
        hook/{alter,fire}.liquid
      queries/
        registry/, hook/, events/, statuses/, headscripts/, variable/,
        constants/, module/
      helpers/
        redirect_to.liquid
        flash.liquid
        timezone/...
        register_error.liquid           # appends an error to a contract
      validations/
        presence, length, number, date, email, is_url, matches, equal,
        uniqueness, included, elements_included, unique_elements,
        each_element_length, password_complexity, hcaptcha, truthy,
        not_null, exist_in_db, valid_object
      events/                  # subscriber stubs for the shipped event types
    schema/
      status.yml
    translations/
      en.yml
    views/                              # admin pages, layouts, partials
```

There is NO `lib/commands/build.liquid` or `lib/commands/check.liquid` —
those phases are app-level (or domain-specific within other commands).

## Overriding Module Files

The override path mirrors the module tree under `app/modules/core/public/`:

```bash
# Example: override the presence validator
mkdir -p app/modules/core/public/lib/validations
cp modules/core/public/lib/validations/presence.liquid \
   app/modules/core/public/lib/validations/presence.liquid
```

The file at `app/modules/core/public/...` takes precedence over the
shipped one. Override sparingly — keep diffs minimal so module updates
don't conflict.

## Validator Calling Convention

Validators are invoked individually with named parameters; chain them in
your check partial. There is NO config-driven JSON-array form.

```liquid
{% comment %} app/lib/commands/products/create/check.liquid {% endcomment %}
{% liquid
  assign c = object.errors | default: empty

  function c = 'modules/core/lib/validations/presence',
    c: c, field_name: 'title', object: object

  function c = 'modules/core/lib/validations/length',
    c: c, field_name: 'title', object: object, min: 3, max: 255

  function c = 'modules/core/lib/validations/number',
    c: c, field_name: 'price', object: object, gt: 0

  function c = 'modules/core/lib/validations/matches',
    c: c, field_name: 'sku', object: object,
    regexp: '^[A-Z]{2,4}-[0-9]{4}$', allow_blank: true

  function c = 'modules/core/lib/validations/uniqueness',
    c: c, field_name: 'slug', object: object, table: 'product'

  function c = 'modules/core/lib/validations/equal',
    c: c, field_name: 'password', object: object, to: 'password_confirmation'

  function c = 'modules/core/lib/validations/included',
    c: c, field_name: 'status', object: object, in: ['draft','published','archived']

  assign object.errors = c
  assign object.valid  = c == empty
  return object
%}
```

See api.md for the full validator inventory + each validator's option set.

## Session Storage

Session helpers use the platformOS built-in session store; no extra config.

| Function          | Description                       |
|-------------------|-----------------------------------|
| `session/get`     | Retrieve a value                  |
| `session/set`     | Store a value (`from:` for flash) |
| `session/clear`   | Remove a value                    |

The `sflash` key is the conventional flash-message slot.

## Flash Message Configuration

```liquid
{% function _ = 'modules/core/commands/session/set',
   key: 'sflash', value: 'Record saved.',
   from: context.location.pathname %}
```

The `from` value lets the flash auto-clear when the next request comes
from a different origin.

## Dependencies

`pos-module-core` has no module dependencies. It is the base module the
rest of the ecosystem composes on:

| Module                 | Depends on core |
|------------------------|------------------|
| `pos-module-user`      | Yes              |
| `pos-module-common-styling` | No (peer)   |
| `pos-module-payments`  | Yes              |
| `pos-module-tests`     | Yes (dev only)   |
| `pos-module-oauth_github` | Yes (via user) |

## See Also

- [Core Overview](README.md)
- [Core API](api.md)
- [Core Patterns](patterns.md)
- [Core Gotchas](gotchas.md)
- [Core Advanced](advanced.md)
