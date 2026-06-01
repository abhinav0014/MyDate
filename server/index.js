const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const CLIENT_DIR = path.join(__dirname, '..', 'client');
app.use(express.static(CLIENT_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,   // ping every 10s
  pingTimeout: 25000,    // disconnect if no pong in 25s
  transports: ['websocket', 'polling']
});

// rooms: Map<roomId, { password, media, users: Map<socketId, userObj>, messages: [] }>
const rooms = new Map();

const COLORS = [
  '#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF9A3C',
  '#A78BFA','#34D399','#F472B6','#38BDF8','#FB923C'
];

function getUserList(room) {
  return Array.from(room.users.values()).map(u => ({
    id: u.id, name: u.name, color: u.color
  }));
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.users.size === 0) {
    setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.users.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up`);
      }
    }, 10 * 60 * 1000);
  }
}

// ── REST ──
app.post('/api/rooms', (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId || !password) return res.status(400).json({ error: 'roomId and password required' });
  if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) return res.status(400).json({ error: 'Invalid room ID format' });
  if (rooms.has(roomId)) return res.status(409).json({ error: 'Room already exists' });
  rooms.set(roomId, {
    password,
    media: null,
    users: new Map(),
    messages: [],
    createdAt: Date.now()
  });
  console.log(`Room created: ${roomId}`);
  res.json({ success: true, roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ exists: true, userCount: room.users.size });
});

app.post('/api/rooms/:roomId/join', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.password !== req.body.password) return res.status(403).json({ error: 'Wrong password' });
  res.json({ success: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));

// ── SOCKET.IO ──
io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentUser = null;

  socket.on('join', ({ roomId, password, username }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.password !== password) { socket.emit('error', { message: 'Wrong password' }); return; }

    // Leave previous room if any
    if (currentRoomId) {
      socket.leave(currentRoomId);
      const prevRoom = rooms.get(currentRoomId);
      if (prevRoom && currentUser) {
        prevRoom.users.delete(socket.id);
        io.to(currentRoomId).emit('user_left', { userId: currentUser.id, users: getUserList(prevRoom) });
        const leaveMsg = makeSystemMsg(`${currentUser.name} left the room`);
        prevRoom.messages.push(leaveMsg);
        io.to(currentRoomId).emit('chat', leaveMsg);
        cleanupRoom(currentRoomId);
      }
    }

    currentRoomId = roomId;
    const colorIndex = room.users.size % COLORS.length;
    currentUser = {
      id: uuidv4(),
      name: (username || 'Guest').slice(0, 24),
      color: COLORS[colorIndex]
    };
    room.users.set(socket.id, currentUser);
    socket.join(roomId);

    // Send full room state — media includes server timestamp for sync
    socket.emit('room_state', {
      user: currentUser,
      media: room.media,
      messages: room.messages.slice(-100),
      users: getUserList(room)
    });

    // Notify others
    socket.to(roomId).emit('user_joined', { user: currentUser, users: getUserList(room) });
    const joinMsg = makeSystemMsg(`${currentUser.name} joined the room`);
    room.messages.push(joinMsg);
    io.to(roomId).emit('chat', joinMsg);
  });

  socket.on('chat', ({ text }) => {
    if (!currentRoomId || !currentUser) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const msg = {
      type: 'chat',
      id: uuidv4(),
      userId: currentUser.id,
      username: currentUser.name,
      color: currentUser.color,
      text: String(text).slice(0, 500),
      timestamp: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > 200) room.messages.shift();
    io.to(currentRoomId).emit('chat', msg);
  });

  socket.on('set_media', ({ url, mediaType }) => {
    if (!currentRoomId || !currentUser) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.media = {
      url,
      type: mediaType || 'direct',
      setBy: currentUser.name,
      setAt: Date.now(),
      // Sync state
      playing: true,
      position: 0,
      positionSetAt: Date.now()
    };
    io.to(currentRoomId).emit('media_changed', { media: room.media });
    const msg = makeSystemMsg(`${currentUser.name} changed the media`);
    room.messages.push(msg);
    io.to(currentRoomId).emit('chat', msg);
  });

  socket.on('clear_media', () => {
    if (!currentRoomId || !currentUser) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.media = null;
    io.to(currentRoomId).emit('media_changed', { media: null });
  });

  // Playback sync events — broadcast to everyone including sender
  socket.on('media_play', ({ position }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.media) return;
    room.media.playing = true;
    room.media.position = position || 0;
    room.media.positionSetAt = Date.now();
    socket.to(currentRoomId).emit('media_sync', {
      playing: true, position: room.media.position, positionSetAt: room.media.positionSetAt
    });
  });

  socket.on('media_pause', ({ position }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.media) return;
    room.media.playing = false;
    room.media.position = position || 0;
    room.media.positionSetAt = Date.now();
    socket.to(currentRoomId).emit('media_sync', {
      playing: false, position: room.media.position, positionSetAt: room.media.positionSetAt
    });
  });

  socket.on('media_seek', ({ position }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.media) return;
    room.media.position = position || 0;
    room.media.positionSetAt = Date.now();
    socket.to(currentRoomId).emit('media_sync', {
      playing: room.media.playing, position: room.media.position, positionSetAt: room.media.positionSetAt
    });
  });

  // Request current sync state (when joining late)
  socket.on('request_sync', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.media) return;
    const elapsed = (Date.now() - room.media.positionSetAt) / 1000;
    const currentPos = room.media.playing
      ? room.media.position + elapsed
      : room.media.position;
    socket.emit('media_sync', {
      playing: room.media.playing,
      position: currentPos,
      positionSetAt: Date.now()
    });
  });

  socket.on('disconnect', (reason) => {
    if (!currentRoomId || !currentUser) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.users.delete(socket.id);
    io.to(currentRoomId).emit('user_left', { userId: currentUser.id, users: getUserList(room) });
    const msg = makeSystemMsg(`${currentUser.name} left the room`);
    room.messages.push(msg);
    io.to(currentRoomId).emit('chat', msg);
    cleanupRoom(currentRoomId);
  });
});

function makeSystemMsg(text) {
  return {
    type: 'chat',
    id: uuidv4(),
    userId: 'system',
    username: 'System',
    color: '#888',
    text,
    timestamp: Date.now(),
    system: true
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LiveRoom v2 running on :${PORT}`));
