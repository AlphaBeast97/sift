# GNOME Shell 51.1, gjs 1.90.1, Mesa 26.2.6, Rust 1.99.1.
# Snapshot: https://archive.archlinux.org/repos/2026/11/01/
FROM archlinux:base-20261101.0.620205

# The dated base image already matches the snapshot, so skip -u and install
# only what the jobs need. rust pulls gcc, npm pulls nodejs, gnome-shell pulls
# gjs and glib2. One tiny desktop entry gives the app-search smoke test an app
# without the gnome-terminal tree, and Xvfb is unnecessary for the headless
# backend.
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    printf 'Server = https://archive.archlinux.org/repos/2026/11/01/$repo/os/$arch\n' \
        > /etc/pacman.d/mirrorlist \
    && sed -i 's/^#\?ParallelDownloads.*/ParallelDownloads = 10/' /etc/pacman.conf \
    && pacman -Sy --noconfirm --disable-download-timeout \
    && pacman -S --needed --noconfirm --disable-download-timeout \
        dbus \
        git \
        gnome-shell \
        gsettings-desktop-schemas \
        make \
        mesa \
        npm \
        python \
        rust \
        ttf-dejavu \
    && mkdir -p /usr/share/applications \
    && printf '[Desktop Entry]\nType=Application\nName=Sift Test App\nExec=/bin/true\nIcon=utilities-terminal\n' \
        > /usr/share/applications/sift-test.desktop

ENV GSETTINGS_BACKEND=keyfile \
    LANG=C.UTF-8

WORKDIR /src
