# pos-module-tests

Testing framework for platformOS applications. Tests run in staging/development only.

**Optional module** — recommended for all projects.

## Install

```bash
pos-cli modules install tests
```

## Documentation

Full docs: https://github.com/Platform-OS/pos-module-tests

## Test File Location

`app/lib/tests/` — files must end with `_test.liquid`.

## Writing Tests

```liquid
{% comment %} app/lib/tests/products/create_test.liquid {% endcomment %}

{% comment %} Setup {% endcomment %}
{% function result = 'commands/products/create', title: "Test Product", price: "19.99" %}

{% comment %} Assertions {% endcomment %}
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

## Available Assertions

| Assertion | Description |
|-----------|-------------|
| `valid_object` | Object has `valid: true` |
| `equal` | Two values are equal |
| `not_equal` | Two values differ |
| `truthy` | Value is truthy |
| `falsy` | Value is falsy |
| `contains` | String/array contains value |

## Running Tests

### In Browser
Navigate to `/_tests/run` on your instance.

### Via CLI (for CI/CD)
```bash
pos-cli test run staging
```

## Rules

- Tests only work in staging/development environments
- Test files must end with `_test.liquid`
- Tests go in `app/lib/tests/`
- Each test must `{% return contract %}`
