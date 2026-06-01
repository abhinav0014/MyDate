FROM alpine:3.19

# Install everything in one layer
RUN apk add --no-cache \
    # X11 virtual display
    xvfb \
    # Window manager (needed for proper Chrome rendering)
    openbox \
    # Browser
    chromium \
    # VNC server
    x11vnc \
    # noVNC dependencies
    python3 \
    py3-pip \
    git \
    # Fonts
    ttf-freefont \
    font-noto \
    # Misc utilities
    bash \
    curl \
    ca-certificates \
    dbus \
    # websockify (noVNC proxy)
    py3-setuptools

# Install websockify
RUN pip3 install websockify --break-system-packages

# Clone noVNC
RUN git clone --depth=1 https://github.com/novnc/noVNC.git /opt/novnc && \
    chmod +x /opt/novnc/utils/novnc_proxy

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set default display
ENV DISPLAY=:99
ENV SCREEN_RES=1280x720x24
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080
ENV VNC_PASS=liveroom
ENV START_URL=https://www.youtube.com

# noVNC web UI port
EXPOSE 6080
# VNC port
EXPOSE 5900

CMD ["/start.sh"]