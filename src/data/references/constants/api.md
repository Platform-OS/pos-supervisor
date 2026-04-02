# Constants -- API Reference

This document covers runtime access to constants in Liquid templates, GraphQL operations, and related context objects.

## Accessing Constants in Liquid

All constants are available through the `context.constants` object at runtime.

### Basic access

```liquid
{{ context.constants.STRIPE_SK_KEY }}
{{ context.constants.API_BASE_URL }}
{{ context.constants.FEATURE_CHAT_ENABLED }}
```

### Assigning to a variable

```liquid
{% assign api_key = context.constants.OPENAI_API_KEY %}
{% assign base_url = context.constants.API_BASE_URL %}
```

### Inside a liquid block

```liquid
{% liquid
  assign stripe_key = context.constants.STRIPE_SK_KEY
  assign webhook_secret = context.constants.WEBHOOK_SECRET
  graphql result = 'payments/charge', api_key: stripe_key, amount: total
%}
```

### Passing to partials

```liquid
{% render 'integrations/stripe_form', pk_key: context.constants.STRIPE_PK_KEY %}
```

### Passing to GraphQL

```liquid
{% graphql result = 'api_calls/send_email', api_key: context.constants.SENDGRID_API_KEY, to: email %}
```

## Security Behavior

Constants are intentionally hidden from the generic `context` output:

```liquid
{{ context }}
{% comment %} Constants are NOT included in this output {% endcomment %}

{{ context.constants }}
{% comment %} Returns blank -- you cannot enumerate all constants {% endcomment %}

{{ context.constants.STRIPE_SK_KEY }}
{% comment %} Returns the actual value -- direct access works {% endcomment %}
```

This means:
- You cannot iterate over all constants
- You must know the exact name to access a value
- Constants never appear in debug output or error pages
- Logging `context` will not expose secrets

## Conditional Logic with Constants

### Feature flags

```liquid
{% liquid
  if context.constants.FEATURE_NEW_CHECKOUT_ENABLED == 'true'
    render 'checkout/new_flow'
  else
    render 'checkout/legacy_flow'
  endif
%}
```

**Important:** Constant values are always strings. Compare with `== 'true'`, not `== true`.

### Nil checks for missing constants

```liquid
{% liquid
  assign api_key = context.constants.OPTIONAL_SERVICE_KEY
  if api_key == blank
    log 'OPTIONAL_SERVICE_KEY not configured', type: 'warn'
    break
  endif
%}
```

## GraphQL Mutations for Constants

### constant_set

```graphql
mutation set_constant($name: String!, $value: String!) {
  constant_set(name: $name, value: $value) {
    name
  }
}
```

Call from Liquid (typically in migrations):

```liquid
{% graphql _ = 'constants/set', name: 'KEY_NAME', value: 'key_value' %}
```

### constant_unset

```graphql
mutation unset_constant($name: String!) {
  constant_unset(name: $name) {
    name
  }
}
```

Call from Liquid:

```liquid
{% graphql _ = 'constants/unset', name: 'DEPRECATED_KEY' %}
```

### Querying all constants

```graphql
query {
  constants {
    name
    value
  }
}
```

This query is available in the `pos-cli gui serve` GraphQL editor for debugging. It returns both names and values.

## CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `pos-cli constants set` | Set or overwrite a constant | `pos-cli constants set --name KEY --value "val" dev` |
| `pos-cli constants list` | List all constant names | `pos-cli constants list dev` |

## context.constants Properties

The `context.constants` object is a read-only hash-like structure:

| Property | Type | Description |
|----------|------|-------------|
| `context.constants.NAME` | String or nil | Returns the value of the named constant, or nil if not set |

There are no methods for iteration, enumeration, or counting on this object.

## Using Constants in API Calls

Constants are commonly used with the `api_call_send` GraphQL mutation or custom HTTP integrations:

```liquid
{% liquid
  assign headers = {}
  assign h = headers | add_hash_key: 'Authorization', 'Bearer ' | append: context.constants.SERVICE_API_KEY
  graphql result = 'api_calls/fetch_data', url: context.constants.SERVICE_BASE_URL, headers: h
%}
```

## Using Constants in Emails

```liquid
{% liquid
  assign from_email = context.constants.SMTP_FROM_ADDRESS
  graphql _ = 'emails/send', to: user.email, from: from_email, subject: 'Welcome'
%}
```

## See Also

- [Constants Overview](README.md) -- introduction and key concepts
- [Constants Configuration](configuration.md) -- CLI and GraphQL setup
- [Constants Patterns](patterns.md) -- real-world usage workflows
- [Constants Gotchas](gotchas.md) -- common errors and troubleshooting
- [Liquid Objects Reference](../liquid/objects/README.md) -- `context` object details
- [GraphQL Reference](../graphql/README.md) -- query and mutation patterns
