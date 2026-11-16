# Sift for GNOME Shell 51 — Design

Date: 2026-11-11
Status: **Draft for approval.** No implementation starts until this document is approved.
Name: **Sift.** "Sift" was free on extensions.gnome.org when checked on 2026-11-11;
search again before the first public release. The UUID is cheap to change only before
users have settings and caches.

---

## 1. Intent

Build a macOS-Spotlight-style search for GNOME Shell 51. By default one key — Super —
opens a centered search panel over the current desktop. Typing finds installed
applications and files, and evaluates arithmetic/unit expressions. An app grid view
browses every installed application, and a preferences window exposes the glass,
result, grid, and shortcut settings. The panel has a liquid-glass backdrop that looks
like macOS/Isle glass, with a simpler frosted blur as fallback. It must feel instant:
open in one or two frames, no input lag, 60 fps while open, and zero idle cost when
closed.

The default configuration disables the **GNOME Overview**: Super and Super+A open
Sift's search and app grid, while Activities, the hot corner, the touchpad gesture,
Super+Tab and the login overview do nothing. There is no workspace picker and no
window picker. The preference can instead keep GNOME's Overview; Sift then opens with
Ctrl+Space and Alt+A. Sift has two views — the search panel and an app grid — plus its
own preferences window.

The Rust part exists because indexing the home directory and fuzzy matching 250k paths
inside the GNOME Shell process would risk the frame budget. The visible UI, focus,
input, and glass must stay in GJS because an extension cannot load native code into the
shell or draw into its compositor. This split is not an implementation preference; it
is the only supported shape (see `docs/research/phase-0-findings.md`).

## 2. Goals

- Super opens the centered search overlay; Super+A opens the app grid. Every other
  GNOME overview trigger is disabled.
- Application search is instant and uses GNOME's own `Shell.AppSystem` and activation
  paths so workspaces, startup notification, and focus behave correctly.
- An app grid over the same app snapshot, opened with Super+A or the empty-state
  button, with paging and full keyboard navigation.
- A preferences window with live toggles and sliders for glass, results, and grid.
- Filename search over the user's home directory, with live updates, in Rust.
- Arithmetic and unit conversion via `fend-core`, with no network requirement.
- A liquid-glass panel (blurred live backdrop + rounded shape, tint, subtle lens and
  rim) that reaches 60 fps, or the frosted fallback if the budget is missed.
- Clean enable/disable: every patch, signal, actor, timer, and D-Bus subscription is
  removed. Disabling the extension restores the stock Overview.
- A real automated test pipeline, including a headless GNOME Shell smoke test, and a
  local install that is one command.

## 3. Non-goals (v1)

- Window picker, workspace overview, dash, or window thumbnails.
- App folders, drag-and-drop icon rearrangement, or a separate Launchpad-style
  full-screen app. The grid is a view of Sift, not a second product.
- File **content** search; only file and directory names.
- Web search, clipboard history, recent files, emoji, or a plugin/provider system.
- Live currency exchange rates (no network calls from v1).
- Touchpad gesture to open Sift (the stock overview gesture is disabled).
- GNOME 46–50 support. GNOME 51 only (see §4).
- Shipping through extensions.gnome.org. EGO cannot install the Rust daemon; v1
  installs with a script (see §17).

## 4. Anti-goals

- **Shipping a second rate-limited search UI that still feels like GNOME's Overview.**
  This is not a reskin of the Overview; it is a Sift overlay. If it opens the
  workspace picker or window picker, it has failed. The app grid must be Sift's own
  view, never the native one.
- **Jank hidden behind animations.** A pretty open animation is not a substitute for
  results appearing on the keystroke. If the glass costs the frame budget, the glass
  gets simpler.
- **Indexing inside the shell process.** If a full-home walk or a 250k-entry match runs
  in GJS, the 60 fps requirement is not credible.
- **Depending on Blur my Shell.** BMS is a compatibility target, never a requirement.
- **Patching more of the shell than necessary.** Every private touch is a liability on
  the next shell update.

## 5. Constraints

| Constraint | Consequence |
|---|---|
| GNOME Shell 51 only | Extension declares `"shell-version": ["51"]`. No compatibility layer in v1. |
| Shell runs GJS; no native modules | UI, focus, key handling, and glass are GJS. Rust only talks over D-Bus. |
| No supported "replace Overview" API | Take over via narrow wrappers and keybinding/gesture handling (§7). |
| Wayland-first session | No global key grabs; use shell keybindings and `Main.pushModal()`. |
| 60 fps / input latency | Bounded backdrop, cached layout, event-driven updates, no per-frame JS. |
| `fend-core` is pure Rust, MIT | Calculator runs in the daemon, no network. |
| `nucleo-matcher` is MPL-2.0 | Dependency is fine under GPL-3.0-or-later; keep notices. |
| Daemon cannot ship through EGO | Install script + D-Bus activation; AUR/Flatpak is future work. |
| `/tmp` is not durable | Research, spikes, and measurements that matter are committed under `docs/`. |

**Decisions I made (change now if you disagree):**

- **License: GPL-3.0-or-later.** The glass is informed by Isle (GPL-3.0-or-later) and
  Blur my Shell's techniques. Writing it independently would still be safest under
  GPL, and GPL-3.0-or-later is compatible with the shell and both references.
- **GNOME 51 only.** The shader API changed in 51 (`Shell.GLSLEffect` removed,
  `Clutter.ShaderEffect` + `Cogl.Snippet` now), and the Overview internals move between
  releases. Supporting 46–50 would double the private-surface area for no v1 benefit.
- **Display name `Sift`, UUID `sift@alphabeast97.github.io`,
  daemon `siftd`, bus name `io.github.alphabeast97.Sift`.** The extension name was free
  on EGO at design time. The UUID and bus name follow the chosen name so nothing has to
  be renamed after code exists.
- **File index: filenames and directory names only**, `$HOME` by default, hidden
  entries skipped, 250,000-entry cap, heavy build/cache directories excluded (§10).
- **The app grid is Sift's own view.** Super+A (the stock `toggle-application-view`
  binding), `showApps()`, a grid button in the entry, and the empty-state button open
  it. It reuses `IconGrid.IconGrid`, `AppDisplay.AppIcon` (`isDraggable: false`), and
  `PageIndicators.PageIndicators`. `AppDisplay`/`BaseAppView` is not reused: it carries
  Overview, folder, DND, and page-persistence state that Sift does not want. The grid is
  built lazily once, cached, and rebuilt only when the app list changes (§13.2).
- **A preferences window ships in v1.** `prefs.js` uses
  `Adw.PreferencesWindow`; every key in §13.3 is exposed and applies live. There is no
  `file-search` switch: file search is the product, and a switch that left `siftd`
  watching `$HOME` would be a false privacy promise. Indexing is configured in
  `~/.config/sift/config.toml`; `roots = []` (or not installing the daemon) disables it.
- **Grid settings are layout-only.** The user controls icon size; columns, rows, and
  pages are derived from the panel size. No free-form placement, folders, or drag order.
- **No lock-screen presence.** `metadata.json` declares `session-modes: ["user"]`, so
  the shell disables the extension on lock and enables it again on unlock. Sift
  must never expose home filenames on the lock screen. `enable()`/`disable()` are
  therefore exercised on every lock/unlock, and the test matrix includes it.
- **No recents/frequently-used list on the empty state.** Empty query shows a short
  hint, not guessed apps. It avoids tracking usage in v1.
- **The query clears when the panel closes.** Reopening always starts clean.
- **Calculator Enter copies the result** and closes; a plain Enter on an app opens it,
  on a file opens it, and Ctrl+Enter reveals a file or opens an app's new window.

## 6. Approaches considered

### 6.1 Whole-product architecture

| Option | Trade-off | Verdict |
|---|---|---|
| **A. GJS-only extension** (Gio.File walk, Gio file monitors, JS fuzzy match, JS calculator) | Simplest install; EGO-shippable; no daemon. Full-home indexing, inotify fan-out, and 250k-entry matching all run in the shell process, competing with paint and GC. | Rejected: conflicts with the no-lag requirement. |
| **B. Rust daemon + GJS UI/glass** (chosen) | Two processes install; D-Bus IPC; daemon lifecycle. Shell stays thin; Rust is fast, testable, and crash-isolated. | **Chosen.** Same split Isle uses. |
| **C. Standalone Rust/wgpu overlay** (GTK window, layer-shell) | Could render perfect glass in Rust. Mutter has no `wlr-layer-shell`; a normal window cannot replace the Overview, own shell focus, or sit above fullscreen windows as shell UI. | Rejected: cannot do the job. |
| **D. Borrow GNOME's search providers** (Search Beam approach) | Reuses GNOME's search UI/results, but does not replace the Overview by itself and cannot own file indexing or calculator results cleanly. | Rejected as the architecture; the popup lifecycle lessons are reused. |

