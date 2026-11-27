#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Sift command-line helper. Run `sift --doctor` to diagnose an install.
set -u

UUID=sift@alphabeast97.github.io
BUS_NAME=io.github.alphabeast97.Sift
OBJECT_PATH=/io/github/alphabeast97/Sift
SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}
STATE_HOME=${XDG_STATE_HOME:-$HOME/.local/state}

usage() {
    cat <<EOF
Usage: sift [--doctor]

  --doctor, doctor   check the Sift install and print what is wrong
  -h, --help         show this help
EOF
}

case ${1:-} in
    ''|doctor|--doctor) ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'sift: unknown command: %s\n' "$1" >&2; usage >&2; exit 2 ;;
esac

fail=0
say() { printf '  %-14s %-5s %s\n' "$1" "$2" "$3"; }
ok() { say "$1" ok "$2"; }
warn() { say "$1" warn "$2"; }
bad() { say "$1" FAIL "$2"; fail=1; }

printf 'Sift doctor\n'

if command -v gnome-shell >/dev/null 2>&1; then
    version=$(gnome-shell --version 2>/dev/null || true)
    case $version in
        'GNOME Shell 51'*) ok shell "$version" ;;
        *) bad shell "$version (GNOME Shell 51 is required)" ;;
    esac
else
    bad shell 'gnome-shell not found'
fi

if command -v gjs >/dev/null 2>&1; then
    ok gjs "$(gjs --version 2>/dev/null)"
else
    bad gjs 'gjs not found'
fi

EXT=
for dir in "$DATA_HOME/gnome-shell/extensions/$UUID" \
    "$HOME/.local/share/gnome-shell/extensions/$UUID" \
    "/usr/share/gnome-shell/extensions/$UUID"; do
    if [ -f "$dir/metadata.json" ]; then
        EXT=$dir
        break
    fi
done

if [ -n "$EXT" ]; then
    ext_version=$(sed -n 's/.*"version-name": "\([^"]*\)".*/\1/p' \
        "$EXT/metadata.json" | head -1)
    ok extension "$EXT${ext_version:+ ($ext_version)}"
    if [ -f "$EXT/schemas/gschemas.compiled" ]; then
        ok schema 'compiled settings schema present'
    else
        warn schema 'gschemas.compiled is missing; reinstall Sift'
    fi
else
    bad extension "not installed for ${USER:-$(id -un)}"
fi

if command -v gnome-extensions >/dev/null 2>&1; then
    info=$(gnome-extensions info "$UUID" 2>&1) || true
    if printf '%s\n' "$info" | grep -q 'Enabled: Yes'; then
        state=$(printf '%s\n' "$info" |
            sed -n 's/^[[:space:]]*State: //p' | head -1)
        if [ "$state" = ACTIVE ]; then
            ok enabled 'active'
        else
            warn enabled "enabled but $state; log out and back in on Wayland"
        fi
    else
        bad enabled "not enabled; run: gnome-extensions enable $UUID"
    fi
else
    bad enabled 'gnome-extensions not found'
fi

DAEMON=
if [ -x "$SELF_DIR/siftd" ]; then
    DAEMON=$SELF_DIR/siftd
elif command -v siftd >/dev/null 2>&1; then
    DAEMON=$(command -v siftd)
fi
if [ -n "$DAEMON" ]; then
    ok binary "$DAEMON"
else
    bad binary 'siftd not found; reinstall Sift'
fi

SERVICE=
for file in "$DATA_HOME/dbus-1/services/$BUS_NAME.service" \
    "$SELF_DIR/../share/dbus-1/services/$BUS_NAME.service" \
    "/usr/share/dbus-1/services/$BUS_NAME.service"; do
    if [ -f "$file" ]; then
        SERVICE=$file
        break
    fi
done
if [ -n "$SERVICE" ]; then
    if grep -q 'Exec=.*siftd' "$SERVICE"; then
        ok service "$SERVICE"
    else
        warn service "$SERVICE does not start siftd"
    fi
else
    bad service 'D-Bus activation file is missing; reinstall Sift'
fi

if command -v gdbus >/dev/null 2>&1; then
    if answer=$(timeout 5 gdbus call --session --dest "$BUS_NAME" \
        --object-path "$OBJECT_PATH" --method "$BUS_NAME.Ping" 2>&1); then
        ok daemon "reachable ($answer)"
    else
        bad daemon "not reachable: $answer"
    fi
else
    bad daemon 'gdbus not found (install the glib2 tools)'
fi

if [ -r "$CONFIG_HOME/sift/config.toml" ]; then
    ok config "$CONFIG_HOME/sift/config.toml"
else
    warn config "no config yet; using defaults ($CONFIG_HOME/sift/config.toml)"
fi

if [ -d "$CACHE_HOME/sift" ] && [ -w "$CACHE_HOME/sift" ]; then
    ok cache "$CACHE_HOME/sift"
else
    warn cache "no writable cache yet ($CACHE_HOME/sift)"
fi

if [ -d "$STATE_HOME/sift" ] && [ -w "$STATE_HOME/sift" ]; then
    ok state "$STATE_HOME/sift"
else
    warn state "no writable state yet ($STATE_HOME/sift)"
fi

if [ -r /proc/sys/fs/inotify/max_user_watches ]; then
    watches=$(cat /proc/sys/fs/inotify/max_user_watches)
    if [ "$watches" -ge 65536 ]; then
        ok inotify "$watches watches"
    else
        warn inotify "$watches watches; raise fs.inotify.max_user_watches for large trees"
    fi
fi

if [ "$fail" -ne 0 ]; then
    printf '\nSift doctor found problems.\n'
    exit 1
fi
printf '\nSift looks healthy.\n'
