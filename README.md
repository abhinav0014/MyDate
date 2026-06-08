# 🎬 CoWatch — Synchronized Co-Watching App

A full-stack synchronized video watching app built with Node.js, Socket.io, and vanilla JS.

## Features
- 🏠 **Rooms** — Create or join rooms with a shareable code
- 👑 **Host/Guest roles** — Only the host controls playback
- 🔄 **Real-time sync** — Play, pause, and seek sync instantly
- 💓 **Heartbeat drift correction** — Smooth re-sync every 5 seconds
- 💬 **Chat** — Live chat sidebar
- 👥 **Members list** — See who's in the room

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
node server.js
```

Then open **http://localhost:3000** in two browser tabs/windows.

## How to Test Sync

1. Tab 1: Enter your name → Create a room → Enter Room
2. Tab 2: Enter another name → Paste the same room code → Enter Room
3. In Tab 1 (Host): Paste a `.mp4` URL into the video bar and click **Load Video**
4. Press Play in Tab 1 — Tab 2 syncs automatically!

## Free Test Video URLs

```
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4
```

## Architecture

```
Client A (Host)              Server              Client B (Guest)
──────────────              ──────              ────────────────
[User presses Play]
      │
      ▼
socket.emit('videoAction')  ──────►  socket.to(room).emit('syncAction')
                                              │
                                              ▼
                                    video.play() [isSyncing guard]

Every 5 seconds:
socket.emit('heartbeat')    ──────►  socket.to(room).emit('heartbeat')
                                              │
                                              ▼
                                    Drift check → rate adjust or snap
```

## Sync Mechanisms

| Mechanism | Trigger | Action |
|-----------|---------|--------|
| **Event sync** | Play/Pause/Seek | Instant broadcast to room |
| **Heartbeat** | Every 5 seconds | Drift > 2s → snap; 0.5–2s → playbackRate adjust |
| **Join sync** | New guest joins | Server sends current state immediately |

## Deploy to Production

**Backend (Render/Railway):**
```bash
# Set start command to: node server.js
# Port: auto-detected via process.env.PORT
```

**Frontend:** The frontend is served by the same Express server — no separate deploy needed.

## Extending Further

- **YouTube support:** Replace `<video>` with YouTube IFrame API
- **Auth:** Add user accounts with JWT
- **Reactions:** Add emoji reactions synced via Socket.io
- **Queue:** Let guests vote on the next video
