# Spotlight for GNOME Shell 51 — Design

Date: 2026-11-11
Status: **Draft for approval.** No implementation starts until this document is approved.
Working name: **Spotlight** (rename before first release if desired; the UUID is harder to change later).

---

## 1. Intent

Build a macOS-Spotlight-style search for GNOME Shell 51. One key — Super — opens a
centered search panel over the current desktop. Typing finds installed applications
and files, and evaluates arithmetic/unit expressions. The panel has a liquid-glass
backdrop that looks like macOS/Isle glass, with a simpler frosted blur as fallback.
It must feel instant: open in one or two frames, no input lag, 60 fps while open,
and zero idle cost when closed.

This replaces the **entire** GNOME Overview. Super, Activities, the hot corner, and
any shell caller of `Main.overview.show/hide/toggle` open Spotlight instead. There is
no workspace picker, no window picker, and no app grid.

The Rust part exists because indexing the home directory and fuzzy matching 250k paths
inside the GNOME Shell process would risk the frame budget. The visible UI, focus,
input, and glass must stay in GJS because an extension cannot load native code into the
shell or draw into its compositor. This split is not an implementation preference; it
is the only supported shape (see `docs/research/phase-0-findings.md`).

## 2. Goals

- Super/Activities/hot corner open the same centered search overlay.
- Application search is instant and uses GNOME's own `Shell.AppSystem` and activation
  paths so workspaces, startup notification, and focus behave correctly.
- Filename search over the user's home directory, with live updates, in Rust.
- Arithmetic and unit conversion via `fend-core`, with no network requirement.
- A liquid-glass panel (blurred live backdrop + rounded shape, tint, subtle lens and
  rim) that reaches 60 fps, or the frosted fallback if the budget is missed.
- Clean enable/disable: every patch, signal, actor, timer, and D-Bus subscription is
  removed. Disabling the extension restores the stock Overview.
- A real automated test pipeline, including a headless GNOME Shell smoke test, and a
  local install that is one command.

## 3. Non-goals (v1)

- Window picker, workspace overview, app grid, dash, or window thumbnails.
- File **content** search; only file and directory names.
- Web search, clipboard history, recent files, emoji, or a plugin/provider system.
- Live currency exchange rates (no network calls from v1).
- Touchpad gesture to open Spotlight (the stock overview gesture is disabled).
- A preferences window. Settings exist in GSettings and are changed with
  `gsettings`; a prefs UI is a later addition.
- GNOME 46–50 support. GNOME 51 only (see §4).
- Shipping through extensions.gnome.org. EGO cannot install the Rust daemon; v1
  installs with a script (see §17).

## 4. Anti-goals

- **Shipping a second rate-limited search UI that still feels like GNOME's Overview.**
  This is not a reskin of the Overview; it is a Spotlight overlay. If it opens the
  workspace picker or app grid, it has failed.
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
- **Display name `Spotlight`, UUID `spotlight@alphabeast97.github.io`,
  daemon `spotlightd`, bus name `io.github.alphabeast97.Spotlight`.**
  "Spotlight" is a working name and may be a trademark concern if published; rename
  before the first public release if that matters. The UUID is cheap to change only
  before users have settings and caches.
- **File index: filenames and directory names only**, `$HOME` by default, hidden
  entries skipped, 250,000-entry cap, heavy build/cache directories excluded (§10).
- **No prefs window in v1.** A small GSettings schema covers glass mode, max results,
  and file-search on/off.
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
┌────────────────────────────── GNOME Shell process (GJS) ─────────────────────────────┐
│                                                                                      │
│  Overview takeover ──► SpotlightOverlay ──► ResultsModel ──► glass + St widgets       │
│  (wrappers, keybinding)      │                  │                                    │
│                              │                  ├── Apps: Shell.AppSystem (sync)      │
│                              │                  └── Files/calc: D-Bus proxy (async)  │
│                              ▼                                                       │
│                        Main.pushModal() / focus / Escape / click-outside              │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │ session D-Bus
                                        │ io.github.alphabeast97.Spotlight
                                        ▼
┌────────────────────────────── spotlightd (Rust, one process) ────────────────────────┐
│  D-Bus interface: Query / Reindex / Ping / Status + StatusChanged                     │
│  Query ──► Calc (fend-core)                                                           │
│       └──► File index (nucleo-matcher): snapshot, top-K, JSON                         │
│  Indexer: walk $HOME → cache → inotify watcher → incremental updates                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Extension (GJS) responsibilities

