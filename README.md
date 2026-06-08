# 🖥️ BrowserVM Rooms

Multi-user shared browser rooms. Each room runs a real Chromium browser inside a Docker container, streamed live to all members via noVNC. One user controls the browser at a time; others watch and can request control.

---

## Architecture

```
Browser clients (port 3000)
        │
        │  HTTP + Socket.io + WebSocket
        ▼
┌─────────────────────────────────────┐
│  Node.js Room Server (port 3000)    │
│                                     │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ Express │  │  Socket.io       │  │
│  │ REST    │  │  - room:join     │  │
│  │ /api/   │  │  - chat:message  │  │
│  │ rooms   │  │  - control handoff│ │
│  └─────────┘  └──────────────────┘  │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  WS Proxy /vnc/:roomId/     │    │
│  │  websockify → container     │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  HTTP Proxy /novnc/:roomId/ │    │
│  │  → noVNC static files       │    │
│  └─────────────────────────────┘    │
│                                     │
│  Dockerode → Docker socket          │
└──────────────┬──────────────────────┘
               │  creates/stops sibling containers
               ▼
   ┌───────────────────────────┐
   │  browservm:latest image   │
   │  per-room container       │
   │                           │
   │  Xvfb → Openbox           │
   │  Chromium (DISPLAY=:1)    │
   │  x11vnc (port 5900)       │
   │  noVNC WS (port 6080)     │
   └───────────────────────────┘
        (one per room, ephemeral)
```

---

## Quick Start

### Prerequisites
- Docker Desktop or Docker Engine ≥ 20
- Docker Compose V2
- Ports `3000` available; rooms use `5910–5919` and `6090–6099`

### Build & Run

```bash
cd browser-vm-rooms
chmod +x build.sh
./build.sh
```

Then open **http://localhost:3000**

### Manual steps

```bash
# 1. Build the browser VM base image
docker build -t browservm:latest -f Dockerfile.vm .

# 2. Start the room server
docker compose up -d --build

# 3. Logs
docker compose logs -f room-server
```

---

## How It Works

### Rooms

- Create a room → Node server calls `docker.createContainer()` with the `browservm:latest` image
- The container exposes VNC on a unique host port (5910, 5911, ...)
- Node waits for the noVNC WebSocket to become reachable, then emits `room:ready`
- The frontend loads noVNC in an iframe, pointing WebSocket at `/vnc/:roomId/websockify` which the server proxies to the container

### Control

- First user to join a room becomes the **controller** — their mouse/keyboard go through to the browser
- Other users are **viewers** — a transparent overlay blocks their input
- Viewers can click **Request Control** → the controller gets a prompt to grant it
- The controller can click **Pass Control** to hand off

### Chat

- Real-time Socket.io chat per room, history kept in memory (last 200 msgs)

### Idle Cleanup

- Rooms with no users for 30 minutes are auto-destroyed (container stopped + removed)

---

## File Structure

```
browser-vm-rooms/
├── build.sh                  ← one-shot build & start script
├── Dockerfile.vm             ← browser VM image (Chromium + VNC + noVNC)
├── docker-compose.yml        ← room server service
│
├── server/
│   ├── index.js              ← Node.js server (Express + Socket.io + WS proxy)
│   ├── Dockerfile.server     ← server container
│   └── package.json
│
├── client/
│   └── public/
│       └── index.html        ← full SPA (lobby + room view)
│
└── vm/                       ← configs copied into the VM image
    ├── supervisord.conf
    ├── openbox-rc.xml
    ├── openbox-menu.xml
    └── start.sh
```

---

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3000` | Room server port |

Edit `server/index.js` constants:

```js
const VNC_BASE_PORT   = 5910;   // first VNC port for room containers
const NOVNC_BASE_PORT = 6090;   // first noVNC WS port
const MAX_ROOMS       = 10;     // max concurrent rooms
const ROOM_IDLE_MS    = 1800000 // 30 min idle auto-destroy
```

---

## Useful Commands

```bash
# See all running room containers
docker ps --filter name=browservm-room-

# Stop all rooms
docker ps --filter name=browservm-room- -q | xargs docker stop

# Open a shell in a room container
docker exec -it browservm-room-<id> bash

# Open a new Chromium window in a room
docker exec browservm-room-<id> \
  bash -c "DISPLAY=:1 chromium-browser --no-sandbox 'https://example.com' &"
```

---

## Troubleshooting

**Black screen after connecting**
The container takes ~10-15 seconds to fully start. The spinner will hide automatically when noVNC connects. Hard-refresh if stuck.

**"Room not found" error**
The container may have crashed. Check `docker ps` and `docker logs browservm-room-<id>`.

**Port conflicts**
Change `VNC_BASE_PORT` / `NOVNC_BASE_PORT` in `server/index.js` if those port ranges are in use.

**Docker socket permission**
If the server can't reach Docker, run:
```bash
sudo chmod 666 /var/run/docker.sock
# or add your user to the docker group
```