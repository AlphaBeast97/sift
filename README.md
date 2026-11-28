<p align="center">
  <img src="extension/icons/sift.svg" width="112" alt="Sift icon">
</p>

<h1 align="center">Sift</h1>

<p align="center">
  Spotlight-style search, an app grid, and a workspace switcher for GNOME Shell 51.
</p>

<p align="center">
  <a href="https://github.com/AlphaBeast97/sift/actions/workflows/ci.yml"><img src="https://github.com/AlphaBeast97/sift/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/AlphaBeast97/sift/releases/latest"><img src="https://img.shields.io/github/v/release/AlphaBeast97/sift" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License"></a>
  <a href="https://www.gnome.org/"><img src="https://img.shields.io/badge/GNOME%20Shell-51-4a86cf" alt="GNOME Shell 51"></a>
</p>

Sift replaces the GNOME overview with a fast, local-first launcher. Press
**Super**, type, and open an app, file, folder, settings panel, calculation, or
web result. **Super+A** opens an A-Z app grid and **Super+Tab** opens a
workspace switcher with live window thumbnails. The interface and liquid glass
run in GJS; file indexing, fuzzy matching, and calculations run in a small Rust
daemon (`siftd`) so the shell stays responsive.

Sift never phones home. File search reads names only, app usage stays on your
machine, and web search is off until you turn it on.

## Install

The recommended install downloads the latest release, verifies its
`SHA256SUMS`, and installs under `~/.local` without root:

```bash
curl -fsSL https://github.com/AlphaBeast97/sift/releases/latest/download/get.sh | bash
```

Pin a version with `SIFT_VERSION=v1.0.0`:

```bash
curl -fsSL https://github.com/AlphaBeast97/sift/releases/latest/download/get.sh \
  | SIFT_VERSION=v1.0.0 bash
```