- Take over the Overview entry points and restore them on disable (§8).
- Own the overlay actor, entry, result rows, focus, keyboard handling, and modal grab.
- Search apps synchronously from a list built at enable and refreshed on
  `app-system` changes (`installed-changed`, `app-state-changed` as needed).
- Send file/calculator queries to the daemon asynchronously; drop stale replies.
- Render the glass; own its fallback.
- Open apps, files, and folders; copy calculator results.
- Never walk the filesystem, never run a per-frame loop.

### 7.2 Daemon (`spotlightd`) responsibilities

- Build and maintain the filename index with `ignore` + `notify`.
- Answer queries over D-Bus with file matches and at most one calculator result.
- Serve instantly from cache on startup, then reconcile in the background.
- Report index state/count/truncation over `Status`/`StatusChanged`.
- Stay idle-cheap: no polling; the inotify thread blocks.
- Not launch apps or open files; that stays in the shell, which has the desktop context.

### 7.3 Lifecycle

- Extension `enable()`:
  1. Read settings; build the app list; install Overview wrappers; replace/disable
     keybindings and gestures; create the hidden overlay; add it as chrome.
  2. Create the D-Bus proxy and call `Ping` asynchronously. If the daemon is missing,
     the extension still works for apps; the footer shows "Search service unavailable".
  3. Subscribe to `StatusChanged`; do **not** create timers.
- Daemon start is D-Bus-activated by the first `Ping`/`Query`, or by the installed
  service file at session start. No systemd unit is required.
- `disable()`: close if open, destroy actors and effects, unbind signals, restore the
  Overview methods/keybindings/gestures, drop the proxy, remove chrome. No daemon kill:
  it is shared session infrastructure and exits naturally at logout.
- Daemon exits if it cannot own its bus name (a second instance), and on session bus
  disconnect.

## 8. Taking over the Overview

This is the highest-risk area. The implementation is deliberately narrow and every
change is reversible.

### 8.1 What actually triggers the Overview on GNOME 51

- **Super alone** is Mutter's `overlay-key` (default `'Super'`). `OverviewControls`
  connects to `global.display`'s `overlay-key` signal and calls
  `Main.overview.toggle()` dynamically. The `toggle-overview` GSettings binding exists
  but defaults to `[]`; it only matters if the user has assigned it.
- **Activities button, hot corner, and shell D-Bus** call
  `Main.overview.toggle()` / `show()` / `hide()` dynamically. Wrapping the instance
  methods catches them without patching each caller.
- **`toggle-application-view`** (Super+A or user binding) calls
  `Main.overview.show(ControlsState.APP_GRID)` dynamically, so it opens Spotlight too.
- **Touchpad overview gesture** uses `Main.overview._swipeTracker`, which directly
  drives the native overview and bypasses public methods. It must be disabled.
- **`Main.overview` is an ESM live binding** and cannot be replaced. Only instance
  methods can be shadowed.

### 8.2 The patch set

On enable:

1. For each name in `show`, `hide`, `toggle`, `focusSearch`, `showApps`, and
   `shouldToggleByCornerOrButton`, record whether it is an **own** property of the
   `Main.overview` instance and save the current value. This matters because another
   extension may already have patched one of them; restoring must put back that exact
   value, or delete our shadow if there was none.
2. Shadow them on the `Main.overview` instance with wrappers:
   - `show(...)` / `showApps()` → open Spotlight, focus the entry, ignore the requested
     native state.
   - `hide()` → close Spotlight.
   - `toggle()` → toggle Spotlight.
   - `focusSearch()` → open Spotlight and focus the entry.
   - `shouldToggleByCornerOrButton()` → mirror the stock semantics (no toggle while our
     open/close animation runs, and no toggle within 0.5 s of our last open) so the
     hot-corner-then-Activities double trigger stays guarded without touching native
     private state.
3. Remove and re-add `toggle-overview` **only if** it has a non-empty binding; bind it
   to our toggle with the same `org.gnome.shell.keybindings` schema, flags
   `IGNORE_AUTOREPEAT`, and modes `NORMAL | OVERVIEW`. On disable, remove ours and
   re-add a dynamic `() => Main.overview.toggle()` handler (after the wrappers are
   restored, this resolves to the stock method).
