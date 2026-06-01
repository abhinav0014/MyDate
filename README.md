# LiveRoom v2 🎬

Watch YouTube, Twitch, Vimeo, MP4s and more together — perfectly in sync, with real-time chat.

## What's New in v2
- **Socket.IO** — persistent, auto-reconnecting connections (no manual refresh needed)
- **Media sync** — server tracks playback position; latecomers join at the right timestamp
- **Play/pause/seek sync** — control events broadcast to all viewers (native video)
- **Grouped messages** — consecutive messages from same user collapse (Discord-style)
- **Broader platform support** — YouTube, Twitch, Vimeo, Dailymotion, Rumble, Odysee, MP4/WebM, HLS (.m3u8), any iframe URL
- **Connection badge** — shows connected / reconnecting / disconnected in real time
- **Sync badge** — visible indicator when syncing media state after joining

## Supported Media
| Platform     | Example |
|-------------|---------|
| YouTube     | `https://youtube.com/watch?v=VIDEO_ID` |
| YouTube Shorts | `https://youtube.com/shorts/VIDEO_ID` |
| Twitch Live | `https://twitch.tv/channelname` |
| Twitch VOD  | `https://twitch.tv/videos/123456` |
| Twitch Clip | `https://twitch.tv/channel/clip/ClipID` |
| Vimeo       | `https://vimeo.com/123456789` |
| Dailymotion | `https://dailymotion.com/video/x7abc` |
| Rumble      | `https://rumble.com/embed/XXXXX` |
| Odysee      | `https://odysee.com/@channel/video` |
| Direct MP4  | `https://example.com/video.mp4` |
| HLS Stream  | `https://example.com/stream.m3u8` |
| Any URL     | Any iframe-embeddable URL |

## Quick Start

### Docker Compose (recommended)
```bash
git clone <repo>
cd liveroom
docker compose up -d
```
Open http://localhost:3000

### Local dev
```bash
cd server
npm install
node index.js
```

## Architecture
- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS
- **State**: In-memory (rooms auto-clean 10 min after last user leaves)
- **Sync**: Server stores `position + positionSetAt` timestamp; clients compute current position on join
- **Reconnection**: Socket.IO handles auto-reconnect with exponential backoff; room rejoin is automatic

## Notes
- Native video sync (MP4/HLS) propagates play/pause/seek to all viewers
- iFrame embeds (YouTube etc.) can't be controlled cross-origin — sync is positional only at join time
- Max 200 messages per room in memory; last 100 shown on join
