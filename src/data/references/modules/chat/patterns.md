# modules/chat - Common Patterns

## Basic Chat Setup

### Initialize Chat Application
```html
<div id="chat-app">
  <div id="channels-list"></div>
  <div id="messages-area"></div>
  <input id="message-input" type="text" placeholder="Type message...">
</div>

<script>
  const chatClient = new PlatformOS.Chat({
    user_id: {{ current_user.id }},
    token: '{{ chat_token }}'
  });

  chatClient.connect().then(() => {
    console.log('Chat ready');
    loadChannels();
  });
</script>
```

## Direct Messaging Pattern

### Send Direct Message
```javascript
function sendDirectMessage(recipientId, message) {
  chatClient.send_direct_message({
    recipient_id: recipientId,
    content: message
  });
}

document.getElementById('send-btn').addEventListener('click', () => {
  const message = document.getElementById('message-input').value;
  sendDirectMessage(recipientId, message);
  document.getElementById('message-input').value = '';
});
```

### Display Direct Message Thread
```javascript
chatClient.on('message', (msg) => {
  if (msg.channel_type === 'direct') {
    const senderName = msg.sender_name;
    const content = msg.content;
    const timestamp = new Date(msg.created_at).toLocaleTimeString();

    appendMessageToUI(senderName, content, timestamp);
  }
});
```

## Channel Management Pattern

### Join and Load Channel
```javascript
async function openChannel(channelId) {
  await chatClient.join_channel(channelId);
  const history = await chatClient.get_history({
    channel_id: channelId,
    limit: 50
  });

  displayMessages(history);
}
```

### List User Channels
```javascript
chatClient.get_channels().then((channels) => {
  const html = channels.map((ch) => `
    <div class="pos-card" onclick="openChannel('${ch.id}')">
      <h3>${ch.name}</h3>
      <p>${ch.member_count} members</p>
    </div>
  `).join('');

  document.getElementById('channels-list').innerHTML = html;
});
```

## Presence Pattern

### Show Online Status
```javascript
const onlineUsers = chatClient.presence.get_online_users();

function updateUserStatus(userId) {
  const isOnline = onlineUsers.find(u => u.id === userId);
  const status = isOnline ? 'online' : 'offline';
  const statusColor = isOnline ? 'green' : 'gray';

  return `<span style="color: ${statusColor}">● ${status}</span>`;
}

chatClient.on('presence:online', (user) => {
  console.log(`${user.name} is online`);
  updateUsersList();
});

chatClient.on('presence:offline', (user) => {
  console.log(`${user.name} went offline`);
  updateUsersList();
});
```

## Message History Pattern

### Load More Messages
```javascript
let messageOffset = 0;
const MESSAGES_PER_PAGE = 50;

async function loadMoreMessages(channelId) {
  const messages = await chatClient.get_history({
    channel_id: channelId,
    limit: MESSAGES_PER_PAGE,
    offset: messageOffset
  });

  prependMessages(messages);
  messageOffset += MESSAGES_PER_PAGE;
}

document.getElementById('messages-area').addEventListener('scroll', (e) => {
  if (e.target.scrollTop === 0) {
    loadMoreMessages(currentChannelId);
  }
});
```

## Notification Pattern

### Show New Message Notification
```javascript
let unreadCount = 0;

chatClient.on('message', (msg) => {
  if (!isCurrentChannel(msg.channel_id)) {
    unreadCount++;
    updateBadge(unreadCount);

    if ('Notification' in window) {
      new Notification('New message', {
        body: msg.content,
        icon: '/chat-icon.png'
      });
    }
  }
});
```

## Typing Indicator Pattern

### Send Typing Indicator
```javascript
const typingDebounce = debounce(() => {
  chatClient.send_typing_indicator(channelId);
}, 500);

document.getElementById('message-input').addEventListener('input', typingDebounce);
```

### Show Typing Status
```javascript
chatClient.on('typing', (user) => {
  const typingEl = document.getElementById('typing-indicator');
  typingEl.innerHTML = `${user.name} is typing...`;
});

chatClient.on('typing:stop', (user) => {
  const typingEl = document.getElementById('typing-indicator');
  typingEl.innerHTML = '';
});
```

## See Also
- configuration.md - Setup instructions
- api.md - API reference
- gotchas.md - Common mistakes
- advanced.md - Advanced features