4. Set `Main.overview._swipeTracker.enabled = false` (a public GObject property) and
   restore its previous value on disable. Do not destroy the tracker.
5. Track open/closed state ourselves; do not rely on `Main.overview.visible`.
6. On disable: close and destroy the overlay, pop the modal grab, restore each saved
   value or delete the shadow (per step 1), re-add the original binding if removed,
   restore the swipe tracker, and verify no signal handlers remain.

### 8.3 Deliberate non-patches

- Do **not** replace `Main.overview` (impossible) and do **not** emit its
  `showing`/`hiding`/`shown`/`hidden` signals. Those signals drive the workspace
  animation, native search focus, dash, app grid, and shell D-Bus; emitting them
  without the native overview being shown would put modules into inconsistent states.
- Do **not** shadow the `visible` getter. Native modules keep seeing `false`.
- Do **not** hide `Main.layoutManager.overviewGroup` permanently; it is already hidden
  when the native overview is not shown. BMS's overview component therefore stays
  invisible.

**Known cosmetic differences** accepted in v1: the Activities button does not get its
"checked" pseudo-class, window-open animations are not suppressed, and shell D-Bus
`OverviewActive` reports false. None affect Spotlight's behavior. Revisit only if the
override tests show a real problem.

### 8.4 Edge cases

- **Fullscreen:** `Main.pushModal()` calls `global.compositor.disable_unredirect()`
  while the panel is open (and `popModal()` re-enables it), so the glass renders over
  fullscreen windows. The hot corner intentionally stays inert over fullscreen windows
  (stock behavior); Super still works.
- **Second Super while open:** the `overlay-key` handler calls our `toggle()`, which
  closes.
- **Super+Alt+Up/Down (`shift-overview-up`/`down`):** these bypass the public methods and
  drive the native state adjustment directly. With the native overview always hidden,
  `down` is a no-op and `up` reaches `Main.overview.show()`, which our wrapper turns into
  Spotlight. Harmless; they are left untouched in v1 to keep the patch set smaller.
- **Sticky Keys enabled:** Mutter's `overlay-key` handler returns early (stock behavior),
  so Super alone does nothing. The Activities button, hot corner, and Super+A still open
  Spotlight. No workaround is attempted in v1.
- **Session lock / user switch:** close on `session-mode-changed` (and on
  `screen-shield` lock if available), destroy the modal grab, and ignore keys while
  the session is not `user`.
- **Extension disabled while open:** `disable()` pops the modal and destroys the actor;
  the shell must not be left grabbed.
- **Shell error:** if any required method/field is missing at enable, log once and
  refuse to enable rather than half-patch the Overview.

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
- Top 4 app rows. Row icons use `app.get_icon()` on a reused `St.Icon` (`gicon`), not a
  new texture per keystroke.
- Enter: `app.activate()`. Ctrl+Enter: `app.open_new_window(-1)` when
  `can_open_new_window()` is true, otherwise activate.

### 9.3 Files (daemon)

- Match **basenames** (files and directories), case-insensitive, Unicode-lowercased.
- Two-stage: a cheap ASCII subsequence prefilter over precomputed lowercase names, then
  `nucleo-matcher` scoring only on candidates. Top-K by score, tie-break shorter name
  and shallower path.
- Return at most 12 candidates; the UI shows up to 6 under a "Files" header.
- Each result: absolute path, basename, kind (`file`/`dir`). The extension displays the
  parent path with `~` abbreviation.
- File icons are queried asynchronously for visible rows only, with a bounded cache
  (256 entries). No icon query for off-screen results.
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
  `~/.config/spotlight/config.toml`; no UI in v1.
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
  lock. Queries take a read lock (or clone an `Arc`) and never block the indexer for
  long.
- Cache at `$XDG_CACHE_HOME/spotlight/index-v1.bin`, mode 0600, directory 0700. Versioned
  header + a fingerprint of roots/excludes/flags; mismatch ignores the cache. No extra
  serialization crate: length-prefixed paths and kinds over `std::io`.
- Startup: load cache → serve immediately → full background scan → swap. After the scan,
  replay watcher events that arrived during it, so changes are not lost.
- Cache is written at most every 30 s while dirty and on clean shutdown. A stale cache is
  harmless because the startup scan corrects it.

