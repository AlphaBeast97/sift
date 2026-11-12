#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
exec dbus-run-session -- \
    gnome-shell-test-tool --headless \
    --extension "$root/dist/sift@alphabeast97.github.io.shell-extension.zip" \
    "$root/tools/test/headless.js"
