# modules/tests - Common Patterns

## Basic Test Structure

### Simple Test with Setup
```liquid
# app/lib/test/user_creation_test.liquid

{% comment %} Test: User Creation {% endcomment %}

{% liquid
  assign test_name = 'test_user_creation'
  assign test_email = 'testuser@example.com'
%}

{% graphql %}
  mutation CreateUser($email: String!) {
    user_create(data: { email: $email }) {
      user { id, email }
      errors { message }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/valid_object' object: user %}
{% include 'modules/tests/assertions/equal'
  actual: user.email
  expected: test_email
%}

{% comment %} Cleanup {% endcomment %}
{% graphql %}
  mutation DeleteUser($id: ID!) {
    user_delete(id: $id) { user { id } }
  }
{% endgraphql %}
```

## Query Testing Patterns

### Test GraphQL Query
```liquid
# app/lib/test/user_query_test.liquid

{% graphql result = 'queries/user/get', id: 123 %}

{% include 'modules/tests/assertions/valid_object' object: result.user %}
{% include 'modules/tests/assertions/equal'
  actual: result.user.role
  expected: 'admin'
%}
```

### Test Query with Variables
```liquid
{% assign variables = { "id": 123 } %}

{% graphql result = 'queries/user/get', variables: variables %}

{% include 'modules/tests/assertions/truthy' value: result.user.id %}
```

## Mutation Testing Patterns

### Test Create Mutation
```liquid
# app/lib/test/create_post_test.liquid

{% liquid
  assign test_title = 'Test Post'
  assign test_content = 'Test content'
%}

{% graphql %}
  mutation CreatePost($title: String!, $content: String!) {
    post_create(data: {
      title: $title
      content: $content
    }) {
      post { id, title }
      errors { message }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/valid_object' object: post %}
{% include 'modules/tests/assertions/equal'
  actual: post.title
  expected: test_title
%}

{% comment %} Cleanup {% endcomment %}
{% graphql %}
  mutation DeletePost($id: ID!) {
    post_delete(id: $id) { post { id } }
  }
{% endgraphql %}
```

### Test Update Mutation
```liquid
# app/lib/test/update_user_test.liquid

{% graphql %}
  mutation UpdateUser($id: ID!, $email: String!) {
    user_update(id: $id, data: { email: $email }) {
      user { id, email }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/equal'
  actual: user.email
  expected: 'newemail@example.com'
%}
```

## Error Testing Patterns

### Test Validation Errors
```liquid
# app/lib/test/validation_error_test.liquid

{% graphql %}
  mutation CreateUserInvalid {
    user_create(data: {
      email: ""
    }) {
      errors { message }
    }
  }
{% endgraphql %}

{% include 'modules/tests/assertions/error_contains'
  errors: response.errors
  text: 'Email is required'
%}
```

### Test Authorization Failures
```liquid
# app/lib/test/authorization_test.liquid

{% include 'modules/user/helpers/can_do'
  with_action: 'delete_user'
%}

{% if can_do %}
  {% include 'modules/tests/assertions/falsy' value: can_do %}
{% endif %}
```

## Data Validation Patterns

### Test Array Contents
```liquid
{% graphql result = 'queries/roles/list' %}

{% include 'modules/tests/assertions/count'
  array: result.roles
  expected: 3
%}

{% include 'modules/tests/assertions/contains'
  array: result.roles
  element: 'admin'
%}
```

### Test Object Properties
```liquid
{% graphql result = 'queries/user/get', id: 123 %}

{% include 'modules/tests/assertions/valid_object' object: result.user %}
{% include 'modules/tests/assertions/truthy' value: result.user.id %}
{% include 'modules/tests/assertions/equal'
  actual: result.user.status
  expected: 'active'
%}
```

## Helper Test Patterns

### Test Liquid Helpers
```liquid
# app/lib/test/helper_test.liquid

{% include 'app/helpers/format_price' price: 99.99 %}

{% include 'modules/tests/assertions/equal'
  actual: formatted_price
  expected: '$99.99'
%}
```

## See Also
- configuration.md - Setup and structure
- api.md - Assertions reference
- gotchas.md - Common mistakes
- advanced.md - Advanced techniques
