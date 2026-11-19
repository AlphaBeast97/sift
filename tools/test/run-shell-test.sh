#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
uuid=sift@alphabeast97.github.io

export SIFT_ROOT="$root"
export SIFT_ZIP="$root/dist/$uuid.shell-extension.zip"
export SIFT_SCRIPT="$root/tools/test/headless.js"
export SIFT_E2E="${SIFT_E2E:-0}"

# Keep learned usage out of the real user state directory.
state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT
export XDG_STATE_HOME="$state"

dbus-run-session -- bash -c '
set -euo pipefail
# Containers have no system bus; a private session bus satisfies the shell.
if [ ! -S /run/dbus/system_bus_socket ]; then
    export DBUS_SYSTEM_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address)
fi
if [ "${SIFT_E2E:-0}" = 1 ]; then
    tmp=$(mktemp -d)
    export HOME="$tmp/home"
    export XDG_CONFIG_HOME="$tmp/config"
    export XDG_CACHE_HOME="$tmp/cache"
    mkdir -p "$HOME" "$XDG_CONFIG_HOME/sift" "$XDG_CACHE_HOME"
    cp -r "$SIFT_ROOT/tools/test/fixtures/home/." "$HOME/"
    printf "roots = [\"%s\"]\n" "$HOME" > "$XDG_CONFIG_HOME/sift/config.toml"
    "$SIFT_ROOT/daemon/target/release/siftd" \
        --config "$XDG_CONFIG_HOME/sift/config.toml" \
        --cache "$XDG_CACHE_HOME/sift/index-v1.bin" &
    daemon_pid=$!
    trap "kill $daemon_pid 2>/dev/null || true; rm -rf $tmp" EXIT
    until gdbus call --session --dest org.freedesktop.DBus \
        --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner \
        io.github.alphabeast97.Sift 2>/dev/null | grep -q true; do
        kill -0 "$daemon_pid"
        sleep 0.02
    done
fi
gnome-shell-test-tool --headless --extension "$SIFT_ZIP" "$SIFT_SCRIPT"
'