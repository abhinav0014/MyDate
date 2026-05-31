# LiveRoom 🎬

Watch YouTube & streams together with real-time chat. No database required — all state is held in memory.

## Features
- 🔐 Create private rooms with ID + password
- 🎬 Embed YouTube, Twitch, Vimeo, or any iframe-able stream
- 💬 Real-time chat via WebSockets (multiple users)
- 👥 Live user presence list
- 🔗 Shareable room links
- 📱 Fully responsive (mobile + desktop)
- 🐳 Zero-DB Docker deployment
- ♻️ Auto-reconnect on disconnect

## Supported Media URLs
| Platform | Example |
|----------|---------|
| YouTube  | `https://youtube.com/watch?v=VIDEO_ID` |
| YouTube  | `https://youtu.be/VIDEO_ID` |
| Twitch   | `https://twitch.tv/channelname` |
| Vimeo    | `https://vimeo.com/123456789` |
| Direct   | Any iframe-embeddable URL |

## Quick Start

### Docker Compose (recommended)
```bash
git clone <repo>
cd liveroom
docker compose up -d
```
Open http://localhost:3000

### Docker only
```bash
docker build -t liveroom .
docker run -d -p 3000:3000 --name liveroom liveroom
```

### Local dev
```bash
cd server
npm install
node index.js
```
Open http://localhost:3000

## Usage
1. **Create Room** — pick a unique Room ID and set a password
2. **Share** — click the Share button to copy an invite link
3. **Others join** — share the link; guests enter the same password
4. **Paste a URL** — YouTube/Twitch/Vimeo URL in the media bar → Play
5. **Chat** — type in the chat panel, all room members see it live

## Architecture
- **Backend**: Node.js + Express + `ws` (WebSocket)
- **Frontend**: Vanilla HTML/CSS/JS (served as static files)
- **State**: In-memory Maps (rooms auto-clean after 10 min of inactivity)
- **No DB**: Rooms live only while the server runs; this is intentional for simplicity

## Notes
- Rooms are automatically deleted 10 minutes after the last user leaves
- Max chat history kept in memory: 200 messages per room
- YouTube's embed API requires `autoplay=1` — some browsers may block autoplay until user interaction
