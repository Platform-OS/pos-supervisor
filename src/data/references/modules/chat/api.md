# modules/chat - API Reference

## Chat Client Methods

### connect()
Establish WebSocket connection:

```javascript
chatClient.connect()
  .then(() => console.log('Connected'))
  .catch((err) => console.error('Failed:', err));
```

### disconnect()
Close WebSocket connection:

```javascript
chatClient.disconnect();
```

### is_connected()
Check connection status:

```javascript
if (chatClient.is_connected()) {
  console.log('Chat is connected');
}
```

## Message Methods

### send_message()
Send a message to a channel or user:

```javascript
chatClient.send_message({
  channel_id: 'channel-123',
  content: 'Hello, world!',
  type: 'text'
});
```

### send_direct_message()
Send direct message to a user:

```javascript
chatClient.send_direct_message({
  recipient_id: 'user-456',
  content: 'Private message'
});
```

### get_history()
Retrieve message history:

```javascript
chatClient.get_history({
  channel_id: 'channel-123',
  limit: 50,
  offset: 0
}).then((messages) => {
  console.log(messages);
});
```

### edit_message()
Edit a sent message:

```javascript
chatClient.edit_message({
  message_id: 'msg-789',
  content: 'Updated message'
});
```

### delete_message()
Delete a message:

```javascript
chatClient.delete_message({
  message_id: 'msg-789'
});
```

## Channel Methods

### join_channel()
Join a channel:

```javascript
chatClient.join_channel('channel-123')
  .then(() => console.log('Joined'));
```

### leave_channel()
Leave a channel:

```javascript
chatClient.leave_channel('channel-123');
```

### create_channel()
Create a new channel:

```javascript
chatClient.create_channel({
  name: 'Development',
  type: 'group',
  members: ['user-1', 'user-2']
});
```

### get_channels()
List user's channels:

```javascript
chatClient.get_channels()
  .then((channels) => {
    channels.forEach((ch) => {
      console.log(ch.name);
    });
  });
```

## Presence Methods

### get_online_users()
Get list of online users:

```javascript
const online = chatClient.presence.get_online_users();
console.log(`${online.length} users online`);
```

### set_presence()
Update presence status:

```javascript
chatClient.presence.set_presence('away');
// Options: 'online', 'away', 'busy', 'offline'
```

## Event Listeners

### on()
Listen to chat events:

```javascript
chatClient.on('message', (message) => {
  console.log(`New message: ${message.content}`);
});

chatClient.on('presence:online', (user) => {
  console.log(`${user.name} came online`);
});

chatClient.on('channel:created', (channel) => {
  console.log(`Channel ${channel.name} created`);
});
```

### off()
Remove event listener:

```javascript
chatClient.off('message');
```

## Error Handling

### Connection Error
```javascript
chatClient.on('error', (error) => {
  console.error('Chat error:', error.code, error.message);
});
```

### Reconnection
```javascript
chatClient.on('reconnect', () => {
  console.log('Reconnected to chat');
});
```

## See Also
- configuration.md - Setup and configuration
- patterns.md - Common chat patterns
- gotchas.md - Common mistakes
- advanced.md - Advanced features