### 10.3 Live updates

- `notify` recursive watcher on each root (stable `notify` 8.x, not the 9.0 release
  candidate).
- Events are debounced 500 ms and applied incrementally:
  - create/modify → add if it passes filters;
  - remove → remove the path and everything under it;
  - rename → remove the old subtree, add the new subtree by walking only that path.
- Excluded paths are filtered before touching the index.
- Watcher failure (for example inotify watch limit) sets `watcher: "unavailable"` and
  logs once. The index remains usable; a full reconcile is scheduled when the overlay is
  next opened if the last reconcile is older than 10 minutes, and `Reindex` always works.
- No periodic timer when idle.

### 10.4 Query limits

- Query length ≤ 128 UTF-8 bytes; longer input is truncated (or rejected; the extension
  trims anyway). `limit` clamped to 1..=50.
- One daemon query at a time per client is expected, but the interface is safe under
  concurrent calls (read lock per query).

## 11. D-Bus API

- Bus: session bus, name `io.github.alphabeast97.Spotlight`.
- Object: `/io/github/alphabeast97/Spotlight`.
- Interface: `io.github.alphabeast97.Spotlight`.
- JSON strings for payloads: easy to inspect with `gdbus`, easy in GJS, no variant
  gymnastics.

```xml
<node>
  <interface name="io.github.alphabeast97.Spotlight">
    <method name="Ping">
      <arg name="version" type="s" direction="out"/>
    </method>
    <method name="Query">
      <arg name="query" type="s" direction="in"/>
      <arg name="limit" type="u" direction="in"/>
      <arg name="results" type="s" direction="out"/>
    </method>
    <method name="Reindex"/>
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
  "watcher": "ok"
}
```

`state`: `starting` | `indexing` | `ready` | `degraded`.
`watcher`: `ok` | `unavailable`.
Status is also readable as the `Status` property. The signal is emitted on state changes
and at most twice per second during a scan.

**Errors and limits**

- Invalid args (query too long, limit out of range) → `org.freedesktop.DBus.Error.InvalidArgs`.
- `Reindex` while a rebuild is running is ignored (debounced); it returns immediately.
- The extension uses a 500 ms call timeout and drops late replies.
- A service file (`packaging/io.github.alphabeast97.Spotlight.service.in`) points at the
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

- Panel size while results are shown is fixed (≈ 720×420 max), so keystrokes do not
  resize the blur frame.
- The overlay, entry, rows, blur effect, and shader are created at enable and reused.
  Only clones are built on open and destroyed on close.
- While the open/close animation runs, clones are not rebuilt; the animation is 120 ms
  open / 80 ms close with `easeOutQuad`.
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
- Performance fallback is a milestone decision, not runtime magic: if the M0 spike or
  the release measurements miss the frame budget on the target hardware, `auto` defaults
  to frosted (or the shader constants get cheaper). We do not auto-switch mid-session,
  which would flicker and complicate state.
- Blur my Shell is optional: if BMS is installed and the user wants it, the panel can
  carry `bms-popup-blur-target`; when BMS adds `bms-popup-blurred`, skip our own blur.
  This is a compatibility path, not a dependency, and it is off by default in v1 so the
  two blurs cannot fight.

## 13. UI and interaction

- One panel on the monitor under the pointer at open time. Multi-monitor: close and
  reposition on `monitors-changed`; never show one panel per monitor.
- Width: `clamp(560, 0.55 × monitor width, 720)` logical px.
  Top: 18% of monitor height, clamped so the panel and its shadow fit below the top bar.
- Layout:
  - 60 px entry with a search icon, 20 px text, placeholder "Spotlight Search".
  - fixed results viewport while non-empty: up to 6 rows (52 px each), scrolling for
    more; section headers "Applications" and "Files" (11 px, muted, uppercase).
  - 32 px footer: keyboard hints on the left; index status on the right only while
    indexing/degraded.
  - empty state: a short hint and keyboard hints, 120 px tall.
- Rows: 28 px icon, title (15 px), subtitle (12 px, muted; app generic name or file
  parent path). Reused actors; no list rebuild.
- Selected row: translucent fill, 10 px radius; hover selects.
- Light/dark follows `St.Settings.get().color_scheme`; the tint and text colors switch
  together. The blur is dark-tinted by default for legibility over any wallpaper.