### 6.2 Glass rendering

| Option | Trade-off | Verdict |
|---|---|---|
| **A. Bounded liquid glass** (chosen): clone wallpaper/windows under the panel, `Shell.BlurEffect` in ACTOR mode, then a `Clutter.ShaderEffect` for shape, tint, lens, rim | macOS look; ~720×420 offscreen frame, not fullscreen; more code and clone edge cases. | **Chosen**, with B as fallback. |
| **B. Simple native blur**: `Shell.BlurEffect` in BACKGROUND mode behind a rounded translucent panel | Much less code and risk. Frosted, not liquid; BACKGROUND mode cannot cache what is beneath and can be expensive. | Kept as the automatic fallback if the liquid path fails. |
| **C. Blur my Shell only**: add `bms-popup-blur-target` | Zero blur code. No blur when BMS is absent/disabled. | Optional integration only, never the sole path. |

### 6.3 File search backend

| Option | Trade-off | Verdict |
|---|---|---|
| **Own in-memory filename index** (chosen) | Live updates, no external service, predictable latency; costs memory (~25–40 MB at 250k). | **Chosen.** |
| `plocate`/`locate` | Simple, but stale (database updated by a timer), needs an external package, and cannot see fresh files. | Rejected for v1; possible optional backend later. |
| `ripgrep`/content index | Expensive index, privacy surface, not requested. | Rejected. |

## 7. Architecture

```
GNOME Shell process (GJS)
  Overview blocker → SiftOverlay → ResultsModel → glass + St widgets
                       │              ├── Apps: Shell.AppSystem (sync)
                       │              └── Files/calc: D-Bus proxy (async)
                       └── AppGrid → IconGrid.IconGrid + AppDisplay.AppIcon

  prefs.js (separate process) → Gio.Settings → same schema
                                            │
                                            │ session D-Bus
                                            │ io.github.alphabeast97.Sift
                                            ▼
siftd (Rust, one process)
  D-Bus: Query / EnsureFresh / Reindex / Ping / Status + StatusChanged
  Query → Calc (fend-core)
        → File index (nucleo-matcher): snapshot, top-K, JSON
  Indexer: walk $HOME → cache → inotify watcher → incremental updates
```

### 7.1 Extension (GJS) responsibilities

- Take over the Overview entry points and restore them on disable (§8).
- Own the overlay actor, entry, result rows, focus, keyboard handling, and modal grab.
- Search apps synchronously from a list built at enable and refreshed on
  `app-system` changes (`installed-changed`, `app-state-changed` as needed).
- Build the app grid lazily from that same app list, reuse it across opens, and invalidate
  it on `installed-changed` (§13.2).
- Read GSettings and apply every key live; `prefs.js` writes the same schema.
- Send file/calculator queries to the daemon asynchronously; drop stale replies.
- Render the glass; own its fallback.
- Open apps, files, and folders; copy calculator results.
- Never walk the filesystem, never run a per-frame loop.

### 7.2 Daemon (`siftd`) responsibilities

- Build and maintain the filename index with `ignore` + `notify`.
- Answer queries over D-Bus with file matches and at most one calculator result.
- Serve instantly from cache on startup, then reconcile in the background.
- Report index state/count/truncation over `Status`/`StatusChanged`.
- Stay idle-cheap: no polling; the inotify thread blocks.
- Not launch apps or open files; that stays in the shell, which has the desktop context.

### 7.3 Lifecycle

- Extension `enable()`:
  1. Read settings and connect `changed::` handlers; build the app list; install Overview
     wrappers; replace/disable keybindings and gestures; create the hidden overlay and
     the (empty, unbuilt) grid shell; add them as chrome.
  2. Create the D-Bus proxy and call `Ping` asynchronously. If the daemon is missing,
     the extension still works for apps; the footer shows "Search service unavailable".
  3. Subscribe to `StatusChanged`; do **not** create timers.
- Because `session-modes` is `["user"]`, the shell disables the extension when the
  session locks and enables it again on unlock. Nothing may remain (grab, timer, actor,
  proxy, wrapper, keybinding, gesture change) across that cycle.
- Daemon start is D-Bus-activated by the first `Ping`/`Query`, or by the installed
  service file at session start. No systemd unit is required. The daemon accepts
  `--config` and `--cache` overrides for tests; the shipped extension never spawns it.
- `disable()`: close if open, destroy actors and effects, unbind signals, restore the
  Overview methods/keybindings/gestures, drop the proxy, remove chrome. No daemon kill:
  it is shared session infrastructure and exits naturally at logout.
- Daemon exits if it cannot own its bus name (a second instance), on `Quit` after
  flushing the cache, and on session bus disconnect.

## 8. Disabling the Overview

This is the highest-risk area. The implementation is deliberately narrow and every
change is reversible.

### 8.1 What actually triggers the Overview on GNOME 51

- **Super alone** is Mutter's `overlay-key` (default `'Super'`). `OverviewControls`
  connects to `global.display`'s `overlay-key` signal and calls
  `Main.overview.toggle()` dynamically. `toggle-overview` (default `<Super>Tab`) also
  calls `Main.overview.toggle()`.
- **Activities button, hot corner, and shell D-Bus** call
  `Main.overview.toggle()` / `show()` / `hide()` dynamically. Wrapping the instance
  methods catches them without patching each caller.
- **`toggle-application-view`** (Super+A or user binding) calls
  `Main.overview.show(ControlsState.APP_GRID)` dynamically.
- **Touchpad overview gesture** uses `Main.overview._swipeTracker`, which drives
  `Main.layoutManager.showOverview()` directly and bypasses the public methods.
- **Login** calls `Main.overview.runStartupAnimation()`, which also calls
  `Main.layoutManager.showOverview()`.
- **`Main.overview` is an ESM live binding** and cannot be replaced. Only instance
  methods can be shadowed.

### 8.2 The patch set

`disable-overview` (default true) blocks every GNOME overview trigger except the two
Super shortcuts it hands to Sift.

1. Save and shadow `show`, `showApps`, `toggle`, `focusSearch`, and
   `shouldToggleByCornerOrButton` on `Main.overview` with no-op/false wrappers, and
   `runStartupAnimation` with an async no-op so login skips the overview. `hide` is
   saved too so the startup overview can be dismissed. `show(APP_GRID)` is the one
   wrapper with a job: when the app-grid shortcut is still its default, it opens
   Sift's grid. Otherwise it does nothing.
2. Save and shadow `Main.layoutManager.showOverview` with a no-op, so the swipe
   gesture and any other direct caller cannot reveal the overview group.
3. Set `Main.overview._swipeTracker.enabled = false` (a public GObject property) and
   restore its previous value when the block is lifted.
4. If the overview is somehow visible at enable, dismiss it through the saved
   original `hide` plus `Main.layoutManager.hideOverview()`. During login, also
   dismiss it on the `showing` signal in case the shell started the animation before
   extensions were enabled.
5. Listen to `global.display`'s `overlay-key` signal (the bare Super press) only while
   the overview is blocked and the search shortcut is unset; the listener toggles
   Sift search. GNOME's own handler calls the shadowed `Main.overview.toggle()`, so
   Super+Tab, Activities and the shell D-Bus stay inert.
6. Bind `sift-search-shortcut` and `sift-apps-shortcut` with
   `Main.wm.addKeybinding` (our settings schema, `IGNORE_AUTOREPEAT`,
   `NORMAL | OVERVIEW`) whenever the overview is enabled or that shortcut has a user
   value. A recorded shortcut therefore replaces its Super default; resetting it
   returns the default to Sift. Their handlers close a visible native overview first,
   then open Sift.
7. On `disable-overview = false` or on extension disable, restore every saved method
   (or delete our shadow if another extension had not patched it), restore the swipe
   tracker, disconnect the overlay-key listener, and remove the keybindings. With the
   overview enabled, the schema defaults (`<Control>space`, `<Alt>a`) are bound
   instead.

### 8.3 Deliberate non-patches

- Do **not** replace `Main.overview` (impossible) and do **not** emit its
  `showing`/`hiding`/`shown`/`hidden` signals.
