# modules/chat - Common Gotchas

## Connection Not Established

Always check connection before sending messages:

```javascript
// WRONG - no connection check
chatClient.send_message({
  channel_id: 'channel-123',
  content: 'Hello'
});

// CORRECT - verify connection first
if (chatClient.is_connected()) {
  chatClient.send_message({
    channel_id: 'channel-123',
    content: 'Hello'
  });
} else {
  console.error('Chat not connected');
}
```

## Missing Authentication Token

Always generate and pass a valid token:

```javascript
// WRONG - no token
const chatClient = new PlatformOS.Chat({
  user_id: userId
});

// CORRECT - include auth token
const chatClient = new PlatformOS.Chat({
  user_id: userId,
  token: authToken
});
```

## Race Condition on Reconnect

Handle reconnection delays properly:

```javascript
// WRONG - assumes immediate reconnection
chatClient.on('disconnect', () => {
  chatClient.send_message({
    channel_id: 'test',
    content: 'Back online'
  });
});

// CORRECT - wait for reconnection
chatClient.on('reconnect', () => {
  chatClient.send_message({
    channel_id: 'test',
    content: 'Back online'
  });
});
```

## Not Handling Message Delivery Failures

Always handle sending errors:

```javascript
// WRONG - no error handling
chatClient.send_message({
  channel_id: 'test',
  content: 'Message'
});

// CORRECT - catch delivery errors
chatClient.send_message({
  channel_id: 'test',
  content: 'Message'
}).catch((error) => {
  console.error('Failed to send:', error);
  showErrorNotification('Message failed to send');
});
```

## Duplicate Message Events

Don't listen to the same event multiple times:

```javascript
// WRONG - listener added multiple times
for (let i = 0; i < 5; i++) {
  chatClient.on('message', (msg) => {
    console.log(msg);
  });
}
// Each message logged 5 times!

// CORRECT - set up listener once
chatClient.on('message', (msg) => {
  console.log(msg);
});
```

## Memory Leaks from Unremoved Listeners

Always remove event listeners when done:

```javascript
// WRONG - listener never removed
chatClient.on('message', (msg) => {
  updateUI(msg);
});
// Component destroyed but listener still active

// CORRECT - clean up listeners
function setupChat() {
  chatClient.on('message', messageHandler);
}

function cleanupChat() {
  chatClient.off('message', messageHandler);
}
```

## Sending Very Long Messages

Don't send messages without length validation:

```javascript
// WRONG - no length check
chatClient.send_message({
  channel_id: 'test',
  content: veryLongString // Could be 100KB
});

// CORRECT - validate message length
const MAX_MESSAGE_LENGTH = 2000;
if (message.length <= MAX_MESSAGE_LENGTH) {
  chatClient.send_message({
    channel_id: 'test',
    content: message
  });
} else {
  showErrorNotification('Message too long');
}
```

## Lost Messages on Page Unload

Save unsent messages before navigation:

```javascript
// WRONG - message lost on navigation
let draftMessage = '';
document.getElementById('input').addEventListener('input', (e) => {
  draftMessage = e.target.value;
});

// CORRECT - persist draft
function saveDraft() {
  localStorage.setItem('chat_draft', draftMessage);
}

window.addEventListener('beforeunload', saveDraft);

function loadDraft() {
  const draft = localStorage.getItem('chat_draft');
  if (draft) {
    document.getElementById('input').value = draft;
  }
}
```

## Forgetting to Initialize Chat in Layout

Chat won't work if not initialized:

```html
<!-- WRONG - chat not initialized -->
<body>
  {{ content_for_layout }}
</body>

<!-- CORRECT - include chat init -->
<body class="pos-app">
  {% render 'modules/chat/init' %}
  {{ content_for_layout }}

  <script>
    const chatClient = new PlatformOS.Chat({...});
  </script>
</body>
```

## Blocking User Interface During Message Load

Don't block UI while loading history:

```javascript
// WRONG - freezes UI while loading
const messages = chatClient.get_history({
  channel_id: 'test',
  limit: 1000
});

// CORRECT - load asynchronously
chatClient.get_history({
  channel_id: 'test',
  limit: 1000
}).then((messages) => {
  displayMessages(messages);
});
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- patterns.md - Common patterns
- advanced.md - Advanced features