- Fonts inherit the GNOME interface font. No custom font dependency.
- Accessibility v1: entry accessible-name, per-row accessible-name, full keyboard
  navigation, visible focus/selection, high-contrast-safe border. Full Orca
  announcement of selection changes is a follow-up; the design does not claim it.
- Animation: opacity + 0.98→1 scale on open (120 ms), reverse on close (80 ms). Focus
  is grabbed immediately, not after the animation.

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
| Closed idle | 0% CPU, no timers, no per-frame callbacks |
| Daemon idle | 0% CPU; inotify thread blocked; wakeups < 5/s |
| Extension extra JS heap | ≤ 25 MB |
| Daemon RSS at 250k | ≤ 120 MB |
| Index rebuild 250k on SSD | ≤ 10 s; cache load ≤ 300 ms |
| First query after activation | ≤ 300 ms including process start |

### 14.2 Rules

- Apps in the shell; files/calc in Rust. No file I/O in GJS.
- One in-flight D-Bus query, 40 ms debounce, stale replies dropped.
- Precompute lowercase app names once; precompute lowercase file basenames once.
- Reuse rows and icons; update text/gicon in place.
- Fixed panel size while typing; only empty↔results resizes.
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
  `SPOTLIGHT_PERF=1`) registers one `BEFORE_REDRAW` callback, records frame intervals
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
| inotify watch limit | Status `degraded`, `watcher: "unavailable"`; manual `Reindex`; open-time reconcile if stale > 10 min. |
| Home on slow/network FS | Caps and excludes still apply; scan is background; UI remains app-only until ready. |
| Shader/clone failure | Auto-fallback to frosted; log once. |
| Stale file path | Row removed on activation failure; debounced reindex requested. |
| Shell version mismatch | Extension declares 51 only; enable aborts with a clear log if required APIs are absent. |
| Extension disabled while open | Grab popped, actors destroyed, Overview restored. |

## 16. Security and privacy

- The daemon is session-bus only and same-user; it exposes filenames (paths), never file
  contents. It opens nothing and executes nothing.
- Cache and config are user-only (0700 directory, 0600 cache). Queries and paths are not
  logged in normal operation; debug logging is opt-in.
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
├── .github/workflows/
│   ├── ci.yml                       required fast checks
│   ├── shell-smoke.yml              GNOME 51 headless harness (main + nightly)
│   └── release.yml                  tag artifacts
├── docs/
│   ├── research/phase-0-findings.md
│   ├── superpowers/specs/2026-11-11-spotlight-design.md
│   ├── perf/                        committed measurements and notes
│   └── superpowers/plans/           implementation plan (after approval)
├── extension/
│   ├── metadata.json                uuid, name, shell-version ["51"], schema
│   ├── extension.js                 lifecycle, enable/disable, test hooks
│   ├── stylesheet.css               panel/row/entry styles
│   ├── prefs.js                     (not in v1; no prefs window)
│   ├── src/
│   │   ├── overlay.js               actor tree, focus, keyboard, modal, animation
│   │   ├── glass.js                 backdrop clones, blur, shader, fallback
│   │   ├── overview.js              wrappers, keybindings, gestures, restore
│   │   ├── apps.js                  Shell.AppSystem snapshot + scoring
│   │   ├── files.js                 file result icons/actions
│   │   ├── daemon.js                D-Bus proxy, status, query sequencing
│   │   ├── results.js               merge, selection, row binding
│   │   └── lib/                     pure JS: scoring, merge, format (GJS-testable)
│   ├── schemas/org.gnome.shell.extensions.spotlight.gschema.xml
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
│   └── io.github.alphabeast97.Spotlight.service.in
└── tools/
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

- Start `spotlightd` in a temp XDG environment with a fixture tree under
  `dbus-run-session`, call `Ping`/`Query`/`Reindex` over a real session bus, assert
  results, status transitions, and that a second instance exits cleanly.
- Test D-Bus argument validation and JSON shape.

**GJS unit tests (no shell imports)**

- `gjs -m tests/unit/all.js` with a tiny assert harness (no npm test framework).
- Cover app scoring, merge order/selection stability, path abbreviation, calc-row
  heuristics mirroring the daemon, and key handling state.
- ESLint (flat config) enforces GNOME-style 4 spaces, single quotes, semicolons, no
  unused vars; `no-undef` with GJS globals.

