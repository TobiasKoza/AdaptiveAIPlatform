FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y systemd-standalone-sysusers \
    && echo "exit 0" > /usr/sbin/systemd \
    && chmod +x /usr/sbin/systemd \
    && apt-get install -y --no-install-recommends \
    kali-desktop-xfce \
    tigervnc-standalone-server \
    xauth \
    novnc \
    websockify \
    dbus-x11 \
    sudo \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash student \
    && echo "student ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER student
ENV USER=student
ENV HOME=/home/student
WORKDIR /home/student

# OPRAVA: Vytvoříme obě složky (starou i novou), aby TigerVNC neměl důvod si stěžovat
RUN mkdir -p $HOME/.vnc $HOME/.config/tigervnc \
    && echo "student" | vncpasswd -f > $HOME/.vnc/passwd \
    && chmod 600 $HOME/.vnc/passwd \
    && cp $HOME/.vnc/passwd $HOME/.config/tigervnc/passwd \
    && echo "#!/bin/sh\nunset SESSION_MANAGER\nunset DBUS_SESSION_BUS_ADDRESS\nexec startxfce4" > $HOME/.vnc/xstartup \
    && chmod +x $HOME/.vnc/xstartup

COPY --chown=student:student entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh && echo "v3.1"

EXPOSE 6080
ENTRYPOINT ["/opt/entrypoint.sh"]