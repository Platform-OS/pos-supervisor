# modules/openai - Configuration

## Overview
The `modules/openai` is an optional module for integrating OpenAI capabilities. It provides chat completions, embeddings, and AI-powered features into your platformOS applications.

## Installation

### Install OpenAI Module
```bash
pos-cli modules install openai
```

### Verify Installation
```bash
pos-cli modules list | grep openai
```

## API Key Configuration

### Set OpenAI API Key
Configure your OpenAI API key as an environment variable:

```bash
pos-cli env set OPENAI_API_KEY sk-proj-xxxxx
```

### Get API Key
1. Go to https://platform.openai.com/api-keys
2. Create a new secret key
3. Copy and store securely

### Test Configuration
Verify your API key is configured:

```liquid
{% graphql models = 'modules/openai/queries/models/available' %}
{% if models %}
  OpenAI is properly configured
{% endif %}
```

## Model Selection

### Available Models
Popular OpenAI models:

```
- gpt-4-turbo: Latest GPT-4 with 128K context
- gpt-4: Original GPT-4 model
- gpt-3.5-turbo: Fastest and cheapest
- text-embedding-3-large: For embeddings
- text-embedding-3-small: Smaller embeddings
```

### Set Default Model
Configure your preferred model:

```bash
pos-cli env set OPENAI_DEFAULT_MODEL gpt-3.5-turbo
```

## Usage Configuration

### Rate Limiting
Set API call limits:

```bash
pos-cli env set OPENAI_MAX_TOKENS 2000
pos-cli env set OPENAI_REQUESTS_PER_MINUTE 60
```

### Cost Controls
Limit spending:

```bash
pos-cli env set OPENAI_MAX_MONTHLY_COST 100
```

## Environment Setup

### Required Variables
```bash
OPENAI_API_KEY=sk-proj-xxxxx
```

### Optional Variables
```bash
OPENAI_DEFAULT_MODEL=gpt-3.5-turbo
OPENAI_MAX_TOKENS=2000
OPENAI_TEMPERATURE=0.7
OPENAI_ORG_ID=org-xxxxx
```

## Safety Configuration

### Content Moderation
Enable moderation checks:

```bash
pos-cli env set OPENAI_ENABLE_MODERATION=true
```

### Usage Monitoring
Monitor API usage:

```liquid
{% graphql usage = 'modules/openai/queries/usage/current_month' %}
<!-- Returns: total_requests, total_tokens, estimated_cost -->
```

## Error Handling

### Handle API Errors
Configure error behavior:

```bash
pos-cli env set OPENAI_RETRY_ATTEMPTS=3
pos-cli env set OPENAI_RETRY_DELAY_MS=1000
```

## See Also
- api.md - API endpoints and methods
- patterns.md - Common usage patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced configuration