**Headless shell smoke test (GNOME 51)**

- `tools/test/run-shell-test.sh` packs the extension, then runs
  `dbus-run-session -- gnome-shell-test-tool --headless --extension <zip>
  tools/test/headless.js`.
- The automation script asserts:
  - the extension enables without exceptions;
  - `Main.overview.toggle()` opens the overlay, and again closes it;
  - `Main.overview.show()` / `hide()` / `showApps()` / `focusSearch()` route to it;
  - querying "term" yields Terminal in the results (app path);
  - Escape closes; query clears on close;
  - disabling the extension restores `Main.overview` methods and leaves no modal grab;
  - re-enabling works.
- File/calc end-to-end variant: the test wrapper sets `SPOTLIGHT_DAEMON` and
  `SPOTLIGHT_CONFIG` so the extension spawns the built daemon against a fixture root;
  the script asserts a file result and a calculator result. This is the only test that
  exercises the whole path.
- `gnome-shell-test-tool` creates a scratch XDG home and uses `GSETTINGS_BACKEND=keyfile`,
  so it cannot touch the developer's settings. It needs a private session bus; the
  wrapper provides `dbus-run-session`.

**Manual release checks**

- Real session on GNOME 51.1 / Intel i915: warm open, typing, 60 fps frame meter,
  light/dark, 100%/200% scaling, two monitors, fullscreen app, BMS on/off, disable/enable,
  logout/login.
- Fresh user install and uninstall.

### 18.2 CI

Fast job (every push/PR, required):

- Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- GJS lint + pure tests (`gjs` installed).
- Extension pack (`gnome-extensions pack`) + metadata/schema sanity (UUID, shell 51,
  schema id).
- D-Bus integration tests under `dbus-run-session`.

Container job (main + nightly, required on main):

- `archlinux` container with GNOME Shell 51, GJS, Mesa (llvmpipe), D-Bus, Python. The
  image digest is **pinned** to a GNOME 51 build and treated as part of the test matrix;
  moving it to GNOME 52 is a deliberate version-support task, not an automatic bump.
- Build the extension zip and daemon, run the headless smoke test.
- Software rendering means this is a correctness gate, not a frame-rate gate.

Risk: the headless harness needs EGL/GBM; on a GPU-less runner it must run on llvmpipe
(Mesa surfaceless). If that proves impossible in the container, fall back to
`xvfb-run` + a nested X11 shell for the smoke test. This is resolved during M1; it does
not change the product design. The local harness is already proven on this machine.

Release job (tag `v*`):

- Build `spotlightd` (x86_64-unknown-linux-gnu) and the extension zip.
- Publish `install.sh`, artifacts, and `SHA256SUMS` on the GitHub release.
- No push or tag until the user has verified the final local build.

### 18.3 Local commands

```
make build        # daemon release + extension zip
make test         # rust tests, GJS unit tests, lint
make test-shell   # headless GNOME Shell smoke (dbus-run-session)
make install      # binary + D-Bus service file + extension + enable
make uninstall    # disable + remove; keep user config/cache unless PURGE=1
make fmt / lint
```

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `refactor:`,
`chore:`. One coherent change per commit.

## 19. Packaging and install

- `make install` (no root):
  1. `cargo build --release --manifest-path daemon/Cargo.toml`.
  2. Install `spotlightd` to `~/.local/bin/`.
  3. Generate the D-Bus service file with the absolute binary path into
     `~/.local/share/dbus-1/services/`.
  4. `gnome-extensions pack extension/ -o dist/` and
     `gnome-extensions install --force dist/<uuid>.zip`.
  5. `gnome-extensions enable <uuid>` (with a logout/login note on Wayland if the shell
     has not seen the extension yet).
- Upgrades: rerun `make install`; the daemon is replaced, the extension reinstalled, and
  the shell reloads it on disable/enable or next login. D-Bus activation restarts the
  daemon on the next call.
- Uninstall: disable + uninstall the extension, remove the binary and service file;
  keep config/cache unless `PURGE=1`.
- Distribution limits: an EGO zip cannot install `spotlightd`. V1 documents the script.
  AUR and Flatpak (`--talk-name` for the daemon bus name) are future release work.

## 20. Milestones

Each milestone ends with a working, testable state and conventional commits. Tests listed
are added in that milestone, not retrofitted.

### M0 — Glass and takeover spike (throwaway, 1–2 days)

