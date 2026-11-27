#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Install, upgrade, or remove Sift for the current user. No root, no network.
set -euo pipefail

UUID=sift@alphabeast97.github.io
BUS_NAME=io.github.alphabeast97.Sift
OBJECT_PATH=/io/github/alphabeast97/Sift

PREFIX=${HOME}/.local
BINARY=
EXTENSION_ZIP=
EXTENSION_ZIP_GIVEN=0
UNINSTALL=0
KEEP_DATA=0

usage() {
    cat <<EOF
Usage: $0 [options]

  --prefix DIR          install under DIR (default: \$HOME/.local)
  --binary PATH         siftd binary (default: dist/siftd)
  --extension-zip PATH  extension zip (default: dist/$UUID.shell-extension.zip)
  --uninstall           remove Sift completely
  --keep-data           with --uninstall, keep settings, usage and index data
  -h, --help            show this help

Uninstall stops the daemon and removes the extension, siftd, sift, the D-Bus
activation file, settings, learned ranking, config, cache and index data.
EOF
}

die() {
    printf 'sift: %s\n' "$*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case $1 in
        --prefix) [ $# -ge 2 ] || die '--prefix needs a value'; PREFIX=$2; shift 2 ;;
        --binary) [ $# -ge 2 ] || die '--binary needs a value'; BINARY=$2; shift 2 ;;
        --extension-zip)
            [ $# -ge 2 ] || die '--extension-zip needs a value'
            EXTENSION_ZIP=$2
            EXTENSION_ZIP_GIVEN=1
            shift 2
            ;;
        --uninstall) UNINSTALL=1; shift ;;
        --keep-data) KEEP_DATA=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

if [ "$KEEP_DATA" -eq 1 ] && [ "$UNINSTALL" -eq 0 ]; then
    die '--keep-data requires --uninstall'
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
DIST=$ROOT/dist
BINARY=${BINARY:-$DIST/siftd}
EXTENSION_ZIP=${EXTENSION_ZIP:-$DIST/$UUID.shell-extension.zip}

DATA_HOME=${XDG_DATA_HOME:-$PREFIX/share}
SERVICE=$DATA_HOME/dbus-1/services/$BUS_NAME.service
EXTENSION_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID
CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}
STATE_HOME=${XDG_STATE_HOME:-$HOME/.local/state}

command -v gnome-extensions >/dev/null 2>&1 ||
    die 'gnome-extensions is required (install the gnome-shell package)'

daemon_running() {
    local answer
    answer=$(gdbus call --session --dest org.freedesktop.DBus \
        --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner "$BUS_NAME" 2>/dev/null) || return 1
    [ "$answer" = '(true,)' ]
}

stop_daemon() {
    if daemon_running; then
        gdbus call --session --dest "$BUS_NAME" --object-path "$OBJECT_PATH" \
            --method "$BUS_NAME.Quit" >/dev/null 2>&1 || true

        for _ in $(seq 1 20); do
            daemon_running || break
            sleep 0.1
        done
        if daemon_running; then
            printf 'sift: the running daemon did not quit; stopping it\n' >&2
        fi
    fi

    # Daemons orphaned by an earlier session bus can never own the name
    # again, but keep their index resident; sweep them so upgrades do not
    # accumulate one process per install.
    pkill -x siftd 2>/dev/null || true
}

install_binary() {
    [ -f "$BINARY" ] || die "binary not found: $BINARY (build it or pass --binary)"
    install -d -m 0755 "$PREFIX/bin"
    install -m 0755 "$BINARY" "$PREFIX/bin/.siftd.$$"
    mv -f "$PREFIX/bin/.siftd.$$" "$PREFIX/bin/siftd"
    if [ -f "$SCRIPT_DIR/sift.sh" ]; then
        install -m 0755 "$SCRIPT_DIR/sift.sh" "$PREFIX/bin/sift"
    fi
}

install_service() {
    local binary_path
    binary_path=$(cd -- "$PREFIX/bin" && pwd)/siftd
    install -d -m 0755 "$DATA_HOME/dbus-1/services"
    printf '[D-BUS Service]\nName=%s\nExec=%s\n' "$BUS_NAME" "$binary_path" \
        > "$SERVICE.tmp.$$"
    chmod 0644 "$SERVICE.tmp.$$"
    mv -f "$SERVICE.tmp.$$" "$SERVICE"
}

pack_extension() {
    [ -f "$ROOT/extension/metadata.json" ] ||
        die "extension zip not found: $EXTENSION_ZIP"
    mkdir -p "$DIST"
    gnome-extensions pack "$ROOT/extension" \
        --schema=schemas/org.gnome.shell.extensions.sift.gschema.xml \
        --extra-source=src --extra-source=icons -o "$DIST" --force
}

install_extension() {
    if [ ! -f "$EXTENSION_ZIP" ]; then
        [ "$EXTENSION_ZIP_GIVEN" -eq 0 ] ||
            die "extension zip not found: $EXTENSION_ZIP"
        pack_extension
    fi
    gnome-extensions install --force "$EXTENSION_ZIP"

    if ! gnome-extensions enable "$UUID"; then
        printf '\nSift is installed, but GNOME Shell has not loaded it yet.\n'
        printf 'Log out and back in, then run: gnome-extensions enable %s\n' "$UUID"
    fi
}

if [ "$UNINSTALL" -eq 1 ]; then
    remove() {
        if [ -e "$1" ] || [ -L "$1" ]; then
            rm -rf -- "$1"
            printf 'Removed %s\n' "$1"
        fi
    }

    stop_daemon
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    gnome-extensions uninstall "$UUID" >/dev/null 2>&1 || true

    remove "$EXTENSION_DIR"
    remove "$PREFIX/bin/siftd"
    remove "$PREFIX/bin/sift"
    remove "$SERVICE"

    if [ "$KEEP_DATA" -eq 1 ]; then
        printf 'Kept settings, learned ranking, config, cache and index data.\n'
        printf '  %s\n  %s\n  %s\n' \
            "$CONFIG_HOME/sift" "$CACHE_HOME/sift" "$STATE_HOME/sift"
    else
        remove "$CONFIG_HOME/sift"
        remove "$CACHE_HOME/sift"
        remove "$STATE_HOME/sift"
        if command -v dconf >/dev/null 2>&1 &&
            dconf reset -f /org/gnome/shell/extensions/sift/ 2>/dev/null; then
            printf 'Removed GSettings /org/gnome/shell/extensions/sift/\n'
        fi
    fi
    printf 'Sift uninstalled.\n'
    exit 0
fi

command -v gjs >/dev/null 2>&1 || die 'gjs is required'
command -v gnome-shell >/dev/null 2>&1 || die 'gnome-shell is required'
shell_version=$(gnome-shell --version)
case $shell_version in
    'GNOME Shell 51'*) ;;
    *) die "Sift requires GNOME Shell 51 (found: $shell_version)" ;;
esac

stop_daemon
gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
install_binary
install_service
install_extension

printf 'Sift installed for %s.\n' "${USER:-$(id -un)}"
printf 'Open it with Super; Super+A opens the app grid and Super+Tab the workspace switcher. Ctrl+Space, Alt+A and Ctrl+Super+Tab work when the GNOME overview is enabled.\n'
