'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy');
const WebSocket  = require('ws');
const Docker     = require('dockerode');
const { v4: uuidv4 } = require('uuid');
const cors       = require('cors');
const path       = require('path');
const httpProxy  = require('http-proxy');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const VNC_BASE_PORT  = 5910;   // first VNC port for room containers
const NOVNC_BASE_PORT = 6090;  // first noVNC WS port for room containers
const MAX_ROOMS    = 10;
const ROOM_IDLE_MS = 30 * 60 * 1000; // 30 min idle → auto-destroy

// ─── DOCKER CLIENT ───────────────────────────────────────────────────────────
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ─── STATE ───────────────────────────────────────────────────────────────────
/**
 * rooms: Map<roomId, {
 *   id, name, createdBy, password?,
 *   containerId, vncPort, novncPort,
 *   status: 'starting'|'ready'|'error'|'stopping',
 *   users: Map<socketId, { name, color, isController }>,
 *   controllerId: socketId | null,
 *   createdAt, lastActivity,
 *   idleTimer,
 *   chatHistory: [{user,color,msg,ts}]
 * }>
 */
const rooms = new Map();

let portCounter = 0;
function allocatePorts() {
  const vncPort   = VNC_BASE_PORT  + portCounter;
  const novncPort = NOVNC_BASE_PORT + portCounter;
  portCounter++;
  return { vncPort, novncPort };
}

// ─── APP ─────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

// ─── DOCKER HELPERS ──────────────────────────────────────────────────────────
async function startRoomContainer(roomId, vncPort, novncPort) {
  const containerName = `browservm-room-${roomId}`;

  // Check if image exists, pull if needed
  const imageName = 'browservm:latest';

  let container;
  try {
    container = await docker.createContainer({
      name: containerName,
      Image: imageName,
      Env: [
        'SCREEN_WIDTH=1280',
        'SCREEN_HEIGHT=720',
        'SCREEN_DEPTH=24',
      ],
      HostConfig: {
        PortBindings: {
          '5900/tcp': [{ HostPort: String(vncPort) }],
          '6080/tcp': [{ HostPort: String(novncPort) }],
        },
        ShmSize: 512 * 1024 * 1024,
        CapAdd: ['SYS_ADMIN'],
        AutoRemove: true,
      },
      ExposedPorts: {
        '5900/tcp': {},
        '6080/tcp': {},
      },
    });
    await container.start();
    return container.id;
  } catch (err) {
    console.error(`[room:${roomId}] container error:`, err.message);
    throw err;
  }
}

async function stopRoomContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.stop({ t: 5 });
  } catch (e) {
    // already stopped / removed
  }
}

// Poll until noVNC port responds
function waitForContainer(novncPort, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const ws = new WebSocket(`ws://localhost:${novncPort}/websockify`);
      ws.on('open', () => { ws.close(); resolve(); });
      ws.on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tryConnect, 1500);
      });
    };
    setTimeout(tryConnect, 3000); // wait 3s before first try
  });
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// List rooms
app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const [id, r] of rooms) {
    list.push({
      id,
      name: r.name,
      status: r.status,
      userCount: r.users.size,
      hasPassword: !!r.password,
      createdAt: r.createdAt,
    });
  }
  res.json(list);
});

// Create room
app.post('/api/rooms', async (req, res) => {
  if (rooms.size >= MAX_ROOMS) {
    return res.status(429).json({ error: 'Max rooms reached' });
  }
  const { name, password, creatorName } = req.body;
  if (!name || !creatorName) return res.status(400).json({ error: 'name and creatorName required' });

  const id = uuidv4().slice(0, 8);
  const { vncPort, novncPort } = allocatePorts();

  const room = {
    id,
    name: name.trim().slice(0, 40),
    createdBy: creatorName,
    password: password || null,
    containerId: null,
    vncPort,
    novncPort,
    status: 'starting',
    users: new Map(),
    controllerId: null,
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
    idleTimer: null,
    chatHistory: [],
  };
  rooms.set(id, room);

  res.json({ id, novncPort, status: 'starting' });

  // Start container asynchronously
  try {
    const containerId = await startRoomContainer(id, vncPort, novncPort);
    room.containerId = containerId;
    await waitForContainer(novncPort);
    room.status = 'ready';
    io.to(`room:${id}`).emit('room:ready', { novncPort });
    console.log(`[room:${id}] ready on noVNC port ${novncPort}`);
  } catch (err) {
    room.status = 'error';
    io.to(`room:${id}`).emit('room:error', { message: err.message });
    console.error(`[room:${id}] failed:`, err.message);
  }
});

// Delete room
app.delete('/api/rooms/:id', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'not found' });
  await destroyRoom(room.id);
  res.json({ ok: true });
});

// ─── ROOM LIFECYCLE ──────────────────────────────────────────────────────────
async function destroyRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearTimeout(room.idleTimer);
  room.status = 'stopping';
  io.to(`room:${roomId}`).emit('room:closed', { reason: 'Room was closed' });
  if (room.containerId) await stopRoomContainer(room.containerId);
  rooms.delete(roomId);
  console.log(`[room:${roomId}] destroyed`);
}

function resetIdleTimer(room) {
  clearTimeout(room.idleTimer);
  room.lastActivity = Date.now();
  room.idleTimer = setTimeout(() => {
    if (room.users.size === 0) {
      console.log(`[room:${room.id}] idle timeout`);
      destroyRoom(room.id);
    } else {
      resetIdleTimer(room); // still has users, extend
    }
  }, ROOM_IDLE_MS);
}

// ─── SOCKET.IO ───────────────────────────────────────────────────────────────
const COLORS = [
  '#00d4ff','#7b61ff','#00ff88','#ffa502','#ff6b6b',
  '#f9ca24','#6ab04c','#e056fd','#eb4d4b','#22a6b3',
];
let colorIdx = 0;

