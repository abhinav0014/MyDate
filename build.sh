#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════"
echo "  BrowserVM Rooms — Build & Start"
echo "═══════════════════════════════════════════════════"

# 1. Build the browser VM image (used by every room)
echo ""
echo "▶ Building browservm:latest (Chromium + VNC + noVNC)…"
docker build -t browservm:latest -f Dockerfile.vm .

# 2. Build + start the room server
echo ""
echo "▶ Starting room server…"
docker compose up -d --build

echo ""
echo "✅ Done!"
echo ""
echo "  Open: http://localhost:3000"
echo ""
echo "  Logs: docker compose logs -f room-server"
echo "  Stop: docker compose down"
echo ""