- Do **not** shadow the `visible` getter. Native modules keep seeing `false` while the
  overview is blocked.
- Do **not** hide `Main.layoutManager.overviewGroup` permanently; it is already hidden
  when the overview is not shown. BMS's overview component therefore stays invisible.

**Known cosmetic differences** accepted in v1: the Activities button does not get its
"checked" pseudo-class while blocked, and shell D-Bus `OverviewActive` reports false.
Revisit only if real use shows a problem.

### 8.4 Edge cases

- **Fullscreen:** `Main.pushModal()` calls `global.compositor.disable_unredirect()`
  while the panel is open (and `popModal()` re-enables it), so the glass renders over
  fullscreen windows.
- **Second shortcut press while open:** the Sift handler closes the panel from either
  view. The bare-Super listener does the same.
- **Custom shortcut:** recording a value for a shortcut replaces its Super default.
  Super/Super+A then do nothing while the overview is disabled, and the recorded key
  is bound instead.
- **GNOME overview enabled:** Super, Super+A, Activities, hot corner, swipe and login
  behave normally; Sift binds Ctrl+Space and Alt+A (or the recorded values) and closes
  a visible overview first.
- **App list changes while the grid is open:** `installed-changed` marks the grid dirty;
  the visible grid is left alone and rebuilt on the next open.
- **App activation from the grid:** `AppIcon.activate()` calls `Main.overview.hide()`;
  with the block lifted that hides the GNOME overview; Sift closes itself separately.
- **Sticky Keys enabled:** Mutter's `overlay-key` handler returns early, but Sift's
  listener still opens search on the overlay key; the block still covers Activities,
  the hot corner, Super+A and the swipe gesture.
- **Session lock / user switch:** the extension is `["user"]`-only, so the shell runs
  `disable()` on lock and `enable()` on unlock, restoring the overview either way.
- **Extension disabled while open:** `disable()` pops the modal and destroys the actor,
  removes the two keybindings, and restores the overview.
- **Shell error:** if a required method/field is missing at enable, log once and
  refuse to enable rather than half-patch the overview.

## 9. Search

### 9.1 Query pipeline

```
keystroke
  → trim, ignore empty/whitespace
  → seq++ ; cancel pending debounce
  → app matches rendered synchronously (same frame)
  → 40 ms debounce → D-Bus Query(seq-less; one in flight)
  → reply arrives; if seq is current, merge calc + files and render
  → error/timeout: keep app results; show service footer once
```

- On open, send `EnsureFresh()` fire-and-forget (ignore errors). It lets the daemon
  reconcile a stale or watcher-degraded index without any UI blocking.
- At most one D-Bus query in flight. While it runs, only the newest query is kept as
  pending; when the reply returns, a stale reply is dropped and the pending query is
  sent. The daemon query is short enough (< 30 ms) that explicit cancellation in the
  daemon is unnecessary; if profiling says otherwise, add a generation-based cooperative
  cancel.
- File queries start at **2 characters**; app and calculator queries run at any length.
- The overlay's height is fixed while results are shown, so typing does not resize the
  glass. Only the empty↔results transition changes height (animated once).

### 9.2 Applications (GJS)

- Build a snapshot at enable from `Shell.AppSystem.get_default().get_installed()`,
  deduplicated by id. Include running apps even if the installed list lags.
- Precompute lowercased name, generic name, keywords, and desktop id.
- Score (higher wins): exact name; name prefix; word-boundary prefix; substring;
  subsequence; keyword/generic-name substring; +small bonus for running. Tie-break by
  shorter name.
- Top 4 app rows (bounded by `max-results`). Row icons use `app.get_icon()` on a reused
  `St.Icon` (`gicon`), not a new texture per keystroke.
- Enter: `app.activate()`. Ctrl+Enter: `app.open_new_window(-1)` when
  `can_open_new_window()` is true, otherwise activate.
- The app grid uses the same snapshot, sorted by display name. `installed-changed`
  marks the grid dirty; it is rebuilt on the next grid open, not while it is visible
  (§13.2).

### 9.3 Files (daemon)

- Match **basenames** (files and directories), case-insensitive, Unicode-lowercased.
- Two-stage: a cheap ASCII subsequence prefilter over precomputed lowercase names, then
  `nucleo-matcher` scoring only on candidates. Top-K by score, tie-break shorter name
  and shallower path.
- Return at most 12 candidates; the UI fills the remaining rows up to `max-results`.
  Each row's icon and subtitle identify the type; there are no section headers in v1.
- Each result: absolute path, basename, kind (`file`/`dir`). The extension displays the
  parent path with `~` abbreviation.
- File icons are queried asynchronously for visible rows only (`query_info`,
  `standard::icon`, metadata only), with a bounded cache (256 entries). No icon query for
  off-screen results and no blocking lookup in a frame.
- Enter opens with `Gio.AppInfo.launch_default_for_uri_async()`. Ctrl+Enter calls
  `org.freedesktop.FileManager1.ShowItems()`; if that service is absent, open the
  parent folder.
- If a stale path no longer exists at activation time, remove the row and ask the
  daemon to reindex (debounced).

### 9.4 Calculator (daemon, `fend-core`)

- Evaluate with a 25 ms deadline via `evaluate_with_interrupt`; cap input at 512 bytes.
- Show a calculator row when evaluation succeeds **and** the query looks like a
  calculation: starts with `=`, or contains an operator/unit/letter (so a bare "42" or
  an app name does not produce a result), and the result differs from the input.
- **This heuristic lives only in `calc.rs`.** The extension trusts the presence of the
  `calc` field and renders it; it does not repeat the detection logic. GJS tests cover
  rendering and merge behavior, Rust tests cover the decision.
- v1 supports arithmetic, unit conversion, and whatever offline date/time math
  `fend-core` offers. **No live currency rates**; currency queries that need a network
  rate simply do not produce a row.
- Enter copies the result to the clipboard and closes; Ctrl+C copies too. No variables
  persist between queries (fresh `Context` each time).

### 9.5 Merge and selection

- Order: calculator result first (a "top hit"), then applications, then files.
- Default selection is the first row. On a result update, keep the selected item's
  stable key (kind + id/path) if it still exists; otherwise select the first.
- Key/action table:

| Key | Action |
|---|---|
| Up / Down / Tab / Shift+Tab | Move selection |
| PageUp / PageDown | Move 5 rows |
| Home / End | First / last row |
| Enter | Activate selected |
| Ctrl+Enter | App: new window · File/dir: reveal in Files |
| Ctrl+C (calc) | Copy result |
| Escape | Close (unless an IME composition is active) |
| Super | Close (via the Overview toggle) |

- Mouse: hover selects, click activates, click outside the panel closes.
- Query is cleared on close.

## 10. File index

### 10.1 Scope and defaults

- Roots: `~` (expanded to `$HOME`). Extra roots can be configured in
  `~/.config/sift/config.toml`; no UI in v1.
- Hidden entries (leading `.`) are skipped by default.
- Excluded directory names at any depth: `.cache`, `.local/share/Trash` (by path),
  `node_modules`, `.git`, `target`, `__pycache__`, `.venv`, `venv`.
- Symlinks are not followed (no loops, no duplicate subtrees). Filesystem boundaries are
  not crossed (external mounts under home are not indexed in v1).
- Cap: 250,000 entries (configurable). On cap, stop and report `truncated: true`.
- Index both files and directories; their basenames are searchable.

### 10.2 Build and cache

