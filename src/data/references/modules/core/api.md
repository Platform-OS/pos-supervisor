# pos-module-core -- API Reference

This document covers all available commands, helpers, validators, and event functions provided by the core module.

## Commands

### modules/core/commands/build

Constructs an object hash from input parameters. Strips unwanted keys and normalizes the data structure.

```liquid
{% function object = 'modules/core/commands/build', object: params %}
```

| Parameter | Type | Required | Description                          |
|-----------|------|----------|--------------------------------------|
| `object`  | Hash | Yes      | Raw input hash (typically from params)|

**Returns:** A normalized hash ready for validation.

### modules/core/commands/check

Validates an object against an array of validators. Populates `object.errors` if validation fails.

```liquid
{% function object = 'modules/core/commands/check', object: object, validators: validators %}
```

| Parameter    | Type  | Required | Description                         |
|--------------|-------|----------|-------------------------------------|
| `object`     | Hash  | Yes      | Object to validate                  |
| `validators` | Array | Yes      | JSON array of validator definitions |

**Returns:** The object with an `errors` hash appended. If valid, `object.errors` is blank.

```liquid
{% comment %} Check errors after validation {% endcomment %}
{% if object.errors != blank %}
  {% comment %} object.errors looks like: { "title": ["can't be blank"], "price": ["is not a number"] } {% endcomment %}
  {% return object %}
{% endif %}
```

### modules/core/commands/execute

Persists the object to the database by running a GraphQL mutation.

```liquid
{% function object = 'modules/core/commands/execute',
  mutation_name: 'products/create',
  selection: 'record_create',
  object: object
%}
```

| Parameter       | Type   | Required | Description                                  |
|-----------------|--------|----------|----------------------------------------------|
| `mutation_name` | String | Yes      | Path to GraphQL mutation file                |
| `selection`     | String | Yes      | GraphQL selection field (e.g., `record_create`, `record_update`, `record_delete`) |
| `object`        | Hash   | Yes      | Validated object to persist                  |

**Returns:** The object with the database ID populated on success.

## Event Commands

### modules/core/commands/events/publish

Publishes an event that can be consumed by event subscribers.

```liquid
{% function _ = 'modules/core/commands/events/publish',
  type: 'product_created',
  object: object
%}
```

| Parameter | Type   | Required | Description                        |
|-----------|--------|----------|------------------------------------|
| `type`    | String | Yes      | Event type name                    |
| `object`  | Hash   | Yes      | Data payload to pass to consumers  |

**Returns:** nil. Events are fire-and-forget from the publisher's perspective.

## Session Commands

### modules/core/commands/session/get

Retrieves a value from the session store.

```liquid
{% function value = 'modules/core/commands/session/get', key: 'sflash' %}
```

| Parameter | Type   | Required | Description          |
|-----------|--------|----------|----------------------|
| `key`     | String | Yes      | Session key to read  |

**Returns:** The stored value, or nil if not set.

### modules/core/commands/session/set

Stores a value in the session store.

```liquid
{% function _ = 'modules/core/commands/session/set',
  key: 'sflash', value: 'Success message', from: context.location.pathname
%}
```

| Parameter | Type   | Required | Description                                |
|-----------|--------|----------|--------------------------------------------|
| `key`     | String | Yes      | Session key to write                       |
| `value`   | Any    | Yes      | Value to store                             |
| `from`    | String | No       | Origin path for auto-clear (flash pattern) |

### modules/core/commands/session/clear

Removes a value from the session store.

```liquid
{% function _ = 'modules/core/commands/session/clear', key: 'sflash' %}
```

| Parameter | Type   | Required | Description           |
|-----------|--------|----------|-----------------------|
| `key`     | String | Yes      | Session key to remove |

## Helpers

### modules/core/helpers/redirect_to

Redirects to a URL with an optional flash notice. Combines session set and redirect in one call.

```liquid
{% include 'modules/core/helpers/redirect_to', url: '/products', notice: 'app.product_created' %}
```

| Parameter | Type   | Required | Description                        |
|-----------|--------|----------|------------------------------------|
| `url`     | String | Yes      | Redirect target URL                |
| `notice`  | String | No       | Translation key for flash message  |

### modules/core/helpers/flash/publish

Sets a flash message without redirecting.

```liquid
{% include 'modules/core/helpers/flash/publish', notice: 'app.saved' %}
```

| Parameter | Type   | Required | Description                       |
|-----------|--------|----------|-----------------------------------|
| `notice`  | String | No       | Translation key for notice flash  |

## Validators

All validators are called internally by `modules/core/commands/check`. You configure them via the validators JSON array.

### presence

Field must not be blank, nil, or empty string.

```json
{ "name": "presence", "property": "title" }
```

### numericality

Field must be a valid number.

```json
{ "name": "numericality", "property": "price" }
{ "name": "numericality", "property": "price", "options": { "greater_than": 0 } }
{ "name": "numericality", "property": "quantity", "options": { "less_than": 1000 } }
```

### uniqueness

Field value must be unique within the specified table.

```json
{ "name": "uniqueness", "property": "email", "options": { "table": "user_profile" } }
{ "name": "uniqueness", "property": "slug", "options": { "table": "product", "scope": ["category_id"] } }
```

### length

String length must be within specified bounds.

```json
{ "name": "length", "property": "title", "options": { "minimum": 1, "maximum": 255 } }
{ "name": "length", "property": "bio", "options": { "maximum": 1000 } }
```

### format

Field must match a regular expression pattern.

```json
{ "name": "format", "property": "email", "options": { "pattern": "^[^@]+@[^@]+\\.[^@]+$" } }
{ "name": "format", "property": "phone", "options": { "pattern": "^\\+?[0-9\\-\\s]+$" } }
```

### inclusion

Field value must be one of the allowed values.

```json
{ "name": "inclusion", "property": "status", "options": { "values": ["draft", "published", "archived"] } }
```

### confirmation

Two fields must have matching values (e.g., password and password_confirmation).

```json
{ "name": "confirmation", "property": "password" }
```

This checks that `password` equals `password_confirmation` in the object.

## See Also

- [Core Overview](README.md) -- introduction and key concepts
- [Core Configuration](configuration.md) -- installation and setup
- [Core Patterns](patterns.md) -- real-world usage examples
- [Core Gotchas](gotchas.md) -- common errors and limits
- [Core Advanced](advanced.md) -- custom validators and event chaining
- [Commands Reference](../../commands/README.md) -- the command pattern architecture
