# modules/tests - Common Gotchas

## Running Tests in Production

Tests cannot run in production - this is by design:

```bash
# WRONG - will fail
pos-cli test run production
# Error: Tests can only run in staging or development

# CORRECT
pos-cli test run staging
pos-cli test run development
```

Always test in staging before deploying to production.

## Test File Naming

Files must end with `_test.liquid`:

```
# WRONG - not recognized
user_test_queries.liquid
test_user_queries.liquid
queries_user_test.js

# CORRECT
user_test.liquid
user_queries_test.liquid
```

## Forgetting Test Cleanup

Always clean up test data to avoid pollution:

```liquid
<!-- WRONG - leaves test data in database -->
{% graphql %}
  mutation CreateTestUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id }
    }
  }
{% endgraphql %}

<!-- CORRECT - cleans up after test -->
{% graphql %}
  mutation CreateTestUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id }
    }
  }
{% endgraphql %}

{% comment %} Cleanup test data {% endcomment %}
{% graphql %}
  mutation DeleteUser($id: ID!) {
    user_delete(id: $id) { user { id } }
  }
{% endgraphql %}
```

## Test Isolation Issues

Tests should not depend on each other:

```liquid
<!-- WRONG - depends on other test -->
{% graphql result = 'queries/user/get', id: test_user_id %}
<!-- test_user_id from another test file -->

<!-- CORRECT - create data in each test -->
{% graphql %}
  mutation CreateTestUser {
    user_create(data: { email: "test@example.com" }) {
      user { id }
    }
  }
{% endgraphql %}

{% assign test_user_id = user.id %}
```

## Invalid Assertion Syntax

Assertions require correct variable names:

```liquid
<!-- WRONG - invalid parameter name -->
{% include 'modules/tests/assertions/equal'
  value1: 'hello'
  value2: 'hello'
%}

<!-- CORRECT - use actual and expected -->
{% include 'modules/tests/assertions/equal'
  actual: 'hello'
  expected: 'hello'
%}
```

## Not Handling GraphQL Errors

Always check for GraphQL errors:

```liquid
<!-- WRONG - doesn't check errors -->
{% graphql %}
  mutation CreateUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/valid_object' object: user %}

<!-- CORRECT - check for errors first -->
{% graphql %}
  mutation CreateUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id }
      errors { message }
    }
  }
{% endgraphql %}

{% if response.errors %}
  {% include 'modules/tests/assertions/error_contains'
    errors: response.errors
    text: 'expected error message'
  %}
{% else %}
  {% include 'modules/tests/assertions/valid_object' object: user %}
{% endif %}
```

## Using Live Data in Tests

Never use production data:

```liquid
<!-- WRONG -->
{% assign user_id = 123 %}
<!-- This is a real user ID -->

<!-- CORRECT - create test data -->
{% graphql %}
  mutation CreateTestUser {
    user_create(data: { email: "test-{{ 'now' | date: '%s' }}@example.com" }) {
      user { id }
    }
  }
{% endgraphql %}
```

## Hardcoding Expected Values

Avoid hardcoding test values:

```liquid
<!-- WRONG -->
{% include 'modules/tests/assertions/equal'
  actual: user.email
  expected: 'john@example.com'
%}

<!-- CORRECT - use test variables -->
{% assign test_email = 'john@example.com' %}
{% include 'modules/tests/assertions/equal'
  actual: user.email
  expected: test_email
%}
```

## Slow Test Execution

Minimize database operations:

```liquid
<!-- WRONG - slow, many queries -->
{% for i in (1..100) %}
  {% graphql %}
    mutation CreateUser {
      user_create(data: { email: "user{{ i }}@test.com" }) {
        user { id }
      }
    }
  {% endgraphql %}
{% endfor %}

<!-- CORRECT - batch operations when possible -->
{% graphql %}
  mutation CreateUsers {
    user1: user_create(data: { email: "user1@test.com" }) {
      user { id }
    }
    user2: user_create(data: { email: "user2@test.com" }) {
      user { id }
    }
  }
{% endgraphql %}
```

## See Also
- configuration.md - Setup instructions
- api.md - Assertions reference
- patterns.md - Common patterns
- advanced.md - Advanced techniques