Prefer to inspect first? Download `get.sh`, `sift-linux-x86_64.tar.gz`, and
`SHA256SUMS` from the [latest release](https://github.com/AlphaBeast97/sift/releases/latest),
verify the checksum, then extract and run the installer:

```bash
sha256sum -c --ignore-missing SHA256SUMS
tar -xzf sift-linux-x86_64.tar.gz
bash install.sh
```

On Wayland, GNOME Shell only rescans extensions at login. If the installer
prints the logout note, log out and back in, then run:

```bash
gnome-extensions enable sift@alphabeast97.github.io
```

Sift runs only in the user session. It is disabled while the screen is locked,
does not load at the GDM login screen, and comes back after unlock.

### From source

```bash
git clone https://github.com/AlphaBeast97/sift.git
cd sift
npm ci
make install
```

`make install` builds `siftd`, packs the extension, installs both under
`~/.local`, writes the D-Bus activation file, and enables the extension. Use
`make install PREFIX=/usr/local` only when that prefix is writable.

### Packages

Release assets also include system-wide packages for people who do not want to
build or run a user installer:

```bash
# Debian / Ubuntu
sudo apt install ./sift_1.0.0_amd64.deb

# Fedora / openSUSE
sudo dnf install ./sift-1.0.0-1.x86_64.rpm

# Arch Linux
sudo pacman -U ./sift-1.0.0-1-x86_64.pkg.tar.zst
```

Then enable Sift for your user and log out and back in on Wayland:

```bash
gnome-extensions enable sift@alphabeast97.github.io
```

System packages are updated with the distribution's package manager. Sift's
own updater detects a system-wide install and asks you to use the package
manager instead.

### Requirements

| | Needed for | Debian / Ubuntu | Fedora | Arch | openSUSE |
| --- | --- | --- | --- | --- | --- |
| GNOME Shell 51 | Runtime | `gnome-shell` | `gnome-shell` | `gnome-shell` | `gnome-shell` |
| GJS | Runtime | `gjs` | `gjs` | `gjs` | `gjs` |
| GLib tools | Build / tests | `libglib2.0-bin` | `glib2` | `glib2` | `glib2-tools` |
| Rust 1.99.1 | Build from source | [rustup](https://rustup.rs/) | rustup | rustup | rustup |
| Node.js + npm | Build / lint / tests | `nodejs npm` | `nodejs npm` | `nodejs npm` | `nodejs npm` |
| zip | Packing | `zip` | `zip` | `zip` | `zip` |

Prebuilt releases are Linux x86_64 and need glibc 2.35 or newer (Ubuntu 22.04+,
Debian 12+, Fedora 36+). Other architectures can build from source.

## Use

Sift disables the GNOME overview by default. Activities, the hot corner, swipe,
and the login overview do nothing, and login goes straight to the desktop. With
the overview disabled, the default shortcuts are:

| Action | Shortcut |
| --- | --- |
| Open or close search | **Super** |
| Open the app grid | **Super+A** |
| Open the workspace switcher | **Super+Tab** |
| Move the selection | **Up/Down**, **Tab**, **Page Up/Page Down**, **Home/End** |
| Open the selected item | **Enter** |
| Open a new app window, or reveal a file | **Ctrl+Enter** |
| Copy the selected calculation | **Ctrl+C** |
| Close the panel | **Escape** |

Turn off **Disable the GNOME overview** in preferences to keep GNOME's
overview. Super, Super+A, and Super+Tab go back to GNOME, and Sift opens with
**Ctrl+Space**, **Alt+A**, and **Ctrl+Super+Tab**. Record different shortcuts in
preferences; a recorded shortcut replaces its default.

Sift stays closed while an app is fullscreen. Turn off **Disable in fullscreen
apps** under Search → Fullscreen to allow shortcuts there.

### Search

- Type to search applications. Two or more characters also search file and
  folder names and evaluate arithmetic and unit expressions.
- **Enter** opens an app or file; on a calculation it copies the result and
  closes. **Ctrl+Enter** opens a new app window or reveals a file in the file
  manager. **Ctrl+C** copies the selected calculation.
- Web results are off by default. Turn on **Search the web** under Search → Web,
  then type an address such as `example.com`, or a phrase to get a last
  **Search the web** row. Sift never contacts the network by itself.
- Settings panel results are off by default. Turn on **Search settings panels**
  under Search → Results, then type part of a panel name such as `display` or
  `wifi` to open it directly.
- The panel height stays fixed while typing; extra results scroll.

### App grid

The grid button in the search bar and the empty-state button open the grid.
Arrows and paging keys move between tiles, an icon opens on **Enter**, and
typing switches back to search. The grid is A-Z by default; **Order apps** under
Search → App grid can sort by recent use, most used, or a blend of frequency and
recency.

### Workspaces and windows

The window button in the search bar or **Super+Tab** opens the workspace view.
Every workspace is a fixed-width card in a horizontal strip with live window
thumbnails. Minimized windows stay in their card and use the app icon in place
of the live thumbnail. About two and a half cards fit across, and each card
shows a row and a half of thumbnails; the partly visible card or row means
there is more.

- Click a workspace card or header, or press **Enter**, to switch to it.
  **Up/Down** select a window and **Enter** focuses it.
- Drag a window onto the middle of another card to move it there. Dropping it on
  a card edge, a gap between cards, or past the last card creates a new
  workspace at that spot, so an app can be placed behind the workspace it came
  from.
- Drag a workspace header onto another position to reorder it with its apps.
  **Ctrl+Left/Right** reorders the selected workspace and
  **Shift+Left/Right** moves the selected window to the previous or next
  workspace.
- Each window and workspace card has a close button. Empty workspaces left
  behind when their last window closes disappear immediately, and at most one
  empty workspace is kept.
- **Left/Right** move between workspaces, typing switches back to search, and
  pressing the workspace shortcut again returns to search.
- When the strip does not fit, **Shift+wheel** or a horizontal wheel pans it, a
  plain vertical wheel pans it when the pointer is not over a scrolling card,
  and dragging near either edge scrolls automatically.

## Updates

Sift checks GitHub once a day while enabled, and whenever you open
**Preferences → Updates**. A newer release shows a notification and an
**Install update** button. The updater downloads the release, verifies
`SHA256SUMS`, runs the same installer, and removes the temporary files. On
Wayland, log out and back in after installing. Turn off **Check for updates
automatically** to stop the background check; manual checks still work.

System-wide packages are not self-updated. Use `apt`, `dnf`, `zypper`, or your
distribution's updater.

## Preferences

```bash
gnome-extensions prefs sift@alphabeast97.github.io
# or
make prefs
```

The window covers glass mode and brightness, glass style, animations, search
panel height, maximum results, web search, settings panel search, the fullscreen
guard, app-grid labels and order, learned-ranking clearing, the GNOME overview
takeover, and all three shortcuts. A **Files** page configures the index and a
**How to use** page covers shortcuts, navigation, calculator examples, the app
grid, workspaces, privacy, and current limits. Changes apply live.

Extension settings are ordinary GSettings under
`org.gnome.shell.extensions.sift` and can be scripted with `gsettings`.

## File index

The daemon indexes `$HOME` by default, skipping hidden entries, symlinks,
unreadable folders, and common build, dependency, and cache directories. Its
configuration is `${XDG_CONFIG_HOME:-~/.config}/sift/config.toml`:

```toml
roots = ["~", "/data/projects"]
exclude_dirs = ["node_modules", "go/pkg/mod", ".cargo/registry", "~/Videos/raw"]
max_entries = 250000
```

- `roots` are expanded against `$HOME`. `roots = []` disables file search.
- `exclude_dirs` accepts a folder name (matches anywhere, such as
  `node_modules`), a relative path from the root, an absolute path, or a `~/`
  path. The built-in list covers Go, Rust, Java, Node, container, Steam, and
  other app caches; see `daemon/src/config.rs`.
- `max_entries` caps how many entries are kept (default 250,000, maximum
  1,000,000). Reaching the cap is reported as `Search index truncated`.

Edit these on the **Files** page in preferences; saving rewrites the TOML and
asks the daemon to rebuild in place. To do it by hand, edit the file and call:

```bash
gdbus call --session --dest io.github.alphabeast97.Sift \
    --object-path /io/github/alphabeast97/Sift \
    --method io.github.alphabeast97.Sift.Reindex
```

The index cache lives in `${XDG_CACHE_HOME:-~/.cache}/sift/`. A completed scan
writes it immediately; watcher changes are batched and flushed within ten
minutes or on quit. The footer shows `Indexing files…` while a scan runs and
`Search index degraded` / `Search index truncated` when the daemon cannot watch
a root, watches only part of it, or hits `max_entries`.

The daemon watches every included folder, so changes appear without a reindex.
If the kernel's inotify watch limit is exhausted, `Status.watcher` becomes
`partial`; changes in unwatched folders appear on the next reconcile scan. Raise
`fs.inotify.max_user_watches` and run `Reindex` to try again. If the kernel's
event queue overflows, the daemon rebuilds its watches and rescans
automatically.

## Privacy

- File search reads names only. File contents are never indexed or read.
- App launches and repeated search choices stay in
  `~/.local/state/sift/usage.json` and never leave the machine. Picking a
  non-first app, file, or folder result twice promotes it for that query and its
  prefixes. A settings panel selected twice is favored whenever it appears in
  later searches. Learned choices do not expire; the store only drops the
  oldest entries when it grows beyond 300 apps or 200 queries. Clear the counts
  with **Clear learned ranking** in preferences.
- Web search is off by default and only runs when you choose a web result.
- Sift runs as your user. It never asks for root and has no telemetry.

## Performance

Measured with `make perf` on an Intel i5-8365U and GNOME Shell 51.1. The daemon
numbers are the median of 100 queries over a synthetic 250,000-entry index. The
shell numbers come from the headless harness at 1280x720 with 90 installed apps.
Re-run the command on your machine; these are measurements, not estimates.

| Daemon query | p50 | p95 |
| --- | --- | --- |
| Exact file name | 7.5ms | 8.9ms |
| Broad prefix (`file-24`, nearly every entry matches) | 21.7ms | 23.2ms |
| Fuzzy | 6.0ms | 7.3ms |
| Multi-word | 9.5ms | 10.2ms |

| Extension path | Time |
| --- | --- |
| Enable (disable to active) | 36.3ms |
| First app snapshot, 90 apps | 2.9ms |
| Cached app snapshot | 0.2ms |
| App search, exact name | 0.1ms |
| Warm search open | 2.7ms |
| Typing an exact app name | 0.6ms |
| First app-grid open, max frame | 17.7ms |
| Prewarmed app-grid open | 27.4ms |

`make perf` rebuilds the extension zip, runs the release Rust benchmark, and
runs the headless shell benchmark; it prints both tables. Grid details and the
one-time first-tile allocation are in `docs/perf/app-grid.md`.

Each release includes its measured resource table in the release notes.
`make resources` writes the raw numbers to `dist/resource-report.json`. Shell
RSS is the whole headless GNOME Shell process, so treat it as a trend rather
than Sift's exact footprint.

## Troubleshooting

- **Something looks wrong.** Run `sift --doctor`; it checks the shell version,
  extension state, daemon, D-Bus service, config, cache and inotify limit.
- **No file results, footer says the index is degraded.** Check whether the
  daemon runs:

  ```bash
  gdbus call --session --dest io.github.alphabeast97.Sift \
      --object-path /io/github/alphabeast97/Sift \
      --method io.github.alphabeast97.Sift.Ping
  ```

  Reinstall to restore the D-Bus service file, and check the journal for
  `siftd` errors.
- **The extension is installed but does not open.** Confirm it is enabled with
  `gnome-extensions info sift@alphabeast97.github.io`; on Wayland, log out and
  back in after the first install.
- **Glass looks flat or the text is hard to read.** Pick a glass mode and style
  in preferences. Auto follows the system color scheme; Light and Dark force
  their glass with their own brightness sliders; Clear is a near-transparent
  veil that keeps the desktop visible, with clean light text and a filled
  selection. Liquid bends the backdrop at the rim, Crystal sharpens that bend
  into a bright edge, Glow replaces the bend with a soft halo, and Flat skips

## Development

```bash
npm ci
make test          # GJS unit tests, schema test, Rust tests, eslint
make test-shell    # headless GNOME Shell smoke test
SIFT_E2E=1 make test-shell   # daemon + file-search end-to-end test
make check-pack    # metadata, schema, icon, and zip sanity check
make release       # build dist/ artifacts and SHA256SUMS
make packages      # build the .deb, .rpm and Arch packages (nfpm required)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout, style, and release
process. CI is owner-gated: it runs when the owner pushes to `main`, adds the
`ci` label to a pull request, or dispatches the workflow manually.

The extension talks to `siftd` over the session bus at
`io.github.alphabeast97.Sift` / `/io/github/alphabeast97/Sift`. The daemon
exposes `Ping`, `Query`, `Reindex`, `EnsureFresh`, and `Quit`, plus `Status` and
`Config` properties. The extension and daemon are versioned together.

## Uninstall

`make uninstall` stops the daemon and removes everything Sift added: the
extension, `siftd`, `sift`, the D-Bus activation file, GSettings, learned
ranking, config, cache and index data.

```bash
make uninstall          # full removal
make uninstall KEEP=1   # keep settings, ranking, config, cache and index data
```

Or call `packaging/install.sh --uninstall [--keep-data]` directly. `--keep-data`
is only useful for a later reinstall; without it nothing is left behind. These
commands remove a user install. If Sift came from a system package, remove it
with `apt`, `dnf`, `zypper` or `pacman`.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Release notes live in
[docs/release-notes](docs/release-notes) and the changelog in
[CHANGELOG.md](CHANGELOG.md).
