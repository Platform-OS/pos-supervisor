# modules/openai - API Reference

## Chat Completions

### Basic Chat Query
Send a message to OpenAI:

```liquid
{% graphql response = 'modules/openai/queries/chat/completions',
  model: 'gpt-3.5-turbo',
  messages: messages_array,
  max_tokens: 500
%}

{{ response.choices[0].message.content }}
```

### Chat with Parameters
```graphql
query ChatCompletion($messages: [JSON!]!, $temperature: Float) {
  chat_completion(data: {
    model: "gpt-3.5-turbo"
    messages: $messages
    temperature: $temperature
    max_tokens: 1000
  }) {
    choices {
      message {
        content
        role
      }
    }
    usage {
      prompt_tokens
      completion_tokens
      total_tokens
    }
  }
}
```

### Streaming Response
```liquid
{% graphql response = 'modules/openai/queries/chat/completions_stream',
  messages: messages_array,
  stream: true
%}
```

## Embeddings

### Generate Embedding
Convert text to embeddings:

```liquid
{% graphql embeddings = 'modules/openai/queries/embeddings/create',
  input: 'This is a sample text',
  model: 'text-embedding-3-large'
%}

{% assign embedding = embeddings.data[0].embedding %}
```

### Batch Embeddings
```graphql
query CreateEmbeddings($texts: [String!]!) {
  embeddings(data: {
    input: $texts
    model: "text-embedding-3-large"
  }) {
    data {
      index
      embedding
    }
  }
}
```

## Moderation

### Check Content Moderation
```liquid
{% graphql moderation = 'modules/openai/queries/moderation/check',
  input: 'User input text'
%}

{% if moderation.results[0].flagged %}
  <p>Content flagged for moderation</p>
{% endif %}
```

## Models

### List Available Models
```liquid
{% graphql models = 'modules/openai/queries/models/list' %}

{% for model in models %}
  <p>{{ model.id }}</p>
{% endfor %}
```

### Get Model Details
```graphql
query GetModel($model_id: String!) {
  model(id: $model_id) {
    id
    owned_by
    permission {
      allow
      deny
    }
  }
}
```

## Usage and Billing

### Get Usage Statistics
```liquid
{% graphql usage = 'modules/openai/queries/usage/current_month' %}

<p>Total Requests: {{ usage.total_requests }}</p>
<p>Total Tokens: {{ usage.total_tokens }}</p>
<p>Estimated Cost: ${{ usage.estimated_cost }}</p>
```

## Error Handling

### Handle API Errors
```liquid
{% graphql %}
  query ChatCompletion {
    chat_completion(data: {
      model: "gpt-3.5-turbo"
      messages: [...]
    }) {
      choices { message { content } }
      error { message, code }
    }
  }
{% endgraphql %}

{% if response.error %}
  <p>Error: {{ response.error.message }}</p>
{% endif %}
```

## See Also
- configuration.md - Setup and configuration
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced features
