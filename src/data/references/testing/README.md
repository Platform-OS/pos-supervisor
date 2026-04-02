# Testing

platformOS testing uses the pos-module-tests module. Tests run in staging/development only.

## Setup

```bash
pos-cli modules install tests
```

## Test Location

`app/lib/tests/` — files must end with `_test.liquid`.

## Writing Tests

```liquid
{% comment %} app/lib/tests/products/create_test.liquid {% endcomment %}

{% comment %} Arrange: set up test data {% endcomment %}
{% function result = 'commands/products/create', title: "Test Product", price: "19.99" %}

{% comment %} Assert: verify results {% endcomment %}
{% function contract = 'modules/tests/assertions/valid_object',
  contract: contract,
  object: result
%}

{% function contract = 'modules/tests/assertions/equal',
  contract: contract,
  given: result.title,
  expected: "Test Product"
%}

{% function contract = 'modules/tests/assertions/equal',
  contract: contract,
  given: result.price,
  expected: "19.99"
%}

{% return contract %}
```

## Testing Validation Errors

```liquid
{% comment %} app/lib/tests/products/create_invalid_test.liquid {% endcomment %}

{% function result = 'commands/products/create', title: "", price: "" %}

{% function contract = 'modules/tests/assertions/falsy',
  contract: contract,
  given: result.valid
%}

{% function contract = 'modules/tests/assertions/truthy',
  contract: contract,
  given: result.errors.title
%}

{% return contract %}
```

## Available Assertions

| Assertion | Description |
|-----------|-------------|
| `valid_object` | Object has `valid: true` |
| `equal` | Values are equal |
| `not_equal` | Values differ |
| `truthy` | Value is truthy |
| `falsy` | Value is falsy |
| `contains` | String/array contains value |

## Running Tests

### Browser
Navigate to `/_tests/run` on your staging instance.

### CLI (for CI/CD)
```bash
pos-cli test run staging
```

## Test Organization

```
app/lib/test/
├── products/
│   ├── create_test.liquid
│   ├── update_test.liquid
│   └── delete_test.liquid
├── orders/
│   ├── create_test.liquid
│   └── payment_test.liquid
└── auth/
    ├── login_test.liquid
    └── permissions_test.liquid
```

## Rules

- Tests only run in staging/development
- Files must end with `_test.liquid`
- Each test must `{% return contract %}`
- Test commands, not pages
- Use descriptive test file names
