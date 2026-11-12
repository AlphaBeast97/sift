# M0 glass and Overview findings

What the M0 spike proved, and what Tasks 21–23 should build on. Numbers and the
live-session caveat are in `docs/perf/m0-spike.md`.

## Overview hooks

Confirmed against GNOME Shell 51.1 and the spike:

- Shadow these on the `Main.overview` **instance**: `show`, `hide`, `toggle`,
  `focusSearch`, `showApps`, `shouldToggleByCornerOrButton`. Save
  `hasOwnProperty` plus the current value and restore exactly that on disable.
- `overlay-key` → `Main.overview.toggle()` (`overviewControls.js`). The shell's
  `toggle-overview` keybinding is empty on this host, so Super works through
  `overlay-key`; the remove/re-add branch is skipped. Keep that branch for users
  who bind the key.
- Activities and hot corner call `shouldToggleByCornerOrButton()` then
  `Main.overview.toggle()` (`panel.js`, `layout.js`).
- Super+A is `toggle-application-view` → `OverviewControls._toggleAppsPage()`:
  when `Main.overview.visible` is false it calls
  `Main.overview.show(ControlsState.APP_GRID)`. Since the takeover never makes
  the native `visible` getter true, Super+A reaches our wrapper.
- `show(state)` must map `ControlsState.APP_GRID` to the grid and everything else
  to search. `showApps()` and `focusSearch()` map directly.
- The native Overview can already be visible when the extension enables (a
  restored session), and another extension can show it later. Close it through
  the **saved original `hide`**: once at the end of install, before every wrapper
  that opens Sift, and again from `hide()` after closing Sift. A wrapper that only
  closes Sift leaves Escape unable to dismiss the stock Overview; the M0 spike
  trapped a live session this way.
- Set `Main.overview._swipeTracker.enabled = false` while installed and restore
  it on disable.
- Do not shadow `visible`; native modules must keep seeing `false`.

## Glass viability

Liquid glass is viable for both rects on this GPU. The fragment shader compiles
through `Clutter.ShaderEffect` + `Cogl.Snippet` (`vfunc_get_static_snippet`), the
rounded mask follows the panel shape, and the blurred backdrop stays aligned with
the screen. Headless p50 was 60 Hz for 720×420 and 1040×504; real 1080p/BMS
numbers are still open.

Starting constants (all are settings in Task 23; tune in the real overlay):

| value | start | note |
|---|---|---|
| panel corner radius | 18 px | shader mask + CSS radius |
| backdrop margin | 40 px | clipped by `clip_to_allocation` |
| blur radius | 40 px | `Shell.BlurEffect`, ACTOR mode |
| tint RGB | 0.06, 0.07, 0.09 | dark neutral |
| tint amount | 0.45 | `glass-opacity` |
| sheen | 0.05 | top-down, subtle |
| rim | 0.06 | inside the edge |
| rim width | 1 px | |

The backdrop lives in a frame that extends 40 px beyond the panel on every side.
Clones are positioned from that frame origin; the panel clips children to its
allocation, so the blur has real pixels at the edge without a halo, and the shader
rounds the composite. Apply the shader to the panel, the blur to the frame child.

Fallbacks: if the shader constructor fails, keep the CSS translucent panel;
`glass-mode` can force frosted (blur only) or off. The grid may stay frosted while
the search rect uses liquid glass; they are independent.

## Clone rules

- Background: clone `Main.layoutManager._backgroundGroup` only when its
  transformed position is finite. An unmapped group returns NaN and triggers
  `clutter_actor_allocate` warnings.
- Window: pick the topmost visible, non-minimized `Meta.WindowType.NORMAL` actor
  whose transformed bounds intersect the padded rect. Clone its first child whose
  GType name starts with `MetaSurface`; fall back to the actor when there is no
  surface child. This matches Isle's `surfaceOf` and avoids copying extension
  actors added to the window actor (Blur my Shell would otherwise be drawn twice).
- Rebuild clones after `show()`; they cannot be created while the panel is hidden.
- Coalesce `restacked` into one `Meta.LaterType.BEFORE_REDRAW` rebuild instead of
  rebuilding per signal.
- Not yet checked: video, fullscreen apps, surface replacement (X11 going
  fullscreen), and Blur my Shell coexistence. Keep the fallback path reachable.

## Frame meter

API: `extension/src/perf.js` exports `FrameMeter` (`start()`, `stop()`, `summary`
→ `{p50, p95, max, frames}` in ms); `tools/perf/frame-meter.js` re-exports it and
`percentile`. `start()` resets, `stop()` removes the later. The meter ticks on
`Meta.LaterType.BEFORE_REDRAW`, so a period with no redraws records fewer frames;
read `frames` together with wall time.

The spike logged on close as:

```text
spike search: frames=37 p50=16.67 p95=16.75 max=21.78
```

`gjs -m extension/tests/unit/all.js` checks the percentile math. Headless command
is in `docs/perf/m0-spike.md`.

## Open for M1

- Real 1080p @ 1.25 numbers with BMS on/off, over windows/video/fullscreen.
- Whether a second Super+A should close the grid (stock toggles the dash button
  when the native overview is visible; the takeover keeps `visible` false).
- Final radius/tint/sheen/rim values after seeing the photo wallpaper and real
  windows.