- Minimal extension: centered panel, super key opens/closes it, one window backdrop
  clone + `Shell.BlurEffect` + rounded shader.
- Verify on the real session: clone correctness (window, video, fullscreen), visual
  look, frame interval via the debug frame meter, unredirect behavior, BMS enabled.
- Verify the Overview hooks: `overlay-key`, `toggle-overview`, Activities, hot corner,
  `showApps`, gestures, disable restore.
- Record measurements and decisions in `docs/perf/` and
  `docs/research/glass-spike.md`; delete the spike code.
- **Exit:** liquid glass is visually acceptable and within budget, or the measured
  reasons it is not; the hook list in §8 is confirmed or corrected.

### M1 — Extension foundation

- Repo scaffolding, lint, unit-test harness, extension packaging, headless smoke runner.
- Overview wrappers + keybinding/gesture handling + restore tests.
- Overlay actor, entry, keyboard navigation, empty state, modal/focus/click-outside.
- App search, rows, activation, multi-monitor placement.
- **Exit:** Super/Activities/hot corner open Spotlight; Esc closes; disable restores the
  stock Overview; `make test` and `make test-shell` pass.

### M2 — Daemon and search

- Rust crate: config, walker, cache, index snapshots, watcher, query, calc.
- D-Bus interface, service file, activation, status signals.
- Extension daemon proxy, debounce, sequencing, footer status, error state.
- File rows (icons, open, reveal), calc row (copy), merge/selection.
- **Exit:** file and calculator results work end-to-end; 250k benchmark within budget;
  Rust integration + headless end-to-end tests pass.

### M3 — Glass integration

- `glass.js`: bounded clones, blur, shader, tint/rim/lens, fallback modes, cleanup.
- Open/close animation, fixed results height, event-driven backdrop updates.
- Real-session frame measurements; tune or choose frosted default.
- **Exit:** P95 frame interval ≤ 16.7 ms on the target machine (or documented fallback);
  no leaks across 20 open/close cycles; BMS on/off both look correct.

### M4 — Polish and packaging

- Light/dark theming, high-contrast check, a11y labels, path abbreviations, icons.
- Install/uninstall script, README, `THIRD_PARTY_NOTICES`, LICENSE.
- Release artifacts and checksums.
- **Exit:** clean install on a fresh user works; uninstall leaves no extension, binary,
  service file, or active keybinding.

### M5 — Verification and handover

- Full CI green; manual matrix from §18.1; fix findings.
- User verifies the local build and approves.
- Only then: create the GitHub repository, push, and tag the release.

## 21. Feasibility risks (ranked)

1. **Overview takeover is private API and can change in any shell update.** Mitigation:
   GNOME 51 only, narrow wrappers, feature checks, headless regression tests, documented
   hook list, exact restore. This is the main reason for a 51-only v1.
2. **Super routing edge cases** (`overlay-key` vs `toggle-overview`, sticky keys, second
   press, touchpad gesture). Mitigation: M0/M1 tests for each entry point; disable the
   swipe tracker; keep native `visible` false and do not emit native signals.
3. **Glass performance/quality varies by GPU and window type.** Mitigation: bounded
   frame, surface clones, event-driven updates, frame meter, frosted fallback selected
   at the milestone gate, BMS compatibility tested.
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
10. **Scope creep.** Requests for the window picker/app grid/recents are out of scope by
    design; the anti-goals in §4 are the line.

## 22. What is left to the builder

The implementation plan decides: exact test file names, function signatures, cache byte
layout, D-Bus helper structure, row widget internals, shader source layout, and commit
splitting. Exact glass colors, blur radius, and lens strength are tuned in M0 against the
real screen; starting values are listed in §12. No product behavior is left open.

## 23. Approval checklist

- [ ] Scope: Spotlight-only; Activities and hot corner route to it.
- [ ] Architecture: GJS UI/glass + Rust daemon over D-Bus.
- [ ] Glass: bounded liquid glass with frosted fallback; BMS optional only.
- [ ] GNOME 51 only, GPL-3.0-or-later.
- [ ] Name/UUID/bus name (or rename now).
- [ ] File index defaults (`$HOME`, hidden skipped, excludes, 250k cap).
- [ ] No prefs window, no recents, no live currency, query clears on close.
- [ ] Milestones and CI strategy.
