const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { roomId -> { host, members, state } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        host: socket.id,
        members: {},
        state: { action: 'pause', time: 0, videoUrl: '', isLive: false }
      };
      rooms[roomId].members[socket.id] = username;
      socket.emit('roleAssigned', { role: 'host' });
      console.log(`[Room] ${roomId} created by ${username}`);
    } else {
      rooms[roomId].members[socket.id] = username;
      socket.emit('roleAssigned', { role: 'guest' });
      // Send current room state to the new guest
      const { videoUrl, action, time, isLive } = rooms[roomId].state;
      if (videoUrl) socket.emit('loadVideo', { videoUrl });
      socket.emit('syncAction', { action, time, isLive });
      console.log(`[Room] ${username} joined ${roomId}`);
    }

    io.to(roomId).emit('memberList', buildMemberList(roomId));
  });

  socket.on('setVideo', ({ roomId, videoUrl }) => {
    if (!rooms[roomId] || rooms[roomId].host !== socket.id) return;
    rooms[roomId].state.videoUrl = videoUrl;
    rooms[roomId].state.time = 0;
    io.to(roomId).emit('loadVideo', { videoUrl });
  });

  socket.on('videoAction', ({ roomId, action, time, isLive }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].state = { ...rooms[roomId].state, action, time, isLive: !!isLive };
    socket.to(roomId).emit('syncAction', { action, time, isLive });
    console.log(`[Sync] ${roomId} | ${action} @ ${(time||0).toFixed(1)}s ${isLive ? '(live)' : ''}`);
  });

  socket.on('heartbeat', ({ roomId, time, playing, isLive }) => {
    if (!rooms[roomId] || rooms[roomId].host !== socket.id) return;
    rooms[roomId].state.time = time;
    rooms[roomId].state.isLive = !!isLive;
    socket.to(roomId).emit('heartbeat', { time, playing, isLive });
  });

  socket.on('chatMessage', ({ roomId, message }) => {
    const username = socket.data.username || 'Anonymous';
    io.to(roomId).emit('chatMessage', { username, message, time: Date.now() });
  });

  socket.on('disconnect', () => {
    const { roomId, username } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    delete rooms[roomId].members[socket.id];
    console.log(`[-] ${username} left ${roomId}`);

    if (rooms[roomId].host === socket.id) {
      const remaining = Object.keys(rooms[roomId].members);
      if (remaining.length > 0) {
        rooms[roomId].host = remaining[0];
        io.to(remaining[0]).emit('roleAssigned', { role: 'host' });
        io.to(roomId).emit('chatMessage', {
          username: 'System',
          message: `${rooms[roomId].members[remaining[0]]} is now the host.`,
          time: Date.now()
        });
      } else {
        delete rooms[roomId];
        return;
      }
    }

    io.to(roomId).emit('memberList', buildMemberList(roomId));
  });
});

function buildMemberList(roomId) {
  const room = rooms[roomId];
  if (!room) return [];
  // Host always first
  const hostName = room.members[room.host];
  const others = Object.entries(room.members)
    .filter(([id]) => id !== room.host)
    .map(([, name]) => name);
  return hostName ? [hostName, ...others] : others;
}

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 CoWatch server → {PORT}`);
});
