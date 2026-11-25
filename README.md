# Sift

[![CI](https://github.com/AlphaBeast97/sift/actions/workflows/ci.yml/badge.svg)](https://github.com/AlphaBeast97/sift/actions/workflows/ci.yml)

Spotlight-style search for GNOME Shell 51: applications, files, settings
panels, a calculator, the web, an app grid, a workspace and window switcher,
and liquid glass.

Sift disables the GNOME Overview by default: **Super** opens Sift search,
**Super+A** opens its app grid and **Super+Tab** opens the workspace switcher,
while Activities, the hot corner, swipe and the login overview do nothing.
Turn off "Disable the GNOME overview" in the preferences to keep GNOME's
overview: Super, Super+A and Super+Tab go back to GNOME, and Sift opens with
**Ctrl+Space**, **Alt+A** and **Ctrl+Super+Tab**. A recorded shortcut replaces
its default. The UI and glass run in GJS, and application search uses GNOME's
app system in the shell. File indexing, fuzzy matching, and calculations run in
a small Rust daemon (`siftd`) so the shell process stays responsive.

## Requirements

- GNOME Shell 51, on Wayland or X11, with a session bus.
- For installs from source: Rust 1.99.1 (pinned by `rust-toolchain.toml`) and
  `cargo`, plus `gnome-extensions`, `gjs`, and `gnome-shell`.
- To lint and run the extension unit tests: Node.js and npm.

Blur my Shell is optional and not required. Sift does not bundle any of its code.

## Install

From a source checkout:

```bash
make install                 # builds, packs, installs into ~/.local
make install PREFIX=/usr/local   # only if that prefix is writable
```

`make install` runs `packaging/install.sh`. It stops an already running daemon,
installs `siftd` into `PREFIX/bin`, writes the D-Bus activation file into
`${XDG_DATA_HOME:-PREFIX/share}/dbus-1/services`, installs the extension, and
enables it. It never uses root and never downloads anything.

The standalone installer accepts prebuilt artifacts too:

```bash
packaging/install.sh --binary dist/siftd \
    --extension-zip dist/sift@alphabeast97.github.io.shell-extension.zip
```

On Wayland, GNOME Shell does not notice a newly installed extension until it
rescans. If the installer prints the logout note, log out and back in, then run:

```bash
gnome-extensions enable sift@alphabeast97.github.io
```

Sift runs only in the user session. GNOME Shell disables it while the screen is
locked and it does not load at the GDM login screen; it comes back after unlock.

## Use

- **Super**: open or close Sift search, **Super+A**: open the app grid, and
  **Super+Tab**: open the workspace switcher. The grid button in the search bar
  and the empty-state button open the grid too.
- With the GNOME overview disabled (default), Activities, the hot corner, swipe
  and the login overview do nothing, and login goes straight to the desktop.
- With the GNOME overview enabled, Super, Super+A and Super+Tab work as usual;
  Sift opens with **Ctrl+Space**, **Alt+A** and **Ctrl+Super+Tab** instead.
- Record different shortcuts in the preferences; each one replaces its default.
- Sift stays closed while an app is fullscreen. Turn off **Disable in
  fullscreen apps** under Search → Fullscreen to allow shortcuts there.
- Type to search applications. Two or more characters also search file names,
  directories, and evaluate arithmetic and unit expressions.
- Web results are off by default. Turn on **Search the web** under
  Search → Web, then type an address such as `example.com` to open it, or a
  phrase to get a last **Search the web** row. The row only appears when local
  results leave room; Sift never contacts the network by itself.
- Settings panel results are off by default. Turn on **Search settings panels**
  under Search → Results, then type part of a panel name such as `display` or
  `wifi` to open it directly. Multi-word queries try the meaningful words when
  needed.
- **Up/Down**, **Tab**, **Page Up/Page Down**, **Home/End**: move the selection.
- **Enter**: open an app or file; on a calculation, copy the result and close.
- **Ctrl+Enter**: open a new app window, or reveal a file in the file manager.
- **Ctrl+C**: copy the selected calculation result.
- **Escape**: close the panel.
- In the app grid, arrows and paging keys move between tiles; an icon opens on
  Enter; typing switches back to search. The grid is A-Z by default; **Order
  apps** under Search → App grid can sort by recent use, most used, or a smart
  blend of frequency and recency.
- The window button in the search bar or **Super+Tab** opens the workspace
  view. Every workspace is a fixed-width card in a horizontal strip with large
  live window thumbnails. About two and a half cards fit across, and each card
  shows a row and a half of thumbnails; the partly visible card or row means
  there is more. Click a workspace card or header, or press **Enter**, to
  switch to it; **Up/Down** select a window and **Enter** focuses it.
  Drag a window onto the middle of another card to move it there. Dropping it
  on a card edge, a gap between cards, or past the last card creates a new
  workspace at that spot, so an app can be placed behind the workspace it came
  from. Drag a workspace header onto another position to reorder it with its
  apps. **Ctrl+Left/Right** reorders the selected workspace and
  **Shift+Left/Right** moves the selected window to the previous or next
  workspace. Each window and workspace card has a close button. Empty
  workspaces left behind when their last window closes disappear immediately,
  and at most one empty workspace is kept. **Left/Right** move between
  workspaces, typing switches back to search, and pressing the workspace
  shortcut again also returns to search. When the strip does not fit,
  **Shift+wheel** or a horizontal wheel pans it, a plain vertical wheel pans it
  when the pointer is not over a scrolling card, and dragging near either edge
  scrolls automatically.

File search reads names only. File contents are never indexed or read.

App launches and repeated search choices stay in
`~/.local/state/sift/usage.json` and never leave the machine. Picking a
non-first app, file, or folder result twice promotes it for that query and its
prefixes. A settings panel selected twice is favored whenever it appears in
later searches. Clear the counts with **Clear learned ranking** in preferences.

## Preferences

```bash
make prefs
# or
gnome-extensions prefs sift@alphabeast97.github.io
```

The window exposes a glass mode (Auto, Light, Dark or Clear), separate Dark
glass and Light glass brightness sliders, a glass style (Liquid, Crystal, Glow
or Flat), animations, search panel height, maximum results, web search with its
engine and browser, settings panel search (web and settings panel results are
off by default), the fullscreen guard, app-grid labels and order,
learned-ranking clearing, the GNOME overview takeover, and all three
shortcuts, plus a **Files** page for the file index and a **How to use** page
covering shortcuts, navigation, calculator examples, the app grid, workspaces
and window dragging, settings panels, fullscreen behavior, privacy, and
current limits.
The panel height is fixed while typing; extra results scroll. Changes apply
live.
Extension settings are ordinary GSettings under
`org.gnome.shell.extensions.sift` and can be scripted with `gsettings`; index
settings are stored in the daemon's TOML file described below.

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
  path. The built-in list covers Go/Rust/Java/Node caches, containers, Steam,
  and other app data; see `daemon/src/config.rs`.
- Relative roots are resolved against `$HOME`.
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
`Search index degraded`/`truncated` when the daemon cannot watch a root, watches
only part of it, or hits `max_entries`.

The daemon watches every included folder, so changes appear without a reindex.
If the kernel's inotify watch limit is exhausted, `Status.watcher` becomes
`partial`; changes in unwatched folders appear on the next reconcile scan. Raise
`fs.inotify.max_user_watches` and run `Reindex` to try again. If the kernel's
event queue overflows, the daemon rebuilds its watches and rescans automatically.

## Daemon interface

The extension talks to `siftd` over the session bus at
`io.github.alphabeast97.Sift` / `/io/github/alphabeast97/Sift`:

- `Ping() -> s` returns `version+git-hash`.
- `Query(text, limit) -> s` returns JSON with a `files` array and an optional
  `calc` object. `text` is at most 128 bytes and `limit` is 1–50. File rows
  carry `path`, `name`, and `kind` (`file` or `dir`).
- `Reindex()` rereads the config and rebuilds the index.
- `EnsureFresh()` asks for a reconcile scan when the last one is over an hour
  old, or ten minutes old while watching is degraded or unavailable.
- `Quit()` flushes the cache and stops the daemon.
- The `Status` property is JSON (`state`, `indexed`, `roots`, `truncated`,
  `watcher`, `last_reconcile`); `watcher` is `ok`, `partial`, or `unavailable`;
  `StatusChanged` fires when it changes. The `Config` property is JSON
  (`roots`, `exclude_dirs`, `max_entries`).

## Uninstall

```bash
make uninstall          # disable and remove the extension, binary, service file
make uninstall PURGE=1  # also remove ~/.config/sift and ~/.cache/sift
```

Or call `packaging/install.sh --uninstall [--purge]` directly. Without `--purge`,
configuration and cache are kept for a later reinstall.

## Releases and tests

Build release artifacts and verify them:

```bash
make release
ls dist/siftd dist/sift@alphabeast97.github.io.shell-extension.zip dist/SHA256SUMS
(cd dist && sha256sum -c SHA256SUMS)
```

Automated checks:

```bash
make test               # GJS unit tests, schema test, Rust tests, eslint
make test-shell         # headless GNOME Shell smoke test
SIFT_E2E=1 make test-shell   # daemon + file-search end-to-end test
make check-pack         # metadata/schema/zip sanity check
```

`make ci-image` and `make test-shell-container` build and run the pinned GNOME 51
container (Docker required).

GitHub Actions run when the owner pushes to `main`, and on a pull request only
after the owner adds the `ci` label or dispatches `CI` by hand. There are no
scheduled or automatic pull-request runs. `make test-shell` is the supported
shell smoke; the container variant is experimental. `Release` runs when the
owner pushes a `v*` tag: it reruns the
checks, builds the artifacts, verifies `SHA256SUMS`, and attaches them to the
release.

## Performance

Measured with `make perf` on an Intel i5-8365U and GNOME Shell 51.1. The
daemon numbers are the median of 100 queries over a synthetic 250,000-entry
index. The shell numbers come from the headless harness at 1280x720 with 90
installed apps. Re-run the command on your machine; these are measurements,
not estimates.

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
| Prewarmed app-grid open | 24.3ms |

`make perf` rebuilds the extension zip, runs the release Rust benchmark, and
runs the headless shell benchmark; it prints both tables. Grid details and the
one-time first-tile allocation are in `docs/perf/app-grid.md`.

## Troubleshooting

- **No file results, footer says the index is degraded.** Check whether the
  daemon runs:
  `gdbus call --session --dest io.github.alphabeast97.Sift --object-path /io/github/alphabeast97/Sift --method io.github.alphabeast97.Sift.Ping`.
  Reinstall to restore the D-Bus service file, and check the journal for
  `siftd` errors.
- **The extension is installed but does not open.** Confirm it is enabled with
  `gnome-extensions info sift@alphabeast97.github.io`; on Wayland, log out and
  back in after the first install.
- **Glass looks flat or the text is hard to read.** Pick a glass mode and style
  in preferences. Auto follows the system color scheme; Light and Dark force
  their glass with their own brightness sliders; Clear is a near-transparent
  veil that keeps the desktop visible, with clean light text and a filled
  selection. Liquid bends the backdrop at the rim, Crystal
  sharpens that bend into a bright edge, Glow replaces the bend with a soft
  halo, and Flat skips the blur. Blur my Shell can be enabled or disabled
  independently.
- **Blur my Shell is installed.** Sift detects it only to pick a conservative
  default; it does not patch or depend on it.

## License

GPL-3.0-or-later. See `LICENSE` and `THIRD_PARTY_NOTICES`.
