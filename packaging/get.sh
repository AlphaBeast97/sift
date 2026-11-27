#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Download and install the latest Sift release for the current user.
set -euo pipefail

REPO=AlphaBeast97/sift
UUID=sift@alphabeast97.github.io
VERSION=${SIFT_VERSION:-latest}

die() {
    printf 'sift: %s\n' "$*" >&2
    exit 1
}

case $(uname -s) in
    Linux) ;;
    *) die "prebuilt Sift releases are for Linux; build from source: https://github.com/$REPO#from-source" ;;
esac

case $(uname -m) in
    x86_64|amd64) ;;
    *) die "prebuilt Sift releases are x86_64 only; build from source: https://github.com/$REPO#from-source" ;;
esac

for command in gnome-shell gjs gnome-extensions gdbus; do
    command -v "$command" >/dev/null 2>&1 ||
        die "$command is required (install the gnome-shell and gjs packages)"
done

shell_version=$(gnome-shell --version)
case $shell_version in
    'GNOME Shell 51'*) ;;
    *) die "Sift requires GNOME Shell 51 (found: $shell_version)" ;;
esac

if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fL --retry 3 --connect-timeout 15 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q -O "$2" "$1"; }
else
    die 'curl or wget is required'
fi

case $VERSION in
    latest) BASE=https://github.com/$REPO/releases/latest/download ;;
    v*) BASE=https://github.com/$REPO/releases/download/$VERSION ;;
    *) BASE=https://github.com/$REPO/releases/download/v$VERSION ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading Sift (%s)...\n' "$VERSION"
for file in install.sh sift.sh SHA256SUMS siftd "$UUID.shell-extension.zip"; do
    fetch "$BASE/$file" "$tmp/$file"
done

if command -v sha256sum >/dev/null 2>&1; then
    (cd "$tmp" && sha256sum -c SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
    (cd "$tmp" && shasum -a 256 -c SHA256SUMS)
else
    die 'sha256sum or shasum is required to verify the download'
fi

bash "$tmp/install.sh" --binary "$tmp/siftd" \
    --extension-zip "$tmp/$UUID.shell-extension.zip"
