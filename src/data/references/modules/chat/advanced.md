# modules/chat - Advanced Features

## Custom Message Types

### Create Rich Message Types
```javascript
// Send message with metadata
chatClient.send_message({
  channel_id: 'channel-123',
  content: 'Check this product',
  type: 'product_share',
  metadata: {
    product_id: '789',
    product_name: 'Laptop',
    product_price: '$999'
  }
});

// Handle rich message rendering
chatClient.on('message', (msg) => {
  if (msg.type === 'product_share') {
    displayProductCard(msg.metadata);
  } else if (msg.type === 'text') {
    displayTextMessage(msg.content);
  }
});
```

## Encryption Support

### Enable Message Encryption
```javascript
const chatClient = new PlatformOS.Chat({
  user_id: userId,
  token: token,
  encryption: {
    enabled: true,
    algorithm: 'AES-256-GCM'
  }
});
```

### Handle Encrypted Messages
```javascript
chatClient.on('message', async (msg) => {
  if (msg.encrypted) {
    const decrypted = await msg.decrypt();
    console.log('Decrypted:', decrypted.content);
  }
});
```

## Advanced Presence Features

### Custom Presence Status
```javascript
chatClient.presence.set_presence('in_call', {
  current_call_duration: 125,
  with_users: ['user-1', 'user-2']
});
```

### Presence Subscriptions
```javascript
chatClient.presence.subscribe_to_user('user-123', {
  update_interval: 2000
}).then(() => {
  console.log('Watching user-123');
});
```

## Rate Limiting

### Implement Message Rate Limiting
```javascript
const rateLimiter = {
  max_messages: 5,
  time_window: 10000,
  messages: [],

  canSend() {
    const now = Date.now();
    this.messages = this.messages.filter(t => now - t < this.time_window);
    return this.messages.length < this.max_messages;
  },

  recordMessage() {
    this.messages.push(Date.now());
  }
};

document.getElementById('send-btn').addEventListener('click', () => {
  if (!rateLimiter.canSend()) {
    showWarning('Too many messages. Please slow down.');
    return;
  }

  chatClient.send_message({...});
  rateLimiter.recordMessage();
});
```

## Archiving and Search

### Search Messages
```javascript
chatClient.search_messages({
  query: 'deployment issue',
  channel_id: 'channel-123',
  limit: 20
}).then((results) => {
  console.log(`Found ${results.length} messages`);
  displaySearchResults(results);
});
```

### Archive Channel
```javascript
chatClient.archive_channel('channel-123')
  .then(() => console.log('Channel archived'));
```

## Moderation Features

### Message Moderation
```javascript
chatClient.on('message', (msg) => {
  if (isSuspicious(msg.content)) {
    chatClient.flag_message({
      message_id: msg.id,
      reason: 'spam',
      notify_moderators: true
    });
  }
});

function isSuspicious(content) {
  const bannedWords = ['spam', 'harmful'];
  return bannedWords.some(word => content.includes(word));
}
```

### User Ban
```javascript
chatClient.ban_user({
  user_id: 'user-456',
  reason: 'harassment',
  duration_hours: 24
});
```

## File Sharing

### Share Files in Chat
```javascript
function uploadFile(file, channelId) {
  const formData = new FormData();
  formData.append('file', file);

  chatClient.upload_file(formData)
    .then((fileData) => {
      chatClient.send_message({
        channel_id: channelId,
        type: 'file',
        content: `File: ${file.name}`,
        file_id: fileData.id,
        file_size: fileData.size
      });
    });
}

document.getElementById('file-input').addEventListener('change', (e) => {
  uploadFile(e.target.files[0], currentChannelId);
});
```

## Analytics and Monitoring

### Track Chat Metrics
```javascript
const chatAnalytics = {
  messagesSent: 0,
  messagesReceived: 0,
  averageResponseTime: 0,

  track() {
    chatClient.on('message:sent', () => {
      this.messagesSent++;
    });

    chatClient.on('message', () => {
      this.messagesReceived++;
    });
  },

  report() {
    console.log(`Sent: ${this.messagesSent}, Received: ${this.messagesReceived}`);
  }
};

chatAnalytics.track();
```

## Custom Message Reactions

### Add Emoji Reactions
```javascript
chatClient.add_reaction({
  message_id: 'msg-789',
  emoji: '👍'
});

chatClient.remove_reaction({
  message_id: 'msg-789',
  emoji: '👍'
});

chatClient.on('reaction:added', (data) => {
  console.log(`${data.user_name} reacted with ${data.emoji}`);
  updateReactionsUI(data.message_id);
});
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Common patterns
- gotchas.md - Common mistakes
