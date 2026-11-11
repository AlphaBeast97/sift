# Phase 0 research findings

Date: 2026-11-10
Host: Arch Linux, GNOME Shell 51.1, Rust 1.99.1
Method: read the installed shell's source (GNOME Shell 51.1 tag), read the installed
Blur my Shell 77 source, and read the source of Isle, Search Beam and VLIQ. No
implementation decisions are made here.

Update 2026-11-11: the design is in `docs/superpowers/specs/2026-11-11-sift-design.md`.
The extension is named **Sift** (plain "Spotlight" is already taken on
extensions.gnome.org); the open decisions below are resolved there.

## 1. What a GNOME Shell extension can be

- GNOME 45+ loads extensions as ES modules. `extension.js` default-exports a class
  derived from `Extension` (`resource:///org/gnome/shell/extensions/extension.js`).
  `enable()` / `disable()` own all resources; `disable()` must undo every patch,
  signal, timeout, actor and D-Bus proxy.
- An extension is plain GJS in the `gnome-shell` process. It can import GObject
  Introspection libraries (`gi://Clutter`, `gi://St`, `gi://Meta`, `gi://Shell`,
  `gi://Gio`, ...), but it cannot load a Rust `cdylib`, a Node native addon, or
  arbitrary native code. There is no supported FFI/native-module entry point.
  A custom GObject library would have to be in the shell's GI typelib path before
  `gnome-shell` starts, which an extension cannot arrange for the running process.
- Consequence: the visible UI (actors, focus, modal grab, key handling, Clutter
  effects, GLSL) must be GJS. A Rust process can only cooperate over IPC.
- `metadata.json` declares `uuid`, `name`, `shell-version` (e.g. `["51"]`),
  `settings-schema`, `session-modes`. `gnome-extensions pack` and
  `gnome-extensions install` handle the bundle. A schema is compiled with
  `glib-compile-schemas` at install time.

## 2. Replacing the Overview

There is no public "replace the overview" API. The shell owns it as a singleton:

- `js/ui/main.js`: `export let overview = null;` then `overview = new Overview()`.
  The exported binding is read-only to importers, so an extension cannot replace
  the object; it can override instance methods.
- `js/ui/overview.js`: `Overview.init()` calls
  `Main.wm.addKeybinding('toggle-overview', ..., this.toggle.bind(this))`.
  The handler captures the original bound method, so patching
  `Main.overview.toggle` later does not change that keybinding.
  `Main.wm.removeKeybinding('toggle-overview')` exists and can remove it; a new
  binding can then be added with the same name.
- `js/ui/overviewControls.js`: connects `global.display`'s `overlay-key` signal
  and calls `Main.overview.toggle()` dynamically.
- `js/ui/panel.js`: the Activities button calls `Main.overview.toggle()` dynamically.
- `js/ui/layout.js`: the hot corner calls `Main.overview.toggle()` dynamically.
- `js/ui/shellDBus.js`, `appMenu.js`, `appDisplay.js`, `search.js` and others call
  `Main.overview.show()/hide()/toggle()` dynamically.
- Touchpad gestures go through `Overview`'s own `SwipeTracker` and
  `_gestureBegin/_gestureUpdate/_gestureEnd`, which bypass public `show()`.
  They must be disabled or explicitly rebound if the shell overview is replaced.

So the viable hook is: remove/rebind `toggle-overview`, override the instance
methods `show`/`hide`/`toggle` (and possibly `focusSearch`, `showApps`) with
restorable wrappers, and stop the gesture path. `Main.layoutManager.overviewGroup`
and the shell's `OverviewActor` remain in the tree unless hidden; a custom actor
can be placed elsewhere (e.g. `Main.uiGroup`) with `Main.pushModal()`.

A less invasive alternative, used by Search Beam, keeps GNOME's own overview and
search alive and re-parents `Main.overview.searchEntry` + `searchController` into a
custom popup. That is a Spotlight-style popup, not an Overview replacement, and
it does not take over the Super key by itself.

Risks: this is monkey-patching private shell internals. Every shell release can
change it. All patches must be narrowly scoped, guarded with feature checks, and
restored exactly in `disable()`.

## 3. Apps, files, search providers

- Apps are already in the shell: `Shell.AppSystem` and `Shell.App` expose installed
  apps, icons, names, actions and the correct activation path. Launching an app
  through `Shell.App.activate()` / `open_new_window()` preserves shell behavior
  (workspaces, startup notification, focus). Re-indexing apps in Rust would
  duplicate platform logic and add staleness.
- GNOME's built-in search UI is not a file index. File results normally come from
  a remote search provider (for example Nautilus) over the
  `org.gnome.Shell.SearchProvider2` D-Bus interface.
- If the custom UI keeps GNOME's search machinery, implementing a Rust
  `SearchProvider2` would plug files/calculator into it. If the custom UI owns
  the result list (the likely Spotlight design), the Rust daemon can expose its
  own small D-Bus API and the extension merges results itself.
