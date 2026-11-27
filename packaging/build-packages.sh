#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Build the system-wide .deb and .rpm packages from dist/siftd.
set -euo pipefail

UUID=sift@alphabeast97.github.io
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DIST=$ROOT/dist
STAGE=$DIST/pkgroot

die() {
    printf 'sift: %s\n' "$*" >&2
    exit 1
}

command -v nfpm >/dev/null 2>&1 ||
    die 'nfpm is required (go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest)'
command -v glib-compile-schemas >/dev/null 2>&1 ||
    die 'glib-compile-schemas is required (install the glib2 tools)'

[ -x "$DIST/siftd" ] || die 'dist/siftd is missing; run make release first'
[ -f "$ROOT/extension/metadata.json" ] || die 'extension/ is missing'

VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" |
    head -1)
[ -n "$VERSION" ] || die 'could not read the version from package.json'

rm -rf "$STAGE"
mkdir -p "$STAGE/usr/bin" \
    "$STAGE/usr/share/dbus-1/services" \
    "$STAGE/usr/share/gnome-shell/extensions/$UUID" \
    "$STAGE/usr/share/icons/hicolor/scalable/apps" \
    "$STAGE/usr/share/doc/sift"

install -m 0755 "$DIST/siftd" "$STAGE/usr/bin/siftd"
install -m 0755 "$ROOT/packaging/sift.sh" "$STAGE/usr/bin/sift"
sed 's|@BINDIR@|/usr/bin|' \
    "$ROOT/packaging/io.github.alphabeast97.Sift.service.in" \
    > "$STAGE/usr/share/dbus-1/services/io.github.alphabeast97.Sift.service"

cp -a "$ROOT/extension/." \
    "$STAGE/usr/share/gnome-shell/extensions/$UUID/"
rm -rf "$STAGE/usr/share/gnome-shell/extensions/$UUID/tests"
glib-compile-schemas --strict \
    --targetdir "$STAGE/usr/share/gnome-shell/extensions/$UUID/schemas" \
    "$ROOT/extension/schemas"

install -m 0644 "$ROOT/extension/icons/sift.svg" \
    "$STAGE/usr/share/icons/hicolor/scalable/apps/sift.svg"
install -m 0644 "$ROOT/README.md" "$ROOT/CHANGELOG.md" \
    "$ROOT/THIRD_PARTY_NOTICES" "$STAGE/usr/share/doc/sift/"
install -m 0644 "$ROOT/LICENSE" "$STAGE/usr/share/doc/sift/copyright"

sed -e "s|@VERSION@|$VERSION|" -e "s|@PKG_ROOT@|$STAGE|" \
    "$ROOT/packaging/nfpm.yaml" > "$DIST/nfpm.yaml"
nfpm package --config "$DIST/nfpm.yaml" --packager deb --target "$DIST"
nfpm package --config "$DIST/nfpm.yaml" --packager rpm --target "$DIST"
nfpm package --config "$DIST/nfpm.yaml" --packager archlinux --target "$DIST"

printf 'Built:\n'
ls -1 "$DIST"/sift_*.deb "$DIST"/sift-*.rpm "$DIST"/*.pkg.tar.*
