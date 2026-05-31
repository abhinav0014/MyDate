const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory store — no DB needed
// rooms: { [roomId]: { password, media, users: Map<ws, {id, name, color}>, messages: [] } }
const rooms = new Map();

const COLORS = [
  '#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF6FC8',
  '#FF9A3C','#A78BFA','#34D399','#F472B6','#38BDF8'
];

function getRoom(roomId) {
  return rooms.get(roomId);
}

function broadcast(room, data, excludeWs = null) {
  const msg = JSON.stringify(data);
  room.users.forEach((user, ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function broadcastAll(room, data) {
  broadcast(room, data, null);
}

function getUserList(room) {
  return Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name, color: u.color }));
}

// REST: create room
app.post('/api/rooms', (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId || !password) return res.status(400).json({ error: 'roomId and password required' });
  if (rooms.has(roomId)) return res.status(409).json({ error: 'Room already exists' });
  
  rooms.set(roomId, {
    password,
    media: null,
    users: new Map(),
    messages: [],
    createdAt: Date.now()
  });
  res.json({ success: true, roomId });
});

// REST: check room exists
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ exists: true, userCount: room.users.size });
});

// REST: join validation
app.post('/api/rooms/:roomId/join', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.password !== req.body.password) return res.status(403).json({ error: 'Wrong password' });
  res.json({ success: true });
});

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentUser = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room || room.password !== msg.password) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid room or password' }));
          return;
        }
        currentRoom = room;
        const colorIndex = room.users.size % COLORS.length;
        currentUser = {
          id: uuidv4(),
          name: msg.username || `Guest${Math.floor(Math.random() * 1000)}`,
          color: COLORS[colorIndex]
        };
        room.users.set(ws, currentUser);

        // Send room state to new user
        ws.send(JSON.stringify({
          type: 'room_state',
          user: currentUser,
          media: room.media,
          messages: room.messages.slice(-50),
          users: getUserList(room)
        }));

        // Notify others
        broadcast(room, {
          type: 'user_joined',
          user: currentUser,
          users: getUserList(room)
        }, ws);

        broadcast(room, {
          type: 'chat',
          id: uuidv4(),
          userId: 'system',
          username: 'System',
          color: '#888',
          text: `${currentUser.name} joined the room`,
          timestamp: Date.now(),
          system: true
        });
        break;
      }

      case 'chat': {
        if (!currentRoom || !currentUser) return;
        const chatMsg = {
          type: 'chat',
          id: uuidv4(),
          userId: currentUser.id,
          username: currentUser.name,
          color: currentUser.color,
          text: String(msg.text).slice(0, 500),
          timestamp: Date.now()
        };
        currentRoom.messages.push(chatMsg);
        if (currentRoom.messages.length > 200) currentRoom.messages.shift();
        broadcastAll(currentRoom, chatMsg);
        break;
      }

      case 'set_media': {
        if (!currentRoom || !currentUser) return;
        currentRoom.media = {
          url: msg.url,
          type: msg.mediaType || 'youtube',
          setBy: currentUser.name,
          setAt: Date.now()
        };
        broadcastAll(currentRoom, {
          type: 'media_changed',
          media: currentRoom.media
        });
        // System message
        const sysMsg = {
          type: 'chat',
          id: uuidv4(),
          userId: 'system',
          username: 'System',
          color: '#888',
          text: `${currentUser.name} changed the media`,
          timestamp: Date.now(),
          system: true
        };
        currentRoom.messages.push(sysMsg);
        broadcastAll(currentRoom, sysMsg);
        break;
      }

      case 'clear_media': {
        if (!currentRoom || !currentUser) return;
        currentRoom.media = null;
        broadcastAll(currentRoom, { type: 'media_changed', media: null });
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentUser) {
      currentRoom.users.delete(ws);
      broadcast(currentRoom, {
        type: 'user_left',
        userId: currentUser.id,
        users: getUserList(currentRoom)
      });
      broadcast(currentRoom, {
        type: 'chat',
        id: uuidv4(),
        userId: 'system',
        username: 'System',
        color: '#888',
        text: `${currentUser.name} left the room`,
        timestamp: Date.now(),
        system: true
      });
      // Cleanup empty rooms after 10 min
      if (currentRoom.users.size === 0) {
        setTimeout(() => {
          if (currentRoom.users.size === 0) {
            // find and delete
            for (const [id, r] of rooms) {
              if (r === currentRoom) { rooms.delete(id); break; }
            }
          }
        }, 10 * 60 * 1000);
      }
    }
  });
});

// Catch-all → serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LiveRoom running on :${PORT}`));