- `ignore::WalkBuilder` with 4 threads, hidden-skip on, gitignore rules **off**
  (a user's `.gitignore` must not hide files from a system search), custom excludes,
  no symlinks, same filesystem.
- Entry: absolute path, precomputed lowercase basename, kind. Rough memory at 250k:
  25–40 MB.
- Immutable snapshots: rebuild into a new `Vec<Entry>`, then swap under a short write
  lock. A query sees either the previous complete snapshot or the new one, never a
  half-built vector. Queries take a read lock (or clone an `Arc`) and never block the
  indexer for long.
- Cache at `$XDG_CACHE_HOME/sift/index-v1.bin`, mode 0600, directory 0700. Versioned
  header + a fingerprint of roots/excludes/flags; mismatch ignores the cache. No extra
  serialization crate: length-prefixed paths and kinds over `std::io`.
- Startup: load cache → serve immediately → full background scan → swap. On a warm start
  the cache answers queries during the scan. On a cold start with no cache, the live
  snapshot is empty until the first scan finishes; the UI stays app-only and the footer
  shows the indexing state. A query is never blocked on `ready`. After the scan, replay
  watcher events that arrived during it, so changes are not lost.
- Cache is written at most every 30 s while dirty, on clean shutdown, and on `Quit`. A
  stale cache is harmless because the startup scan corrects it.

### 10.3 Live updates

- `notify` recursive watcher on each root (stable `notify` 8.x, not the 9.0 release
  candidate).
- Events are debounced 500 ms and applied incrementally:
  - create/modify → add if it passes filters;
  - remove → remove the path and everything under it;
  - rename → remove the old subtree, add the new subtree by walking only that path.
- Excluded paths are filtered before touching the index.
- Watcher failure (for example inotify watch limit) sets `watcher: "unavailable"` and
  logs once. The index remains usable. The extension calls `EnsureFresh()` on open; the
  daemon runs a full reconcile if the last successful reconcile is older than 10 minutes
  and no scan is already running. `Reindex` requests a rebuild and returns immediately;
  if a scan is already running it is a no-op.
- No periodic timer when idle.

### 10.4 Query limits

- Query length ≤ 128 UTF-8 bytes; longer input is truncated (or rejected; the extension
  trims anyway). `limit` clamped to 1..=50.
- One daemon query at a time per client is expected, but the interface is safe under
  concurrent calls (read lock per query).

## 11. D-Bus API

- Bus: session bus, name `io.github.alphabeast97.Sift`.
- Object: `/io/github/alphabeast97/Sift`.
- Interface: `io.github.alphabeast97.Sift`.
- JSON strings for payloads: easy to inspect with `gdbus`, easy in GJS, no variant
  gymnastics.

```xml
<node>
  <interface name="io.github.alphabeast97.Sift">
    <method name="Ping">
      <arg name="version" type="s" direction="out"/>
    </method>
    <method name="Query">
      <arg name="query" type="s" direction="in"/>
      <arg name="limit" type="u" direction="in"/>
      <arg name="results" type="s" direction="out"/>
    </method>
    <method name="Reindex"/>
    <method name="EnsureFresh"/>
    <method name="Quit"/>
    <property name="Status" type="s" access="read"/>
    <signal name="StatusChanged">
      <arg name="status" type="s"/>
    </signal>
  </interface>
</node>
```

**Query reply**

```json
{
  "files": [
    {"path": "/home/alice/Documents/report.pdf", "name": "report.pdf", "kind": "file"}
  ],
  "calc": {"expression": "1 km to m", "result": "1000 m"}
}
```

`calc` is omitted or `null` when there is no calculation. `files` is sorted best-first.
Empty/whitespace queries return empty arrays.

**Status**

```json
{
  "state": "indexing",
  "indexed": 123456,
  "roots": ["/home/alice"],
  "truncated": false,
  "watcher": "ok",
  "last_reconcile": 1762819200
}
```

`state`: `starting` | `indexing` | `ready` | `degraded`.
`watcher`: `ok` | `unavailable`.
`last_reconcile`: Unix seconds of the last successful full reconcile, or 0.
Status is also readable as the `Status` property. The signal is emitted on state changes
and at most twice per second during a scan.

**Errors and limits**

- Invalid args (query too long, limit out of range) → `org.freedesktop.DBus.Error.InvalidArgs`.
- `Reindex`: if a scan is running, no-op; otherwise re-read `config.toml`, schedule a
  rebuild, and return. `EnsureFresh`: no-op if a scan is running or the last reconcile
  is under 10 minutes old; otherwise schedule a rebuild. Both return immediately.
- `Quit`: cancel any running scan, write the last complete cache if dirty, release the
  bus name, and exit. The installer calls it before replacing the binary; the next call
  D-Bus-activates the new binary. Errors are ignored.
- `Query` always answers immediately from the last complete snapshot (cache, or empty
  during the first scan); it is never blocked on `ready`. During a rebuild the previous
  snapshot stays live. On a cold start without cache, files appear after the first scan.
- `Ping` returns the daemon version (`CARGO_PKG_VERSION` + git hash). The extension logs
  a warning once if it differs from its own metadata version; functionality is not gated.
- The extension uses a 500 ms call timeout and drops late replies.
- A service file (`packaging/io.github.alphabeast97.Sift.service.in`) points at the
  installed binary for D-Bus activation.

## 12. Liquid glass

### 12.1 Pipeline

```
panel (St.Widget, rounded by shader)
└── frame (St.Widget, clip_to_allocation, Shell.BlurEffect ACTOR)
    └── layers (Clutter.Actor, clips to the panel rect)
        ├── wallpaper clone (Main.layoutManager._backgroundGroup)
        ├── window-surface clones for windows intersecting the panel rect
        └── top-bar clone only if the panel rect intersects panelBox
    + Clutter.ShaderEffect on the panel: rounded mask, tint, saturation,
      sheen, lens bend near the edge, rim light
+ outer shadow via CSS box-shadow on a wrapper behind the panel
```

- The backdrop frame is the panel rect plus `blur radius` padding on all sides. Nothing
  fullscreen is ever rendered.
- Window clones copy the `MetaSurface` child, not the whole window actor, mirroring
  Isle's fix for Blur my Shell double-blur/flicker. The clone's paint volume is limited
  to the visible panel rect, so off-panel pixels cost nothing.
- Clones are rebuilt on open and on restack/window allocation/visible changes, coalesced
  through one `Meta.LaterType.BEFORE_REDRAW` later. No polling, no per-frame JS.
- The blur effect's large radius is achieved by downscaling in `Shell.BlurEffect`; radius
  ~36–44 is the starting range. Exact values are tuned in the M0 spike.
- Shader: rounded-rect signed-distance mask with 1 px antialiasing, tinted to the
  system color scheme, saturation ~1.1, a soft top sheen, a subtle inward lens (≈2–3 px)
  and a 1 px lit rim. All constants live in one place for tuning.

### 12.2 Performance behavior

- Panel size while results are shown is fixed for the current `max-results` (≈ 720×420
  at the default 6 rows), so keystrokes do not resize the blur frame.
- The overlay, entry, rows, blur effect, and shader are created at enable and reused.
  Only clones are built on open and destroyed on close.
- While the open/close animation runs, clones are not rebuilt; the animation is 120 ms
  open / 80 ms close with `easeOutQuad`.
- View switch: clones are built for the target rect first, then frozen during the 150 ms
  panel resize. No clone rebuild happens inside an animation frame. The grid rect (up to
  1040 × 70% of the monitor) is measured in M0; if it misses the frame budget, grid view
  uses the frosted panel while search keeps its selected glass mode.
- `Main.pushModal()` already disables unredirect; do not call
  `global.compositor.disable_unredirect()` again.
- On close: destroy all clones, disconnect source signals, cancel the pending later.
  Idle cost is zero.

### 12.3 Fallback

- `glass-mode` setting: `auto` (default), `liquid`, `frosted`, `off`.
- Runtime fallback to `frosted` if effect/clone creation throws (missing symbol, shader
  setup failure, actor API change). Frosted uses the same bounded clones + blur, but a
  CSS rounded translucent panel instead of the shader, and no lens/rim.
- `off` uses a flat translucent panel; useful for debugging and low-end GPUs.
- Grid view uses the same pipeline at its larger rect. If that rect misses the budget,
  the grid falls back to `frosted` while search keeps the selected mode; this is a
  measured M3 decision with the fallback logged once. A forced `liquid` setting still
  falls back if effect/clone creation throws.
- Performance fallback is a milestone decision, not runtime magic: if the M0 spike or
  the release measurements miss the frame budget on the target hardware, `auto` defaults
  to frosted (or the shader constants get cheaper). We do not auto-switch mid-session,
  which would flicker and complicate state.
- Blur my Shell is optional: if BMS is installed and the user wants it, the panel can
  carry `bms-popup-blur-target`; when BMS adds `bms-popup-blurred`, skip our own blur.
  This is a compatibility path, not a dependency, and it is off by default in v1 so the
  two blurs cannot fight.

## 13. UI and interaction

### 13.1 Search view

- One panel on the monitor under the pointer at open time. Multi-monitor: close and
  reposition on `monitors-changed`; never show one panel per monitor.
- Width: `clamp(560, 0.55 × monitor width, 720)` logical px.
  Top: 18% of monitor height, clamped so the panel and its shadow fit below the top bar.
- Layout:
  - 60 px entry with a search icon, 20 px text, placeholder "Sift Search", and a grid
    button on the right (`view-app-grid-symbolic`; accessible name "Show all
    applications"). Clicking it clears the query and shows the grid.
  - results viewport while non-empty: up to `max-results` rows (52 px each), also capped
    by the available monitor height; it scrolls only when that many rows do not fit.
    Rows carry their own icon and type subtitle; there are no section headers.
  - 32 px footer: keyboard hints on the left; index status on the right only while
    indexing/degraded.
  - empty state: a short hint, keyboard hints, and a "Show all applications" button;
    120 px tall.
- Rows: 28 px icon, title (15 px), subtitle (12 px, muted; app generic name or file
  parent path). Reused actors; no list rebuild.
- Selected row: translucent fill, 10 px radius; hover selects.

### 13.2 App grid view

The grid is a second view of the same panel, not a second window. It reuses GNOME's
`IconGrid.IconGrid`, `AppDisplay.AppIcon`, and `PageIndicators.PageIndicators`; no
native Overview state is involved.

- **Triggers:** Super+A (stock `toggle-application-view` → `show(APP_GRID)`),
  `showApps()`, the entry's grid button, and the empty-state button. Entering the grid
  clears the query. The entry's button toggles back to search; typing starts a new
  search. Escape closes Sift from either view.
- **Geometry:** the panel widens to `clamp(720, 0.72 × monitor width, 1040)` and grows
  down from 12% of monitor height to at most 70% of it. The entry stays at the top;
  the grid fills the space above a 28 px page-indicator strip. The width/height change
  is one 150 ms ease (skipped when animations are off), never a per-frame resize.
- **Content:** every `Shell.AppSystem` app with `should_show()`, deduplicated by id,
  sorted by display name with `localeCompare()`. Running apps keep the stock running
  dot. No folders, no recents, no drag, no context menus in v1.
- **Items:** one `AppDisplay.AppIcon(app, {isDraggable: false})` per app. Icons are
  `app.create_icon_texture(size)` through `AppIcon`; activation uses `Shell.App`, so
  startup notification, workspaces, and focus are correct. Ctrl+Enter and middle-click
  open a new window when the app allows it (stock `AppIcon` behavior).
- **Layout:** `IconGrid` with horizontal pages, `fixed-icon-size` =
  `grid-icon-size`, and columns/rows derived from the available width/height, clamped to
  4–10 columns and 2–6 rows. `page-padding` is 24 px; column/row spacing is 12 px.
  Columns and rows are recomputed on panel resize, not on every frame.
- **Paging:** clickable `PageIndicators` dots at the bottom; PageUp/PageDown change
  pages; the first/last item does not wrap to another page. `goToPage()` uses the stock
  250 ms `EASE_OUT_CUBIC` scroll, or no animation when disabled.
- **Keyboard:** the entry keeps key focus in both views, so typing always works; grid
  tiles get `can_focus = false` so a click cannot steal focus. In grid view the overlay
  intercepts arrows, Home/End, PageUp/PageDown, and Enter: arrows move the selection by
  one cell/row, Enter launches, and the selected tile uses
  `AppIcon.setForcedHighlight(true)`. The first tile is selected when the grid opens. A
  printable key switches to search view and becomes the first query character. Hover
  highlights a tile but does not move the keyboard selection.
- **Build:** the grid is empty at enable. On first open, icons are created in idle
  chunks of at most 30 and appended to the cached grid; the panel is interactive
  immediately. Later opens reuse the actors. `installed-changed` marks the grid dirty;
  a visible grid is rebuilt only after it closes. The grid is destroyed on `disable()`.
- **Accessibility:** the grid is accessible-named "Applications"; each tile exposes the
  app name through `AppIcon`'s label; page dots get "Page N" accessible names. Keyboard
  selection is visible and never relies on hover.

### 13.3 Preferences window and settings

`extension/prefs.js` is a standard `ExtensionPreferences` that opens an
`Adw.PreferencesWindow` (600×720, search enabled, title "Sift"). It reads and writes
`this.getSettings()`. Its only daemon contact is a fire-and-forget `Reindex` call for
the "Rebuild index" button; it never touches shell actors.

| Key | Type | Range / default | Effect |
|---|---|---|---|
| `glass-mode` | enum | `auto` / `liquid` / `frosted` / `off`; `auto` | `auto` uses liquid unless the build fell back; `off` is a flat translucent panel. |
| `glass-opacity` | double | 0.30–0.95; 0.72 | Panel tint opacity. |
| `blur-radius` | int | 0–64; 40 | Backdrop blur radius; 0 disables blur. |
| `glass-tint` | double | 0.0–1.0; 0.45 | Dark tint strength for legibility. |
| `animations` | bool | true | Open/close and view transitions; also off when `org.gnome.desktop.interface.enable-animations` is false. |
| `max-results` | int | 4–12; 6 | Maximum rows in the search view. |
| `search-height` | int | 144–716; 404 | Expanded search-panel height in logical pixels; clamped to the monitor. |
| `grid-labels` | bool | true | Show app names under grid icons; the cell geometry is unchanged. |
| `disable-overview` | bool | true | Hands Super and Super+A to Sift and silences every other GNOME overview trigger: Activities, the hot corner, swipe, Super+Tab and the login overview do nothing. Off keeps GNOME's overview and binds Ctrl+Space / Alt+A. |
| `sift-search-shortcut` | string array | `<Control>space` | Opens Sift search. While the overview is disabled and this has no user value, Super is the trigger instead; a recorded value replaces it. |
| `sift-apps-shortcut` | string array | `<Alt>a` | Opens Sift's app grid. While the overview is disabled and this has no user value, Super+A is the trigger instead; a recorded value replaces it. |

- **Groups:** Appearance (mode combo, opacity, blur radius, tint, animations), Behavior
  (search height, max results, app-grid labels, overview disable, both shortcuts), and
  File indexing (note + "Rebuild index" button). Switches use `Adw.SwitchRow`; numbers
  use `Adw.ActionRow` + `Gtk.Scale` (200 px wide, value shown, step 1 for integers, 0.05
  for doubles); the mode uses `Adw.ComboRow`; the rebuild action uses
  `Adw.ActionRow` + a `Gtk.Button` suffix. Shortcut rows show a `Gtk.ShortcutLabel` and
  open a key-capture dialog; an unset row shows Super / Super+A while the overview is
  disabled and Ctrl+Space / Alt+A otherwise. A new shortcut is rejected if GNOME, a
  custom media key, or Sift's other shortcut already uses it. Every slider, switch and
  shortcut row has a per-row reset button; resetting a shortcut returns its mode
  default.
- **Live apply:** the extension connects `changed::<key>` for every key. Glass keys
  update uniforms or rebuild the effect in place; `max-results` re-renders the current
  results; `grid-labels` relabels the cached grid without relayout; shortcut changes
  rebind immediately, disconnect or reconnect the overlay-key listener, and update the
  shortcut rows; `disable-overview` takes over or restores every GNOME overview trigger
  and the Super defaults immediately. No shell restart and no reopen is required.
  Changes made while Sift is closed apply on the next open.
- **File indexing:** a note row explains that indexing runs in `siftd`, is configured in
  `~/.config/sift/config.toml`, and is disabled with `roots = []`. "Rebuild index" calls
  `Reindex`, which re-reads `config.toml` and rebuilds in the background; a toast reports
  if the daemon is unreachable. There is deliberately no switch that leaves the daemon
  watching `$HOME` (see §5).
- **Defaults:** the values above are the schema defaults, so Sift works correctly if the
  prefs window is never opened.

Shared presentation:

- Light/dark follows `St.Settings.get().color_scheme`; the tint and text colors switch
  together. The blur is dark-tinted by default for legibility over any wallpaper.
- Fonts inherit the GNOME interface font. No custom font dependency.
- Accessibility v1: entry accessible-name, per-row and per-tile accessible-names, full
  keyboard navigation, visible focus/selection, high-contrast-safe border, and labelled
  prefs controls. Full Orca announcement of selection changes is a follow-up; the
  design does not claim it.
- Animation: opacity + 0.98→1 scale on open (120 ms), reverse on close (80 ms); grid
  view switch 150 ms. Focus is grabbed immediately, not after the animation. All
  durations are zero when animations are off.

## 14. Performance

### 14.1 Budgets

| Metric | Target |
|---|---|
| Super → first visible frame (warm) | ≤ 50 ms P95 |
| Super → first visible frame (first after login) | ≤ 120 ms |
| Keystroke → apps updated | same frame (≤ 16 ms) |
| Keystroke → files/calc merged | ≤ 80 ms P95 with a warm 250k index |
| Frame interval while open/animated | P95 ≤ 16.7 ms; no frame > 33 ms |
| Open/close animation | ≤ 2 dropped frames |
| App grid, first open (cold) | Panel visible within the normal open budget; icons complete in idle chunks ≤ 200 ms. |
| App grid, warm open | ≤ 2 frames; no icon re-creation. |
| Grid view, liquid glass | P95 ≤ 16.7 ms at the 1040 × 70% rect; otherwise the grid uses frosted. |
| Settings change → visible effect | Glass ≤ 1 frame; results/grid re-layout ≤ 16 ms. |
| Closed idle | 0% CPU, no timers, no per-frame callbacks |
| Daemon idle | 0% CPU; inotify thread blocked; wakeups < 5/s |
| Extension extra JS heap | ≤ 25 MB |
| Daemon RSS at 250k | ≤ 120 MB |
| Index rebuild 250k on SSD | ≤ 10 s; cache load ≤ 300 ms |
| First query after activation | ≤ 300 ms including process start |

### 14.2 Rules

- Apps in the shell; files/calc in Rust. No directory walking, index scan, or file
  content read in GJS. The only filesystem access is bounded async `query_info`
  (`standard::icon`, metadata only) for the ≤ 12 visible file rows, cached (256 entries).
- One in-flight D-Bus query, 40 ms debounce, stale replies dropped.
- Precompute lowercase app names once; precompute lowercase file basenames once.
- Reuse rows and icons; update text/gicon in place.
- Search view: fixed panel size while typing; only empty↔results resizes. Grid view has
  its own fixed larger size.
- App grid: build once on first open in idle chunks of ≤ 30 icons, cache the actors, and
  rebuild only after `installed-changed` while closed. Never create textures inside the
  open animation.
- GSettings changes are signal-driven; no polling. Prefs runs in its own process and
  never touches shell actors directly.
- Event-driven backdrop updates, coalesced before redraw; no per-frame JS.
- No `GLib.timeout_add` polling. Timers exist only for the debounce, the status
  throttle, and the close animation.
- Index scans run on a background thread with 4 walker threads; queries never hold the
  write lock while matching.

### 14.3 Measurement

- **Rust:** `cargo bench` (criterion) for index build, cache load, 250k-query P50/P95,
  and calculator evaluation. Not a CI gate, but recorded in `docs/perf/`.
- **Headless shell:** the automation script measures open/close latency and asserts
  functional behavior. Software rendering (llvmpipe) makes absolute FPS meaningless;
  CI gates correctness and gross timing (for example, open < 500 ms), not 60 fps.
- **Real session:** a debug-only frame meter (`tools/perf/frame-meter.js`, enabled by
  `SIFT_PERF=1`) registers one `BEFORE_REDRAW` callback, records frame intervals
  during open/typing/close, and logs P50/P95/max and long frames to the journal. It is
  not loaded in normal use. `sysprof-cli` captures CPU/GPU costs. Measurements and
  screenshots/notes live under `docs/perf/` so they survive `/tmp`.
- Acceptance for the release: on the development machine (Intel i915, GNOME 51.1),
  P95 frame interval ≤ 16.7 ms while typing and animating, and open ≤ 50 ms warm. If
  liquid glass misses it, the release defaults to frosted and the measurement is
  recorded.

## 15. Reliability and failure modes

| Failure | Behavior |
|---|---|
| Daemon missing / not activated | Apps still search; footer shows "Search service unavailable"; retry with 5 s backoff on typing. |
| Daemon crashes | Bus-name owner change detected; proxy reconnects when it returns; no shell crash. |
| Index truncated at cap | Status `truncated: true`; search still works; footer notes the cap once. |
| inotify watch limit | Status `degraded`, `watcher: "unavailable"`; manual `Reindex`; `EnsureFresh()` on open if stale > 10 min. |
| Home on slow/network FS | Caps and excludes still apply; scan is background; queries answer from cache or the last complete snapshot, apps are always available. |
| Shader/clone failure | Auto-fallback to frosted; log once. |
| App icon texture failure | Generic icon placeholder; the grid stays usable. |
| `installed-changed` while grid is open | Grid marked dirty; visible actors remain; rebuild after close. |
| Settings schema missing/corrupt | Enable aborts with a clear log; `make test` compiles the schema so a release cannot hit this. |
| Prefs window open while Sift is disabled | Settings can still be edited; they apply on the next enable. |
| Stale file path | Row removed on activation failure; debounced reindex requested. |
| Shell version mismatch | Extension declares 51 only; enable aborts with a clear log if required APIs are absent. |
| Extension disabled while open | Grab popped, actors destroyed, Overview restored. |

## 16. Security and privacy

- The daemon is session-bus only and same-user; it exposes filenames (paths), never file
  contents. It opens nothing and executes nothing.
- Cache and config are user-only (0700 directory, 0600 cache). Queries and paths are not
  logged in normal operation; debug logging is opt-in.
- The app grid lists only what `Shell.AppSystem` already exposes in the shell; it does
  not read `.desktop` files or icon directories itself. The prefs window is an ordinary
  user-scoped GSettings client with no privileged surface.
- The extension opens files only through the desktop's default handler and reveals via
  the standard FileManager1 interface. No shell interpolation, no command execution.
- No network access in v1.
- Query/limit lengths are validated at the D-Bus boundary (trust boundary).
- GPL-3.0-or-later plus `THIRD_PARTY_NOTICES` for `nucleo-matcher` (MPL-2.0),
  `fend-core` (MIT), and any adapted Isle/BMS shader math with attribution.

## 17. Repository layout

```
.
├── LICENSE                          GPL-3.0-or-later
├── README.md                        what it is, install, usage, screenshots later
├── Makefile                         build/test/install/uninstall/dev targets
├── .editorconfig
├── .gitignore
├── rust-toolchain.toml
├── THIRD_PARTY_NOTICES              MPL/MIT dependency and attribution notices
├── .github/workflows/
│   ├── ci.yml                       required fast checks
│   ├── ci-image.yml                 build/publish the pinned GNOME 51 test image
│   ├── shell-smoke.yml              GNOME 51 headless harness (main + nightly)
│   └── release.yml                  tag artifacts
├── docs/
│   ├── research/phase-0-findings.md
│   ├── superpowers/specs/2026-11-11-sift-design.md
│   ├── perf/                        committed measurements and notes
│   └── superpowers/plans/           implementation plan (after approval)
├── extension/
│   ├── metadata.json                uuid, name, shell-version ["51"], settings-schema
│   ├── extension.js                 lifecycle, enable/disable, test hooks
│   ├── stylesheet.css               panel/row/entry/grid/prefs styles
│   ├── prefs.js                     Adw preferences window (§13.3)
│   ├── src/
│   │   ├── overlay.js               actor tree, focus, keyboard, modal, animation
│   │   ├── appGrid.js               IconGrid/AppIcon, paging, selection, lazy build
│   │   ├── glass.js                 backdrop clones, blur, shader, fallback
│   │   ├── overview.js              wrappers, keybindings, gestures, restore
│   │   ├── apps.js                  Shell.AppSystem snapshot + scoring
│   │   ├── files.js                 file result icons/actions
│   │   ├── daemon.js                D-Bus proxy, status, query sequencing
│   │   ├── results.js               merge, selection, row binding
│   │   └── lib/                     pure JS: scoring, merge, format, grid math
│   ├── schemas/org.gnome.shell.extensions.sift.gschema.xml
│   └── tests/                       pure unit tests + headless hooks
├── daemon/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── src/
│   │   ├── main.rs                  args, bus name, shutdown
│   │   ├── config.rs                TOML roots/excludes/caps
│   │   ├── index.rs                 walk, snapshot, incremental updates
│   │   ├── cache.rs                 versioned path cache
│   │   ├── query.rs                 prefilter + nucleo top-K
│   │   ├── calc.rs                  fend-core wrapper + heuristics
│   │   ├── dbus.rs                  interface, status signals
│   │   └── status.rs                shared status model
│   └── tests/                       unit + D-Bus integration (dbus-run-session)
├── packaging/
│   ├── install.sh                   standalone release installer (also used by make)
│   └── io.github.alphabeast97.Sift.service.in
└── tools/
    ├── ci/gnome51/Dockerfile        pinned Arch snapshot + GNOME 51 test image
    ├── test/headless.js             shell automation script
    ├── test/run-shell-test.sh       pack + run under dbus-run-session
    └── perf/frame-meter.js          debug-only frame interval recorder
```

## 18. Testing and CI

### 18.1 Test pyramid

**Rust unit tests**

- Walker: hidden skip, excludes, symlink skip, same-fs, cap, truncation flag.
- Cache: round-trip, version/fingerprint mismatch, permissions.
- Query: exact/prefix/substring/subsequence ranking, limit clamp, empty query, Unicode
  lowercase, 250k benchmark smoke.
- Calc: arithmetic, units, invalid input, deadline, no-result heuristics.
- Config: defaults, `~` expansion, invalid TOML.

**Rust integration tests**

- Start `siftd` in a temp XDG environment with a fixture tree under
  `dbus-run-session`, call `Ping`/`Query`/`Reindex`/`EnsureFresh`/`Quit` over a real
  session bus, assert results, status transitions, and that a second instance exits
  cleanly.
- Cold start with no cache: `Query` returns promptly with empty `files` while `state` is
  `indexing`; after the first scan it returns results. During a rebuild, a query sees the
  previous complete snapshot, never a half-built one.
- `Reindex` re-reads an edited config (for example `roots = []`); `Quit` flushes the
  cache, releases the bus name, and exits.
- Test D-Bus argument validation and JSON shape.

**GJS unit tests (no shell imports)**

- `gjs -m tests/unit/all.js` with a tiny assert harness (no npm test framework).
- Cover app scoring, merge order/selection stability, path abbreviation, calc-row
  heuristics mirroring the daemon, key handling state, and grid math: columns from
  width, rows from height, page count, index ↔ (page, cell), and edge clamping.
- Schema test: `glib-compile-schemas --strict` then `gsettings` in a temp
  `GSETTINGS_SCHEMA_DIR` asserts every key, type, range, and default from §13.3.
- ESLint (flat config) enforces GNOME-style 4 spaces, single quotes, semicolons, no
  unused vars; `no-undef` with GJS globals. `prefs.js` is linted with the extension.

**Headless shell smoke test (GNOME 51)**

- `tools/test/run-shell-test.sh` packs the extension, then runs
  `dbus-run-session -- gnome-shell-test-tool --headless --extension <zip>
  tools/test/headless.js`.
- The automation script asserts:
  - the extension enables without exceptions;
  - with the overview disabled by default, `Main.overview.toggle()`, `show()`,
    `focusSearch()`, `showApps()` and `Main.layoutManager.showOverview()` do nothing,
    including Super+Tab and the Activities path;
  - emitting `overlay-key` opens and closes Sift search (the Super default), and
    `show(ControlsState.APP_GRID)` opens the Sift grid (the Super+A default);
  - enabling the GNOME overview restores its methods and binds Ctrl+Space / Alt+A;
  - recording a shortcut unbinds its Super default, and reset returns it;
  - querying "term" yields Terminal in the results (app path);
  - entering the grid clears a non-empty query; typing in the grid switches to search
    and the character lands in the entry;
  - Escape closes from either view; query clears on close;
  - `grid-icon-size` changed through the keyfile GSettings backend relayouts an open
    grid and `max-results` changes the visible row count, with no reopen;
  - disabling the extension restores `Main.overview` methods and leaves no modal grab;
  - re-enabling works.
- File/calc end-to-end variant: `run-shell-test.sh` starts the built `siftd` on the
  private session bus with a fixture config/root before launching the shell; the
  extension connects through its normal proxy and never spawns a process. The script
  asserts a file result and a calculator result. This is the only test that exercises
  the whole path.
- `gnome-shell-test-tool` creates a scratch XDG home and uses `GSETTINGS_BACKEND=keyfile`,
  so it cannot touch the developer's settings. It needs a private session bus; the
  wrapper provides `dbus-run-session`.

**Manual release checks**

- Real session on GNOME 51.1 / Intel i915: warm open, typing, 60 fps frame meter,
  light/dark, 100%/200% scaling, two monitors, fullscreen app, BMS on/off, disable/enable,
  logout/login.
- App grid: Super+A, empty-state button, paging with dots and keys, 100+ app
  case, typing switches to search, icon size changes live, no drag/folders.
- Preferences: `gnome-extensions prefs sift@alphabeast97.github.io`; change every toggle
  and slider, verify the live effect, close/reopen persistence,
  `gsettings reset-recursively` restores defaults, and "Rebuild index" applies an edited
  `config.toml` (for example `roots = []`).
- Fresh user install and uninstall.

### 18.2 CI

Fast job (every push/PR once the repo exists at M5, required):

- Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- GJS lint + pure tests (`gjs` installed), including the grid math and schema tests.
- Extension pack (`gnome-extensions pack` with the compiled schema) + metadata/schema
  sanity: UUID, shell 51, `settings-schema` matches the XML id, every key compiles.
- D-Bus integration tests under `dbus-run-session`.

Container job (main + nightly, required on main after M5):

- The test image is **built by this repo**, not a stock rolling tag. `ci-image.yml`
  builds `tools/ci/gnome51/Dockerfile` from an `archive.archlinux.org` snapshot pinned
  to the GNOME 51 era, installs GNOME Shell 51, `gnome-shell-test-tool`, GJS, Mesa
  (llvmpipe), D-Bus, and Python, and publishes it to GHCR. `shell-smoke.yml` references
  the image by **digest**.
- Moving the pin to GNOME 52 is a deliberate version-support task, not an automatic bump.
  If Arch's archive snapshot is unavailable, the same Dockerfile can build from a
  Fedora/COPR or a source-built GNOME 51; the interface to the smoke job is unchanged.
- Build the extension zip and daemon, run the headless smoke test.
- Software rendering means this is a correctness gate, not a frame-rate gate.
- Until M5 the same image is built locally and the jobs run through `make ci`/`act`;
  GHCR publishing and required checks begin when the repository is created at M5. The
  image digest and workflow files are written in M1 so publishing is a wiring step, not
  a redesign.

Risk: the headless harness needs EGL/GBM; on a GPU-less runner it must run on llvmpipe
(Mesa surfaceless). If that proves impossible in the container, fall back to
`xvfb-run` + a nested X11 shell for the smoke test. This is resolved during M1; it does
not change the product design. The local harness is already proven on this machine.

Release job (tag `v*`):

- Build `siftd` (x86_64-unknown-linux-gnu) and the extension zip.
- Publish the standalone `packaging/install.sh`, both artifacts, and `SHA256SUMS` on the
  GitHub release.
- No push or tag until the user has verified the final local build.

### 18.3 Local commands

```
make build        # daemon release + extension zip
make test         # rust tests, GJS unit tests, lint
make test-shell   # headless GNOME Shell smoke (dbus-run-session)
make install      # binary + D-Bus service file + extension + enable
make prefs        # open the installed extension's preferences window
make uninstall    # disable + remove; keep config/cache unless PURGE=1 (maps to --purge)
make fmt / lint
```

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `refactor:`,
`chore:`. One coherent change per commit.

## 19. Packaging and install

`packaging/install.sh` is the one installer. It works from a release tarball (binary and
extension zip next to it) and is reused by `make install` with locally built artifacts;
v1 does **not** download anything, so there is no network trust path in the installer.

`make install` (no root) runs it with local artifacts:

1. `cargo build --release --manifest-path daemon/Cargo.toml`.
2. Call `Quit` on the session bus if `siftd` is running (ignore errors), wait up to 2 s
   for the bus name to disappear, then install the new `siftd` to `~/.local/bin/` via a
   temp file + `mv` (an atomic replace avoids `ETXTBSY` if the old process lingers). If
   no session bus is reachable, the installer notes that a logout is needed for the
   running daemon to be replaced.
3. Generate the D-Bus service file with the absolute binary path into
   `~/.local/share/dbus-1/services/`.
4. `gnome-extensions pack extension/ --schema=extension/schemas/org.gnome.shell.extensions.sift.gschema.xml -o dist/`
   and `gnome-extensions install --force dist/<uuid>.zip`.
5. `gnome-extensions enable <uuid>` (with a logout/login note on Wayland if the shell
   has not seen the extension yet).

- `gnome-extensions prefs <uuid>` opens the preferences window (§13.3). Settings are
  ordinary GSettings under `org.gnome.shell.extensions.sift` and can also be scripted
  with `gsettings`.

- The standalone script accepts `--prefix` (default `~/.local`) and `--uninstall`
  (`--purge` also removes config/cache). It checks that `gnome-extensions` and
  `gjs`/GNOME 51 are present and prints a clear next step if not.
- Upgrades: rerun the installer; it quits the old daemon, replaces the binary, and
  reinstalls the extension. The shell reloads it on disable/enable or next login; D-Bus
  activation starts the new daemon on the next call.
- Uninstall: disable + uninstall the extension, remove the binary and service file;
  keep config/cache unless `--purge`.
- Distribution limits: an EGO zip cannot install `siftd`. V1 documents the script.
  AUR and Flatpak (`--talk-name` for the daemon bus name) are future release work.

## 20. Milestones

Each milestone ends with a working, testable state and conventional commits. Tests listed
are added in that milestone, not retrofitted.

### M0 — Glass and overview spike (throwaway, 1–2 days)

- Minimal extension: centered panel, super key opens/closes it, one window backdrop
  clone + `Shell.BlurEffect` + rounded shader.
- Verify on the real session: clone correctness (window, video, fullscreen), visual
  look, frame interval via the debug frame meter, unredirect behavior, BMS enabled.
- Measure both panel rects: the default search panel and the maximum grid panel
  (1040 × 70% of the monitor), including one view-switch resize.
- Verify the Overview hooks: `overlay-key`, `toggle-overview`, Activities, hot corner,
  `showApps`, gestures, disable restore.
- Record measurements and decisions in `docs/perf/` and
  `docs/research/glass-spike.md`; delete the spike code.
- **Exit:** liquid glass is visually acceptable and within budget, or the measured
  reasons it is not; the hook list in §8 is confirmed or corrected.

### M1 — Extension foundation

- Repo scaffolding, lint, unit-test harness, extension packaging, headless smoke runner.
- Build the pinned GNOME 51 image locally with Docker/podman from
  `tools/ci/gnome51/Dockerfile` and run the headless harness against it. Write
  `ci-image.yml` and `shell-smoke.yml`, but do not publish to GHCR or push; the repo does
  not exist yet.
- Overview wrappers + keybinding/gesture handling + restore tests.
- Overlay actor, entry, keyboard navigation, empty state, modal/focus/click-outside.
- App search, rows, activation, multi-monitor placement.
- GSettings schema with the §13.3 defaults; the extension reads and applies them (the
  prefs UI arrives in M4).
- App grid view: `IconGrid`/`AppIcon` reuse, lazy chunked build, paging, keyboard
  selection, Super+A/`showApps` routing.
- **Exit:** Super/Activities/hot corner open Sift; Super+A opens the grid and typing
  returns to search; Esc closes; disable restores the stock Overview; `make test` and
  `make test-shell` pass on the locally built pinned image; the Actions workflows are
  ready but not pushed.

### M2 — Daemon and search

- Rust crate: config, walker, cache, index snapshots, watcher, query, calc.
- D-Bus interface, service file, activation, status signals.
- Daemon lifecycle: `Quit` with cache flush, `Reindex` re-reads config, `Ping` version.
- Extension daemon proxy, debounce, sequencing, footer status, error state.
- File rows (icons, open, reveal), calc row (copy), merge/selection.
- **Exit:** file and calculator results work end-to-end; 250k benchmark within budget;
  Rust integration + headless end-to-end tests pass.

### M3 — Glass integration

- `glass.js`: bounded clones, blur, shader, tint/rim/lens, fallback modes, cleanup.
- Glass parameters read live from GSettings (mode/opacity/blur/tint); changes apply
  without reopening.
- Open/close animation, fixed results height, event-driven backdrop updates.
- Both panel rects: search glass and the larger grid; freeze clones during the view
  switch. If the grid misses the budget, make its frosted fallback explicit.
- Real-session frame measurements; tune or choose frosted default.
- **Exit:** P95 frame interval ≤ 16.7 ms on the target machine (or documented fallback);
  no leaks across 20 open/close cycles; BMS on/off both look correct.

### M4 — Polish and packaging

- Light/dark theming, high-contrast check, a11y labels, path abbreviations, icons.
- `prefs.js`: Adw window with every §13.3 key, live apply, reset-safe defaults;
  schema test added to `make test`.
- App-grid polish: icon-size relayout, page-dot labels, empty/100+ app cases.
- Standalone `packaging/install.sh` (install/upgrade/uninstall/`--purge`), README,
  `THIRD_PARTY_NOTICES`, LICENSE.
- Release artifacts and checksums.
- **Exit:** clean install on a fresh user works; every prefs control changes the live UI;
  uninstall leaves no extension, binary, service file, or active keybinding.

### M5 — Verification and handover

- Full local verification; manual matrix from §18.1; fix findings.
- User verifies the local build and approves.
- Only then: create the GitHub repository, push, publish the CI image to GHCR, enable the
  required workflows, and tag the release.

## 21. Feasibility risks (ranked)

1. **Overview blocking is private API and can change in any shell update.** Mitigation:
   GNOME 51 only, narrow wrappers, feature checks, headless regression tests, documented
   hook list, exact restore. This is the main reason for a 51-only v1.
2. **Super routing edge cases** (`overlay-key`, `toggle-overview`, sticky keys, second
   press, touchpad gesture, custom shortcuts). Mitigation: M0/M1 tests for each entry
   point; disable the
   swipe tracker; keep native `visible` false and do not emit native signals.
3. **Glass performance/quality varies by GPU and window type.** The grid rect is ~2–3×
   the search area, so it is measured separately. Mitigation: bounded frame, surface
   clones, event-driven updates, frozen clones during view switches, frame meter,
   frosted fallback (search and/or grid) selected at the milestone gate, BMS
   compatibility tested.
4. **Daemon distribution.** EGO cannot install a binary. Mitigation: script install now;
   AUR/Flatpak later; the extension degrades to app search if the daemon is absent.
5. **Index correctness under churn and inotify limits.** Mitigation: cache + startup
   reconcile + open-time reconcile + cap + explicit degraded status; no timer when idle.
6. **First-call daemon activation latency.** Mitigation: `Ping` at enable warms it; D-Bus
   activation is fast; 500 ms timeout with app-only fallback.
7. **Multi-monitor/fractional-scaling geometry.** Mitigation: logical coordinates
   throughout, close on monitor change, manual 100%/200% + dual-monitor tests.
8. **Licensing.** GPL-3.0-or-later, notices for MPL/MIT dependencies and adapted glass
   math. Mitigation: `LICENSE` + `THIRD_PARTY_NOTICES` before the first push.
9. **Blur my Shell conflicts.** Mitigation: off by default; opt-in class only; clone
   surfaces, not window actors; test with BMS enabled.
10. **Scope creep.** The app grid and prefs window are now in scope; window picker,
    recents, folders, drag ordering, plugins, and live currency remain out. The
    anti-goals in §4 are the line.
11. **Shell app-grid API drift and first-open cost.** `IconGrid`/`AppIcon` are exported
    but are shell internals and can move in 52. Mitigation: 51-only pin, all reuse kept
    in `appGrid.js`, lazy chunked build, headless grid test, and a small custom
    `Clutter.FlowLayout` as the contingency if the components misbehave.

## 22. What is left to the builder

The implementation plan decides: exact test file names, function signatures, cache byte
layout, D-Bus helper structure, row/grid widget internals, shader source layout, and
commit splitting. Exact glass colors, blur radius, and lens strength are tuned in M0
against the real screen; starting values are listed in §12. The prefs row order and
widget widths are cosmetic and may move. No product behavior is left open.

## 23. Approval checklist

- [ ] Scope: search + app grid + prefs; Super and Super+A open Sift by default; no
      window/workspace picker.
- [ ] App grid: Super+A, `showApps`, entry and empty-state buttons; `IconGrid`/`AppIcon`
      reuse; paged, keyboard-navigable, lazily built; no folders or drag.
- [ ] Prefs: Adw window with all §13.3 keys, live apply; no file-search switch
      (config.toml controls indexing).
- [ ] Architecture: GJS UI/glass + Rust daemon over D-Bus.
- [ ] Glass: bounded liquid glass with frosted fallback; BMS optional only; the larger
      grid rect is measured separately and may fall back to frosted.
- [ ] Daemon lifecycle: `Quit` before upgrade, `Reindex` re-reads config, cold start is
      app-only until the first scan.
- [ ] GNOME 51 only, GPL-3.0-or-later.
- [ ] Name/UUID/bus name (or rename now).
- [ ] File index defaults (`$HOME`, hidden skipped, excludes, 250k cap).
- [ ] No recents, no live currency, query clears on close.
- [ ] Milestones and CI strategy.