io.on('connection', (socket) => {
  console.log(`[ws] connected: ${socket.id}`);
  let currentRoomId = null;
  let userName = 'Guest';
  let userColor = COLORS[colorIdx++ % COLORS.length];

  // ── JOIN ROOM ──
  socket.on('room:join', async ({ roomId, name, password }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.password && room.password !== password) {
      return socket.emit('error', { message: 'Wrong password' });
    }

    userName = (name || 'Guest').trim().slice(0, 24);
    currentRoomId = roomId;

    socket.join(`room:${roomId}`);
    room.users.set(socket.id, { name: userName, color: userColor, isController: false });

    // First user becomes controller
    if (room.controllerId === null) {
      room.controllerId = socket.id;
      room.users.get(socket.id).isController = true;
    }

    resetIdleTimer(room);

    // Send room state to joiner
    socket.emit('room:joined', {
      roomId,
      novncPort: room.novncPort,
      status: room.status,
      controllerId: room.controllerId,
      socketId: socket.id,
      users: serializeUsers(room),
      chatHistory: room.chatHistory.slice(-50),
    });

    // Notify others
    socket.to(`room:${roomId}`).emit('room:user_joined', {
      socketId: socket.id,
      name: userName,
      color: userColor,
      users: serializeUsers(room),
    });

    console.log(`[room:${roomId}] ${userName} joined (${room.users.size} users)`);
  });

  // ── REQUEST CONTROL ──
  socket.on('room:request_control', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    // Notify current controller
    if (room.controllerId && room.controllerId !== socket.id) {
      io.to(room.controllerId).emit('room:control_requested', {
        fromId: socket.id,
        fromName: room.users.get(socket.id)?.name,
      });
    } else {
      // No controller - just take it
      grantControl(room, socket.id);
    }
  });

  // ── GRANT CONTROL ──
  socket.on('room:grant_control', ({ toId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.controllerId !== socket.id) return;
    grantControl(room, toId);
  });

  // ── PASS CONTROL (give up) ──
  socket.on('room:pass_control', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.controllerId !== socket.id) return;
    // Pass to next user
    const others = [...room.users.keys()].filter(id => id !== socket.id);
    if (others.length > 0) {
      grantControl(room, others[0]);
    } else {
      room.controllerId = null;
      io.to(`room:${currentRoomId}`).emit('room:control_changed', {
        controllerId: null,
        users: serializeUsers(room),
      });
    }
  });

  // ── CHAT ──
  socket.on('chat:message', ({ message }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const msg = {
      socketId: socket.id,
      user: userName,
      color: userColor,
      message: message.trim().slice(0, 500),
      ts: Date.now(),
    };
    room.chatHistory.push(msg);
    if (room.chatHistory.length > 200) room.chatHistory.shift();
    resetIdleTimer(room);
    io.to(`room:${currentRoomId}`).emit('chat:message', msg);
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.users.delete(socket.id);

    // Reassign controller if they left
    if (room.controllerId === socket.id) {
      const next = [...room.users.keys()][0] || null;
      room.controllerId = next;
      if (next) room.users.get(next).isController = true;
    }

    io.to(`room:${currentRoomId}`).emit('room:user_left', {
      socketId: socket.id,
      name: userName,
      controllerId: room.controllerId,
      users: serializeUsers(room),
    });

    console.log(`[room:${currentRoomId}] ${userName} left (${room.users.size} users)`);
    resetIdleTimer(room);
    currentRoomId = null;
  });
});

function grantControl(room, toId) {
  if (room.controllerId) {
    const prev = room.users.get(room.controllerId);
    if (prev) prev.isController = false;
  }
  room.controllerId = toId;
  const next = room.users.get(toId);
  if (next) next.isController = true;

  io.to(`room:${room.id}`).emit('room:control_changed', {
    controllerId: toId,
    users: serializeUsers(room),
  });
}

function serializeUsers(room) {
  const out = [];
  for (const [id, u] of room.users) {
    out.push({ socketId: id, name: u.name, color: u.color, isController: u.isController });
  }
  return out;
}

// ─── VNC WEBSOCKET PROXY ─────────────────────────────────────────────────────
// Upgrade ws://host:3000/vnc/:roomId/websockify → ws://localhost:<novncPort>/websockify
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/vnc\/([^/]+)\/websockify/);
  if (!match) return socket.destroy();

  const roomId = match[1];
  const room = rooms.get(roomId);
  if (!room || room.status !== 'ready') return socket.destroy();

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const targetUrl = `ws://localhost:${room.novncPort}/websockify`;
    const targetWs  = new WebSocket(targetUrl);

    targetWs.on('open', () => {
      clientWs.on('message', d => targetWs.readyState === WebSocket.OPEN && targetWs.send(d));
      targetWs.on('message', d => clientWs.readyState === WebSocket.OPEN && clientWs.send(d));
      clientWs.on('close', () => targetWs.close());
      targetWs.on('close', () => clientWs.close());
      clientWs.on('error', () => targetWs.close());
      targetWs.on('error', () => clientWs.close());
    });

    targetWs.on('error', () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });
  });
});

// ─── noVNC STATIC PROXY ──────────────────────────────────────────────────────
// GET /novnc/:roomId/* → proxied from container's noVNC static files
app.use('/novnc/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).send('Room not found');
  const target = `http://localhost:${room.novncPort}`;
  const proxy = httpProxy.createProxyServer({});
  req.url = req.params[0] || '/';
  proxy.web(req, res, { target }, (err) => {
    res.status(502).send('Container not ready');
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 BrowserVM Rooms server running on http://localhost:${PORT}\n`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  for (const [id] of rooms) await destroyRoom(id);
  process.exit(0);
});