# Sift

Spotlight-style search for GNOME Shell 51: applications, files, a calculator, an
app grid, and liquid glass.

Sift disables the GNOME Overview by default: **Super** opens Sift search and
**Super+A** opens its app grid, while Activities, the hot corner, swipe and the
login overview do nothing. Turn off "Disable the GNOME overview" in the
preferences to keep GNOME's overview: Super and Super+A go back to GNOME, and
Sift opens with **Ctrl+Space** and **Alt+A**. A recorded shortcut replaces its
default. The UI and glass run in GJS, and application search uses GNOME's app
system in the shell. File indexing, fuzzy matching, and calculations run in a
small Rust daemon (`siftd`) so the shell process stays responsive.

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

## Use

- **Super**: open or close Sift search, and **Super+A**: open the app grid. The
  grid button in the search bar and the empty-state button open it too.
- With the GNOME overview disabled (default), Activities, the hot corner, swipe,
  **Super+Tab** and the login overview do nothing, and login goes straight to
  the desktop.
- With the GNOME overview enabled, Super and Super+A work as usual; Sift opens
  with **Ctrl+Space** and **Alt+A** instead.
- Record different shortcuts in the preferences; each one replaces its default.
- Type to search applications. Two or more characters also search file names,
  directories, and evaluate arithmetic and unit expressions.
- **Up/Down**, **Tab**, **Page Up/Page Down**, **Home/End**: move the selection.
- **Enter**: open an app or file; on a calculation, copy the result and close.
- **Ctrl+Enter**: open a new app window, or reveal a file in the file manager.
- **Ctrl+C**: copy the selected calculation result.
- **Escape**: close the panel.
- In the app grid, arrows and paging keys move between tiles; an icon opens on
  Enter; typing switches back to search.

File search reads names only. File contents are never indexed or read.

## Preferences

```bash
make prefs
# or
gnome-extensions prefs sift@alphabeast97.github.io
```

The window exposes glass brightness, animations, search panel height, maximum
results, app-grid labels, the GNOME overview takeover, and both shortcuts, plus a
**Files** page for the file index. The panel height is fixed while typing; extra
results scroll. Changes apply live. Extension settings are ordinary GSettings
under `org.gnome.shell.extensions.sift` and can be scripted with `gsettings`;
index settings are stored in the daemon's TOML file described below.

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
`fs.inotify.max_user_watches` to watch everything. If the kernel's event queue
overflows, the daemon rebuilds its watches and rescans automatically.

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

GitHub Actions are manual-only and owner-only: nothing runs on pushes, schedules,
or unlabeled pull requests. Dispatch `CI`, `CI image`, or `Shell smoke` from the
Actions tab, or add the `ci` label to a PR to run `CI` there. `Release` runs only
when the owner pushes a `v*` tag.

## Troubleshooting

- **No file results, footer says the index is degraded.** Check whether the
  daemon runs:
  `gdbus call --session --dest io.github.alphabeast97.Sift --object-path /io/github/alphabeast97/Sift --method io.github.alphabeast97.Sift.Ping`.
  Reinstall to restore the D-Bus service file, and check the journal for
  `siftd` errors.
- **The extension is installed but does not open.** Confirm it is enabled with
  `gnome-extensions info sift@alphabeast97.github.io`; on Wayland, log out and
  back in after the first install.
- **Glass looks flat or the text is hard to read.** Adjust **Brightness** in
  preferences: lower values darken the glass, higher values show more of the
  desktop. Blur my Shell can be enabled or disabled independently.
- **Blur my Shell is installed.** Sift detects it only to pick a conservative
  default; it does not patch or depend on it.

## License

GPL-3.0-or-later. See `LICENSE` and `THIRD_PARTY_NOTICES`.
