# GNOME Shell 51.1, gjs 1.90.1, Mesa 26.2.6, Rust 1.99.1.
# Snapshot: https://archive.archlinux.org/repos/2026/11/01/
FROM archlinux:base-20261101.0.620205

RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    printf 'Server = https://archive.archlinux.org/repos/2026/11/01/$repo/os/$arch\n' \
        > /etc/pacman.d/mirrorlist \
    && printf '\n[options]\nDisableDownloadTimeout\nXferCommand = /usr/sbin/curl --http1.1 --fail --location --retry 10 --retry-delay 2 --retry-all-errors --continue-at - --output %%o %%u\n' \
        >> /etc/pacman.conf \
    && sed -i 's/^ParallelDownloads = .*/ParallelDownloads = 2/' /etc/pacman.conf \
    && for i in 1 2 3; do \
        pacman -Syu --noconfirm --needed \
            base-devel \
            dbus \
            git \
            gjs \
            glib2 \
            gnome-shell \
            gnome-terminal \
            gsettings-desktop-schemas \
            mesa \
            nodejs \
            npm \
            python \
            rust \
            ttf-dejavu \
            xorg-server-xvfb \
        && break; \
        [ "$i" -lt 3 ] || exit 1; \
        sleep 5; \
    done

ENV GSETTINGS_BACKEND=keyfile \
    LANG=C.UTF-8

WORKDIR /src