- Either way, a Rust file index/calculator is justified: the shell process must
  stay responsive, indexing is CPU/IO heavy, and Rust gives us inotify, fuzzy
  matching and a testable pure library outside GJS.

## 4. Blur, glass and GNOME 51

- `Shell.BlurEffect` is exported in the GNOME 51 typelib:
  `Shell.BlurEffect`, `Shell.BlurMode.ACTOR`, `Shell.BlurMode.BACKGROUND`.
  It is a Clutter effect that downscales, blurs and optionally adjusts brightness.
- GNOME 51 removed `Shell.GLSLEffect`. Custom shaders now use
  `Clutter.ShaderEffect` with `vfunc_get_static_snippet()` returning a
  `Cogl.Snippet(Cogl.SnippetHook.FRAGMENT, declarations, code)`. Isle's
  `gnome-extension/src/shader.js` already carries this compatibility split
  (`Shell.GLSLEffect` up to GNOME 50, `Clutter.ShaderEffect` from 51).
- Isle's glass (`gnome-extension/src/glass.js`) is the strongest reference:
  - copies the wallpaper, the windows under the island, and the top bar into a
    clipped frame with `Clutter.Clone`/`Clutter.Clone` subclasses;
  - applies `Shell.BlurEffect` in `ACTOR` mode to that frame;
  - applies a custom shader that cuts the frame to the island's shape and adds
    tint, saturation, a sheen, an inner glow and an edge lens/rim;
  - redraws only the bounded region, follows window restacking event-driven,
    and tears every clone down on hide/destroy.
  - It deliberately copies `Main.panel` (not `panelBox`) and window surfaces
    (not the whole window actor) to avoid double-drawing Blur my Shell blur and
    the resulting flicker.
- Isle is a Rust workspace + GJS extension, but its blur runs entirely in GJS.
  Its Rust daemon does state/media/timers over D-Bus. This is the same split a
  Spotlight replacement needs.
- A Rust process cannot draw the live blur: it cannot add actors to the shell's
  Clutter scene, cannot join the shell's compositor frame, and a separate
  fullscreen window would be a normal application window (Mutter does not expose
  wlr-layer-shell), not an overview replacement.

## 5. Blur my Shell compatibility

Blur my Shell 77 (GPL-3.0-or-later) uses its own dual-Kawase GLSL pipeline, not
`Shell.BlurEffect`. It exposes a documented opt-in integration that does not
require its private internals:

- Add the CSS class `bms-popup-blur-target` to a surface; BMS inserts a blur
  actor behind it, follows its `border-radius`, and adds
  `bms-popup-blurred` to the surface so the extension can skip its own blur.
- BMS tracks `Main.uiGroup` children recursively, so a top-level Spotlight actor
  in `Main.uiGroup` is discoverable; an opt-in actor is blurred in place.
- BMS also exposes `global.blur_my_shell` with `_pipelines_manager` /
  `_effects_manager`, but those are private and should only be a last-resort
  optional integration, feature-detected and version-guarded.
- BMS's overview component adds a background group inside
  `Main.layoutManager.overviewGroup` and patches workspace-switch methods. If the
  Spotlight UI does not use that group, there is no conflict and no blur from BMS
  behind the Spotlight panel; if it does, the shell overview actor would also
  become visible unless separately hidden.

Compatibility plan: own glass by default, plus an optional documented BMS opt-in
path (add the class, skip our blur when `bms-popup-blurred` appears). Never
require BMS.

## 6. Performance constraints and what can be measured

Target: open in one frame, no input lag, 60 fps while open, no idle cost.

Design rules taken from the source and prior art:

- Blur only the panel's bounded area, never a fullscreen framebuffer. VLIQ's
  performance notes explicitly keep capture margins bounded and avoid fullscreen
  FBOs; Isle pads its blur frame by only the blur radius.
- Cache or freeze the backdrop while the panel is static; update clones on
  restack/allocation signals, not on a polling timer. Do not run a JS loop per
  frame for layout or search.
- Pre-create the overlay actor, entry, result rows and effect at `enable()`;
  `show()` should only set text/focus/visibility and start a compositor
  transition. Constructing the UI on first Super press causes a visible stall.
- Keep apps local in the shell (instant first results). File/calculator results
  arrive from the Rust daemon over D-Bus; debounce and cancel stale queries, and
  never block the UI thread.
- Reuse result-row actors and icon textures; update labels in place. Avoid
  rebuilding the list on every keystroke.
- Disable unredirect while a fullscreen window is behind the panel
  (`global.compositor.disable_unredirect()`), otherwise the panel can be skipped
  by direct scanout. Pair enable/disable exactly.
- Measure frame intervals in a real session, not only in CI. The shell's
  `gnome-shell-test-tool` can run a headless virtual monitor with an automation
  script and custom metrics; software rendering (llvmpipe) makes absolute FPS
  meaningless, so CI should gate functional behavior and Rust latency, not GPU
  frame rate.

