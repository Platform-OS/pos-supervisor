# modules/tests - Configuration

## Overview
The `modules/tests` is an optional testing framework for platformOS that enables contract testing and unit testing. Tests are written in Liquid and executed in staging or development environments only.

## Installation

### Install Test Module
```bash
pos-cli modules install tests
```

### Verify Installation
```bash
pos-cli modules list | grep tests
```

## Test File Structure

### Test Directory Location
Place all test files in the test directory:

```
app/lib/test/
├── queries_test.liquid
├── mutations_test.liquid
├── helpers_test.liquid
└── integration_test.liquid
```

### Test File Naming Convention
Test files must end with `_test.liquid`:

```
# CORRECT naming
user_queries_test.liquid
payment_mutations_test.liquid
validation_helpers_test.liquid

# WRONG - won't be recognized
user_test_queries.liquid
test_user_queries.liquid
```

## Test Environment Setup

### Development Environment
Run tests in development:

```bash
pos-cli test run development
```

### Staging Environment
Run tests in staging:

```bash
pos-cli test run staging
```

### Production Safety
Tests cannot run in production - this is by design for safety:

```bash
# This will FAIL
pos-cli test run production
# Error: Tests can only run in development or staging
```

## Running Tests

### Run All Tests
```bash
pos-cli test run staging
# OR
/_tests/run
```

### Run Specific Test File
```bash
pos-cli test run staging test/user_test.liquid
```

### Run Tests with Verbose Output
```bash
pos-cli test run staging --verbose
```

## Test Output

### Test Results
Each test returns a contract containing:

```
{
  "test_name": "test_should_create_user",
  "passed": true,
  "duration_ms": 125,
  "assertions": 3,
  "failures": []
}
```

### View Test Results
Access results at: `https://yourinstance.platformos.com/_tests/results`

## Configuration Options

### Skip Specific Tests
Mark tests to skip:

```liquid
{% comment %} SKIP {% endcomment %}
```

### Set Test Timeout
```liquid
{% assign test_timeout_ms = 5000 %}
```

### Custom Test Setup
```liquid
{% liquid
  assign test_user_id = 123
  assign test_data = 'sample' | split: '|'
%}
```

## Best Practices

### Test Isolation
Each test should be independent:
- Setup: Create test data
- Execute: Run test code
- Teardown: Clean up test data

### Keep Tests Fast
- Use test data sparingly
- Mock external services
- Avoid database queries where possible

## See Also
- api.md - Assertions and API reference
- patterns.md - Common test patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced testing
