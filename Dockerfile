FROM ubuntu:22.04

# This image is used by the room-server to spawn per-room containers.
# Build it once: docker build -t browservm:latest -f Dockerfile.vm .

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24

RUN apt-get update && apt-get install -y \
    xvfb x11vnc openbox chromium-browser wget curl supervisor \
    python3 python3-pip net-tools fonts-noto fonts-noto-color-emoji \
    libnotify-bin dbus-x11 at-spi2-core \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install noVNC
RUN mkdir -p /opt/novnc && \
    wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz \
      | tar xz --strip-components=1 -C /opt/novnc && \
    mkdir -p /opt/novnc/utils/websockify && \
    wget -qO- https://github.com/novnc/websockify/archive/refs/tags/v0.11.0.tar.gz \
      | tar xz --strip-components=1 -C /opt/novnc/utils/websockify

RUN pip3 install websockify

# Openbox config — borderless, maximized
RUN mkdir -p /root/.config/openbox
COPY vm/openbox-rc.xml  /root/.config/openbox/rc.xml
COPY vm/openbox-menu.xml /root/.config/openbox/menu.xml

COPY vm/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY vm/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 5900 6080

CMD ["/start.sh"]