# modules/chat - Configuration

## Overview
The `modules/chat` is an optional module for real-time WebSocket messaging. It supports direct messages between users, group channels, message persistence, and presence detection.

## Installation

### Install Chat Module
```bash
pos-cli modules install chat
```

### Verify Installation
```bash
pos-cli modules list | grep chat
```

## WebSocket Configuration

### Initialize WebSocket Connection
Setup the chat client in your layout:

```liquid
{% render 'modules/chat/init' %}

<script>
  const chatClient = new PlatformOS.Chat({
    user_id: {{ current_user.id }},
    token: '{{ chat_auth_token }}'
  });
</script>
```

### Required CSS
Include chat styles:

```liquid
{% render 'modules/chat/styles' %}
```

## Connection Setup

### Establish Connection
```javascript
chatClient.connect().then(() => {
  console.log('Connected to chat');
}).catch((error) => {
  console.error('Connection failed:', error);
});
```

### Connection Options
```javascript
const options = {
  reconnect: true,
  reconnect_delay: 5000,
  max_reconnect_attempts: 10,
  heartbeat_interval: 30000
};

const chatClient = new PlatformOS.Chat(options);
```

## Authentication

### Generate Chat Token
Create authentication token for chat:

```liquid
{% graphql token = 'modules/chat/queries/auth/token' %}
```

### Token Refresh
Refresh token before expiration:

```javascript
setInterval(() => {
  chatClient.refresh_token().then((token) => {
    console.log('Token refreshed');
  });
}, 55 * 60 * 1000); // Refresh every 55 minutes
```

## Presence Configuration

### Enable Presence Tracking
```javascript
chatClient.presence.enable({
  update_interval: 5000
});
```

### Presence Events
```javascript
chatClient.on('presence:online', (user) => {
  console.log(`${user.name} came online`);
});

chatClient.on('presence:offline', (user) => {
  console.log(`${user.name} went offline`);
});
```

## Persistence Configuration

### Message Storage
Configure message history:

```liquid
{% assign message_retention_days = 30 %}
{% assign max_history_size = 10000 %}
```

### Access Message History
```liquid
{% graphql messages = 'modules/chat/queries/messages/history',
  channel_id: channel_id,
  limit: 50,
  offset: 0
%}
```

## Channel Configuration

### Channel Types
- Direct: One-to-one messages
- Group: Multiple users
- Public: Open to all users

### Create Channel
```liquid
{% graphql channel = 'modules/chat/mutations/channels/create',
  type: 'group',
  name: 'Development Team'
%}
```

## See Also
- api.md - API endpoints and methods
- patterns.md - Common chat patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced configuration
