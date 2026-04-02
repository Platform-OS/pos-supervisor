# Commands -- API Reference

## Core Module Helpers

All command helpers are provided by `pos-module-core` and called via the `{% function %}` tag.

### `modules/core/commands/build`

Initializes the command object, adding metadata fields (`valid`, `errors`).

```liquid
{% function object = 'modules/core/commands/build', object: object %}
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `object` | Hash | Yes | The raw data hash built via `assign` with a hash literal |

**Returns:** Hash with original fields plus `valid: true` and `errors: {}`.

### `modules/core/commands/check`

Validates the object against an array of validator definitions.

```liquid
{% function object = 'modules/core/commands/check', object: object, validators: validators %}
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `object` | Hash | Yes | Object from the build stage |
| `validators` | Array | Yes | JSON array of validator hashes |

**Returns:** Object with `valid` set to `false` and `errors` populated if any validation fails.

### `modules/core/commands/execute`

Persists the object by running a GraphQL mutation.

```liquid
{% function object = 'modules/core/commands/execute',
  mutation_name: 'products/create',
  selection: 'record_create',
  object: object
%}
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `mutation_name` | String | Yes | Path to `.graphql` file (relative to `app/graphql/`) |
| `selection` | String | Yes | Top-level field name in the mutation response (e.g., `record_create`) |
| `object` | Hash | Yes | Validated object from the check stage |

**Returns:** Object with `id`, `created_at`, and other fields merged from the mutation response.

### `modules/core/commands/events/publish`

Publishes an event after a successful command execution.

```liquid
{% function _ = 'modules/core/commands/events/publish', type: 'product_created', object: object %}
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | String | Yes | Event type identifier (matches consumer directory name) |
| `object` | Hash | Yes | Data payload available to consumers as `event.object` |

**Returns:** Ignored (assign to `_`).

## Validator Definitions

Validators are defined as a JSON array of hashes. Each hash requires `name` and `property` at minimum.

### `presence`

Field must not be blank, null, or empty string.

```json
{ "name": "presence", "property": "title" }
```

### `numericality`

Field must be a valid number.

```json
{ "name": "numericality", "property": "price" }
```

### `uniqueness`

Field must be unique within the specified table.

```json
{ "name": "uniqueness", "property": "email", "options": { "table": "user_profile" } }
```

### `length`

Field string length must fall within constraints.

```json
{ "name": "length", "property": "title", "options": { "minimum": 3, "maximum": 255 } }
```

### `format`

Field must match a regular expression.

```json
{ "name": "format", "property": "slug", "options": { "pattern": "^[a-z0-9-]+$" } }
```

### `inclusion`

Field value must be in a predefined list.

```json
{ "name": "inclusion", "property": "status", "options": { "values": ["draft", "published", "archived"] } }
```

### `confirmation`

Two fields must match (e.g., password and password confirmation).

```json
{ "name": "confirmation", "property": "password" }
```

This expects a corresponding `password_confirmation` field in the object.

## Result Object Structure

```json
{
  "title": "Widget",
  "price": 19.99,
  "valid": true,
  "errors": {},
  "id": "12345",
  "created_at": "2025-01-15T10:30:00Z"
}
```

On validation failure:

```json
{
  "title": "",
  "price": null,
  "valid": false,
  "errors": {
    "title": ["app.errors.blank"],
    "price": ["app.errors.blank", "app.errors.not_a_number"]
  }
}
```

## Calling a Command

From a page or another partial:

```liquid
{% function result = 'lib/commands/products/create', title: "Widget", price: 19.99 %}
```

Parameters are passed as named arguments and become local variables inside the command file.

## See Also

- [README.md](README.md) -- Commands overview
- [configuration.md](configuration.md) -- File layout and naming
- [patterns.md](patterns.md) -- Real-world usage examples
- [gotchas.md](gotchas.md) -- Common API misuse and error messages
- [advanced.md](advanced.md) -- Advanced validator combinations and custom validators
- [Liquid Tags](../liquid/tags/) -- `function`, `assign`, and other tag references
