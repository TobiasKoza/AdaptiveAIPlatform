#!/bin/bash
export USER=student
export HOME=/home/student

# Pokud učitel nahrál init script přes Lab Images, stáhni a spusť ho
if [ -n "$LAB_INIT_BLOB_URL" ]; then
    INIT_TMP=$(mktemp /tmp/init_XXXXXX.sh)
    if command -v curl &>/dev/null; then
        curl -fsSL "$LAB_INIT_BLOB_URL" -o "$INIT_TMP"
    elif command -v wget &>/dev/null; then
        wget -qO "$INIT_TMP" "$LAB_INIT_BLOB_URL"
    else
        python3 -c "
import urllib.request, sys
urllib.request.urlretrieve(sys.argv[1], sys.argv[2])
" "$LAB_INIT_BLOB_URL" "$INIT_TMP"
    fi
    chmod +x "$INIT_TMP"
    # Spusť jako root aby init script mohl instalovat balíčky, kopírovat soubory atd.
    bash "$INIT_TMP" || true
    rm -f "$INIT_TMP"
fi

# Totální vyčištění starých zámků (pokud by kontejner restartoval)
sudo rm -rf /tmp/.X1-lock /tmp/.X11-unix/X1

# Spuštění VNC serveru (přidali jsme -fg aby běžel na popředí a neumřel)
# A -SecurityTypes None pro jednodušší ladění (heslo student zůstává)
vncserver :1 -geometry 1280x720 -depth 24 -localhost no -rfbauth $HOME/.vnc/passwd

# Krátká pauza, aby se X server stihl nastartovat
sleep 2

# Vypnutí screensaveru a automatického zamykání
DISPLAY=:1 xfconf-query -c xfce4-screensaver -p /saver/enabled -s false 2>/dev/null || true
DISPLAY=:1 xfconf-query -c xfce4-screensaver -p /lock/enabled -s false 2>/dev/null || true
DISPLAY=:1 xset s off 2>/dev/null || true
DISPLAY=:1 xset -dpms 2>/dev/null || true

echo "Startuji webové rozhraní na portu 6080..."
websockify --web /usr/share/novnc/ 6080 localhost:5901