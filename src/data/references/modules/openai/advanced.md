# modules/openai - Advanced Features

## Custom Prompting Strategies

### Few-Shot Prompting
Provide examples for better results:

```liquid
{% assign few_shot_prompt = "
Classify the sentiment of tweets:

Tweet: 'I love this product!'
Sentiment: positive

Tweet: 'This is terrible'
Sentiment: negative

Tweet: '" | append: tweet.text | append: "'
Sentiment:"
%}

{% assign messages = [{
  role: 'user',
  content: few_shot_prompt
}] %}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}
```

### Chain of Thought Prompting
Break complex problems into steps:

```liquid
{% assign prompt = "Let's solve this step by step:

Problem: " | append: problem | append: "

Step 1: Identify the key information
Step 2: Break down the problem
Step 3: Solve each part
Step 4: Combine solutions

Answer:" %}
```

### Prompt Templates
Reuse prompt patterns:

```liquid
<!-- app/lib/openai/prompts/classify.liquid -->
{% assign system_prompt = 'You are an expert classifier. Classify the input into one of these categories: ' | append: categories | join: ', ' %}

{% assign user_prompt = 'Classify this: ' | append: input %}
```

## Context Window Management

### Sliding Window for Long Conversations
```liquid
{% assign context_messages = messages | last: 10 %}
<!-- Keep only last 10 messages in context -->

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: context_messages
%}
```

### Token Counting
```liquid
{% assign tokens_per_message = 4 %}
{% assign tokens_per_word = 1.3 %}

{% assign estimated_tokens = 0 %}
{% for msg in messages %}
  {% assign word_count = msg.content | split: ' ' | size %}
  {% assign estimated_tokens = estimated_tokens | plus: word_count | times: tokens_per_word %}
  {% assign estimated_tokens = estimated_tokens | plus: tokens_per_message %}
{% endfor %}
```

## Streaming Responses

### Implement Streaming Chat
```liquid
{% graphql response = 'modules/openai/queries/chat/completions_stream',
  messages: messages,
  stream: true
%}

<!-- Handle streaming chunks -->
{% for chunk in response.stream %}
  {% if chunk.choices[0].delta.content %}
    {{ chunk.choices[0].delta.content }}
  {% endif %}
{% endfor %}
```

## Advanced Embeddings

### Embedding-Based Similarity Search
```liquid
<!-- Generate embedding for search query -->
{% graphql embeddings = 'modules/openai/queries/embeddings/create',
  input: search_query
%}

{% assign query_embedding = embeddings.data[0].embedding %}

<!-- Compare with document embeddings using cosine similarity -->
{% for doc in documents %}
  {% assign similarity = cosine_similarity(query_embedding, doc.embedding) %}
  {% if similarity > 0.75 %}
    <!-- Highly relevant document -->
  {% endif %}
{% endfor %}
```

### Clustering Similar Content
```liquid
<!-- Group similar documents using embeddings -->
{% graphql embeddings = 'modules/openai/queries/embeddings/create',
  input: all_texts
%}

<!-- Use clustering algorithm on embeddings -->
{% for embedding in embeddings.data %}
  {% assign cluster = find_nearest_cluster(embedding) %}
  <!-- Group documents by cluster -->
{% endfor %}
```

## Function Calling

### Define Custom Functions
```graphql
mutation ChatWithFunctions($messages: [JSON!]!, $functions: [JSON!]!) {
  chat_completion_with_functions(data: {
    model: "gpt-3.5-turbo"
    messages: $messages
    functions: $functions
  }) {
    choices {
      message {
        content
        function_call {
          name
          arguments
        }
      }
    }
  }
}
```

### Use Function Results
```liquid
{% if response.message.function_call %}
  {% assign function_name = response.message.function_call.name %}
  {% assign function_args = response.message.function_call.arguments | to_hash %}

  {% case function_name %}
    {% when 'get_weather' %}
      {% assign weather = get_weather(function_args.location) %}
    {% when 'get_stock_price' %}
      {% assign price = get_stock_price(function_args.symbol) %}
  {% endcase %}
{% endif %}
```

## Fine-Tuning Models

### Prepare Fine-Tuning Data
```liquid
{% comment %} Format for fine-tuning {% endcomment %}
{% assign training_data = '{"prompt": "Input", "completion": " Output"}' %}
```

### Monitor Fine-Tuning Job
```liquid
{% graphql result = 'modules/openai/queries/finetune/status',
  job_id: job_id
%}

{% if result.status == 'succeeded' %}
  Fine-tuning complete, model ready to use
{% endif %}
```

## Cost Optimization

### Estimate Request Costs
```liquid
{% assign tokens = calculate_tokens(messages) %}
{% assign input_cost = tokens.prompt_tokens | times: 0.0005 | divided_by: 1000 %}
{% assign output_cost = tokens.completion_tokens | times: 0.0015 | divided_by: 1000 %}
{% assign total_cost = input_cost | plus: output_cost %}
```

### Batch Processing
```liquid
{% assign batch_size = 100 %}
{% for i in (0..documents.size) %}
  {% assign start = i | times: batch_size %}
  {% assign batch = documents | slice: start, batch_size %}

  {% graphql embeddings = 'modules/openai/queries/embeddings/create',
    input: batch
  %}
{% endfor %}
```

## Production Monitoring

### Log and Monitor API Calls
```liquid
{% graphql %}
  mutation LogOpenAICall(
    $model: String!,
    $tokens: Int!,
    $cost: Float!
  ) {
    openai_log_create(data: {
      model: $model
      tokens: $tokens
      cost: $cost
      timestamp: "now"
    }) {
      log { id }
    }
  }
{% endgraphql %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Common patterns
- gotchas.md - Common mistakes
