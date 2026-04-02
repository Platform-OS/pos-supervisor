# modules/openai - Common Patterns

## Basic Chat Pattern

### Simple Chatbot
```liquid
{% liquid
  assign user_message = context.params.message
  assign messages = messages | push: { role: 'user', content: user_message }
%}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages,
  model: 'gpt-3.5-turbo',
  max_tokens: 500
%}

{% assign assistant_reply = response.choices[0].message.content %}
{% assign messages = messages | push: { role: 'assistant', content: assistant_reply } %}

<div class="pos-card">
  <p>{{ assistant_reply }}</p>
</div>
```

### Multi-Turn Conversation
```liquid
{% graphql conversation_messages = 'queries/conversation/messages', conversation_id: conversation_id %}

{% liquid
  assign messages = {}
  assign messages.role = 'system'
  assign messages.content = 'You are a helpful assistant.'
%}

{% for msg in conversation_messages %}
  {% assign messages = messages | push: {
    role: msg.role,
    content: msg.text
  } %}
{% endfor %}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}
```

## Content Generation Pattern

### Generate Product Description
```liquid
{% liquid
  assign product_name = product.name
  assign product_category = product.category
%}

{% assign prompt = "Generate a compelling product description for: " | append: product_name | append: " in the " | append: product_category | append: " category. Keep it under 100 words." %}

{% assign messages = [{ "role": "user", "content": prompt }] %}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages,
  temperature: 0.7
%}

{% assign description = response.choices[0].message.content %}
```

## Q&A Pattern

### Answer Support Questions
```liquid
{% liquid
  assign user_question = context.params.question
  assign knowledge_base = site.faq
%}

{% assign system_prompt = "You are a helpful support assistant. Use the following knowledge base to answer questions:" %}

{% assign context = knowledge_base | map: 'answer' | join: ' ' %}

{% assign messages = [{ "role": "system", "content": system_prompt }, { "role": "user", "content": user_question }] %}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}
```

## Embedding and Search Pattern

### Semantic Search
```liquid
{% graphql embeddings = 'modules/openai/queries/embeddings/create',
  input: search_query
%}

{% assign query_embedding = embeddings.data[0].embedding %}

<!-- Compare with stored embeddings to find similar content -->
{% for doc in documents %}
  {% assign similarity = calculate_similarity(query_embedding, doc.embedding) %}
  {% if similarity > 0.7 %}
    <!-- Relevant result -->
  {% endif %}
{% endfor %}
```

## Content Moderation Pattern

### Filter User Generated Content
```liquid
{% graphql moderation = 'modules/openai/queries/moderation/check',
  input: user_comment
%}

{% if moderation.results[0].flagged %}
  <div class="pos-alert pos-alert-warning">
    This content violates our community guidelines
  </div>
{% else %}
  {% comment %} Save the comment {% endcomment %}
{% endif %}
```

## Summarization Pattern

### Summarize Long Content
```liquid
{% assign full_text = article.body %}

{% assign prompt = "Please summarize the following article in 3 bullet points:" %}

{% assign full_prompt = prompt | append: '\n\n' | append: full_text %}
{% assign messages = [{ "role": "user", "content": full_prompt }] %}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages,
  max_tokens: 300
%}

<div class="pos-card">
  <h3>Summary</h3>
  <p>{{ response.choices[0].message.content }}</p>
</div>
```

## Classification Pattern

### Classify User Input
```liquid
{% assign categories = 'urgent,normal,low-priority' | split: ',' %}

{% assign prompt = "Classify the following support ticket into one of these categories: " | append: categories | join: ', ' | append: "\n\nTicket: " | append: ticket.description %}

{% assign messages = [{ "role": "user", "content": prompt }] %}

{% graphql response = 'modules/openai/queries/chat/completions',
  messages: messages
%}

{% assign category = response.choices[0].message.content %}
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- gotchas.md - Common mistakes
- advanced.md - Advanced features
