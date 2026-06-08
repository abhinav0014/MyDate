#!/bin/bash
set -e

echo "🚀 Starting Browser VM..."
echo "   Screen: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"
echo "   VNC Port: 5900"
echo "   noVNC Port: 6080"

# Create log directories
mkdir -p /var/log/supervisor

# Fix dbus
mkdir -p /var/run/dbus
dbus-uuidgen > /var/lib/dbus/machine-id 2>/dev/null || true
dbus-daemon --system --fork 2>/dev/null || true

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
