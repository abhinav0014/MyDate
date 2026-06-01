#!/bin/sh
set -e

DISPLAY_NUM=${DISPLAY_NUM:-99}
SCREEN_RES=${SCREEN_RES:-1280x720x24}
VNC_PORT=${VNC_PORT:-5900}
NOVNC_PORT=${NOVNC_PORT:-6080}
VNC_PASS=${VNC_PASS:-liveroom}
START_URL=${START_URL:-https://www.youtube.com}

export DISPLAY=:${DISPLAY_NUM}

echo "[browser] Starting Xvfb on :${DISPLAY_NUM} @ ${SCREEN_RES}"
Xvfb :${DISPLAY_NUM} -screen 0 ${SCREEN_RES} -ac -nolisten tcp &
XVFB_PID=$!
sleep 1

echo "[browser] Starting openbox window manager"
openbox &
sleep 0.5

echo "[browser] Starting Chromium → ${START_URL}"
chromium-browser \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-software-rasterizer \
  --no-first-run \
  --no-default-browser-check \
  --disable-extensions \
  --disable-translate \
  --disable-features=TranslateUI \
  --window-size=1280,720 \
  --window-position=0,0 \
  --start-maximized \
  "${START_URL}" &
CHROME_PID=$!
sleep 2

echo "[browser] Starting x11vnc on port ${VNC_PORT}"
x11vnc \
  -display :${DISPLAY_NUM} \
  -rfbport ${VNC_PORT} \
  -passwd "${VNC_PASS}" \
  -forever \
  -shared \
  -noxdamage \
  -noxfixes \
  -threads \
  -o /var/log/x11vnc.log &
VNC_PID=$!
sleep 1

echo "[browser] Starting noVNC on port ${NOVNC_PORT}"
/opt/novnc/utils/novnc_proxy \
  --vnc localhost:${VNC_PORT} \
  --listen ${NOVNC_PORT} \
  --heartbeat 30 &
NOVNC_PID=$!

echo "[browser] All services started"
echo "  Xvfb  PID: ${XVFB_PID}"
echo "  Chrome PID: ${CHROME_PID}"
echo "  x11vnc PID: ${VNC_PID}"
echo "  noVNC  PID: ${NOVNC_PID}"

# Keep alive — restart Chrome if it dies
while true; do
  sleep 5
  if ! kill -0 $CHROME_PID 2>/dev/null; then
    echo "[browser] Chrome died, restarting..."
    chromium-browser \
      --no-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --disable-software-rasterizer \
      --no-first-run \
      --no-default-browser-check \
      --disable-extensions \
      --window-size=1280,720 \
      --window-position=0,0 \
      "${START_URL}" &
    CHROME_PID=$!
  fi
done