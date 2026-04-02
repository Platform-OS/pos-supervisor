# modules/openai - Common Gotchas

## Missing API Key

Always set the OpenAI API key:

```bash
# WRONG - no key set
# pos-cli env list
# No OPENAI_API_KEY

# CORRECT - set the key
pos-cli env set OPENAI_API_KEY sk-proj-xxxxx
```

Verify it's set:
```liquid
{% graphql models = 'modules/openai/queries/models/available' %}
<!-- Will fail if API key is missing -->
```

## Exceeding Token Limits

Requests fail if they exceed token limits:

```liquid
<!-- WRONG - no token limit check -->
{% assign very_long_text = article.body %}
{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages,
  max_tokens: 10000,
  input: very_long_text
%}

<!-- CORRECT - check token count first -->
{% assign token_count = calculate_tokens(very_long_text) %}
{% if token_count < 3000 %}
  {% graphql response = 'modules/openai/queries/chat/completions',
    messages: messages
  %}
{% else %}
  <p>Text is too long, please summarize first</p>
{% endif %}
```

## Hardcoding API Parameters

Don't hardcode model or settings:

```liquid
<!-- WRONG - hardcoded -->
{% graphql response = 'modules/openai/queries/chat/completions',
  model: 'gpt-4-turbo',
  temperature: 0.9
%}

<!-- CORRECT - use configurable values -->
{% graphql response = 'modules/openai/queries/chat/completions',
  model: site.openai_model,
  temperature: site.openai_temperature
%}
```

## Not Handling Rate Limits

Handle rate limiting errors gracefully:

```liquid
<!-- WRONG - no retry logic -->
{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}

<!-- CORRECT - handle rate limits -->
{% assign max_retries = 3 %}
{% assign retry_count = 0 %}
{% assign success = false %}

{% for i in (1..max_retries) %}
  {% if success == false %}
    {% graphql response = 'modules/openai/queries/chat/completions',
      messages: messages
    %}
    {% if response.error and response.error.code == 'rate_limit_exceeded' %}
      <!-- Wait before retrying -->
    {% else %}
      {% assign success = true %}
    {% endif %}
  {% endif %}
{% endfor %}
```

## Exposing API Key in Logs

Never log the API key:

```liquid
<!-- WRONG - exposes API key -->
{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}
{% log response %} <!-- Key might be in error logs -->

<!-- CORRECT - sanitize logs -->
{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}
{% assign safe_response = response | except: 'api_key' %}
{% log safe_response %}
```

## Not Validating User Input

Always sanitize user input before sending to OpenAI:

```liquid
<!-- WRONG - direct user input -->
{% assign user_input = context.params.message %}
{% graphql response = 'modules/openai/queries/chat/completions',
  messages: [{
    role: 'user',
    content: user_input
  }]
%}

<!-- CORRECT - validate and sanitize -->
{% assign user_input = context.params.message | strip | truncate: 2000 %}
{% if user_input.size > 0 %}
  {% graphql response = 'modules/openai/queries/chat/completions',
    messages: [{
      role: 'user',
      content: user_input
    }]
  %}
{% endif %}
```

## Ignoring Content Moderation

Always check moderation for user content:

```liquid
<!-- WRONG - no moderation check -->
{% graphql response = 'modules/openai/queries/chat/completions',
  messages: [{
    role: 'user',
    content: user_input
  }]
%}

<!-- CORRECT - check moderation first -->
{% graphql moderation = 'modules/openai/queries/moderation/check',
  input: user_input
%}

{% if moderation.results[0].flagged %}
  <p>Please follow community guidelines</p>
{% else %}
  {% graphql response = 'modules/openai/queries/chat/completions',
    messages: [{
      role: 'user',
      content: user_input
    }]
  %}
{% endif %}
```

## Forgetting to Set System Prompt

System prompts are important for behavior:

```liquid
<!-- WRONG - no system context -->
{% assign messages = [{
  role: 'user',
  content: question
}] %}

<!-- CORRECT - include system prompt -->
{% assign messages = [{
  role: 'system',
  content: 'You are a helpful customer support assistant'
}, {
  role: 'user',
  content: question
}] %}
```

## Caching Responses Indefinitely

Don't cache responses forever:

```liquid
<!-- WRONG - stale cache -->
{% if cached_response %}
  {{ cached_response }}
{% else %}
  {% graphql response = 'modules/openai/queries/chat/completions',
    messages: messages
  %}
  {% assign cached_response = response %}
{% endif %}

<!-- CORRECT - cache with expiration -->
{% assign cache_timestamp = 'now' | date: '%s' %}
{% if cached_response and cache_timestamp < one_hour_ago %}
  {{ cached_response }}
{% else %}
  {% graphql response = 'modules/openai/queries/chat/completions',
    messages: messages
  %}
{% endif %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Common patterns
- advanced.md - Advanced features
