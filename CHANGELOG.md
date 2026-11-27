# Changelog

All notable changes to Sift are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-27

The first stable release.

### Added

- Spotlight-style search for applications, files, folders, settings panels,
  arithmetic, unit conversions, and optional web results.
- A-Z app grid with configurable order, labels, keyboard paging, and app
  actions.
- Workspace switcher with live window thumbnails, minimized-window cards,
  drag-and-drop window moves, workspace reordering, and close buttons.
- Liquid glass rendering with Auto, Light, Dark, and Clear modes and Liquid,
  Crystal, Glow, and Flat styles.
- Rust `siftd` daemon for file indexing, fuzzy matching, and calculations, with
  D-Bus activation and a local usage store.
- Login overview takeover that goes straight to the desktop, with a sentinel
  session mode so Sift never loads at GDM.
- One-line installer that downloads release artifacts and verifies
  `SHA256SUMS`.
- Debian/Ubuntu `.deb`, Fedora/openSUSE `.rpm`, and Arch Linux `.pkg.tar.zst` packages.
- Update checker and updater in Preferences, with a once-a-day background
  check and optional notification.
- `sift --doctor` diagnostics for the shell version, extension state, daemon,
  D-Bus service, config, cache, and inotify limit.
- Full uninstall that removes the extension, binaries, service file, settings,
  learned ranking, config, cache, and index data. `KEEP=1` preserves data for a
  later reinstall.
- Community files, issue and pull-request templates, release notes, and an SVG
  icon.

### Fixed

- App grid and workspace view open quickly and correctly after login, logout,
  or an extension reload.
- Minimized windows stay on their workspace card.
- The first workspace view shows the current windows.
- Sift starts before the login animation and does not flash the GNOME overview.

### Requirements

- GNOME Shell 51 on Wayland or X11.
- Linux x86_64 for prebuilt packages and binaries; other architectures build
  from source.
- glibc 2.35 or newer for the prebuilt daemon (Ubuntu 22.04+, Debian 12+,
  Fedora 36+).