Local proof that the headless harness works on this machine:

```sh
dbus-run-session -- gnome-shell-test-tool --headless \
  --extension /tmp/.../harness-test@example.com.shell-extension.zip \
  /tmp/.../script.js
# -> GNOME Shell starts, extension enables, script opens/closes the overview,
#    prints "HARNESS OK", exits 0, reports the custom openMs metric.
```

`gnome-shell-test-tool` installs the bundle into a scratch XDG home, uses
`GSETTINGS_BACKEND=keyfile`, starts `gnome-shell --headless --virtual-monitor
1280x720`, and tears the session down. It needs a private session bus
(`dbus-run-session`) when a desktop session is already running.

## 7. Prior art worth learning from

- **Isle** (Rust + GJS, GPL-3.0-or-later): daemon split, glass backdrop, GNOME
  46-51 compatibility helpers, install/service scripts, headless-friendly tests.
  Its `glass.js` is the closest match to the requested liquid-glass look.
- **Search Beam** (GJS, GPL-2.0-or-later): Spotlight popup that borrows GNOME's
  search entry/controller, overrides `Main.overview.toggle/hide`, handles modal
  focus, Escape, click-outside, multi-monitor and result activation. Useful for
  the popup lifecycle; not an Overview replacement.
- **VLIQ** (GJS, MIT): liquid-glass renderer over wallpaper mirrors, bounded
  capture, cached/downscaled blur, event-driven updates, performance and
  regression notes. Useful for the rendering budget and pitfalls.
- **Search Light** (original Spotlight extension, referenced by Search Beam):
  the long-standing prior art for a centered search popup; Search Beam exists
  because Search Light stopped loading on GNOME 50.
- **Blur my Shell** (GJS, GPL-3.0-or-later): documented opt-in blur class and
  its own optimized blur pipeline. A compatibility target, not a dependency.

Licensing note: Isle and BMS are GPL-3.0-or-later; Search Beam is GPL-2.0-or-later;
VLIQ is MIT. Reusing code from any of them imposes that license. Independent
implementation of the same techniques is possible, but the project license must
be chosen before code is copied.

## 8. Decisions carried into the design (resolved 2026-11-11)

1. Scope: full Overview replacement with a search view and an app grid; no window or
   workspace picker.
2. Blur: own bounded liquid glass with frosted/off fallback; BMS optional.
3. Shell range: GNOME 51 only.
4. License: GPL-3.0-or-later.
5. File index: filenames/directories under `$HOME`, hidden skipped, excludes, 250k cap.
6. Name/UUID: Sift, `sift@alphabeast97.github.io`, `io.github.alphabeast97.Sift`.

See `docs/superpowers/specs/2026-11-11-sift-design.md`.

## 9. App grid and prefs components (GNOME 51 source, 2026-11-11)

- GNOME 51 exports `IconGrid.IconGrid`, `IconGrid.BaseIcon`,
  `AppDisplay.AppIcon`, and `PageIndicators.PageIndicators`. `AppDisplay` and
  `BaseAppView` are not exported and carry Overview/folder/DND/page-persistence state;
  do not reuse them for Sift.
- `IconGrid` provides pages, `addItem`/`appendItem`/`removeItem`, `goToPage`/
  `currentPage`, `getItemsAtPage`, and `pages-changed`. Items need an `.icon` that is an
  `IconGrid.BaseIcon`. Layout properties include `fixed-icon-size`, `columns-per-page`,
  `rows-per-page`, and `page-padding`.
- `AppIcon(app, {isDraggable: false})` creates a `BaseIcon` with
  `app.create_icon_texture(size)` and activates through `Shell.App`. Its `activate()`
  calls `Main.overview.hide()`, which the Sift wrapper maps to closing the overlay.
  `isDraggable: false` avoids the only paths that call `Main.overview` drag methods.
  Right-click is not in its button mask; the `AppMenu` is created only if `popupMenu()`
  is called, so the grid needs no context menus.
- `PageIndicators` has `setNPages`/`setCurrentPosition` and a `page-activated` signal;
  GNOME's app display uses it with clickable dots.
- `OverviewControls.ControlsState` is exported (`HIDDEN = 0`, `WINDOW_PICKER = 1`,
  `APP_GRID = 2`). `_toggleAppsPage()` calls `Main.overview.show(APP_GRID)` whenever
  `Main.overview.visible` is false, so the stock Super+A binding reaches the Sift
  wrapper without adding a keybinding.
- `prefs.js` uses `ExtensionPreferences.fillPreferencesWindow(window)` with
  `Adw.PreferencesWindow`/`Page`/`Group`, `Adw.SwitchRow`/`ComboRow`, and `Gtk.Scale`.
  `getSettings()` reads the schema named by `metadata.json`'s `settings-schema`; prefs
  runs in its own process and needs no shell imports.
