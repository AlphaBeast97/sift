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
PURGE=0

usage() {
    cat <<EOF
Usage: $0 [options]

  --prefix DIR          install under DIR (default: \$HOME/.local)
  --binary PATH         siftd binary (default: dist/siftd)
  --extension-zip PATH  extension zip (default: dist/$UUID.shell-extension.zip)
  --uninstall           remove Sift; keeps config and cache
  --purge               with --uninstall, also remove config and cache
  -h, --help            show this help
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
        --purge) PURGE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

if [ "$PURGE" -eq 1 ] && [ "$UNINSTALL" -eq 0 ]; then
    die '--purge requires --uninstall'
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
DIST=$ROOT/dist
BINARY=${BINARY:-$DIST/siftd}
EXTENSION_ZIP=${EXTENSION_ZIP:-$DIST/$UUID.shell-extension.zip}

DATA_HOME=${XDG_DATA_HOME:-$PREFIX/share}
SERVICE=$DATA_HOME/dbus-1/services/$BUS_NAME.service
CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}

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
    daemon_running || return 0

    gdbus call --session --dest "$BUS_NAME" --object-path "$OBJECT_PATH" \
        --method "$BUS_NAME.Quit" >/dev/null 2>&1 || true

    for _ in $(seq 1 20); do
        daemon_running || return 0
        sleep 0.1
    done
    printf 'sift: the running daemon did not quit; log out to replace it\n' >&2
}

install_binary() {
    [ -f "$BINARY" ] || die "binary not found: $BINARY (build it or pass --binary)"
    install -d -m 0755 "$PREFIX/bin"
    install -m 0755 "$BINARY" "$PREFIX/bin/.siftd.$$"
    mv -f "$PREFIX/bin/.siftd.$$" "$PREFIX/bin/siftd"
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
        --extra-source=src -o "$DIST" --force
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
    stop_daemon
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    gnome-extensions uninstall "$UUID" >/dev/null 2>&1 || true
    rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
    rm -f "$PREFIX/bin/siftd" "$SERVICE"

    if [ "$PURGE" -eq 1 ]; then
        rm -rf "$CONFIG_HOME/sift" "$CACHE_HOME/sift"
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
printf 'Open it with Super, Activities, or the hot corner; Super+A opens the app grid.\n'
