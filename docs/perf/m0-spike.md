# M0 glass and takeover spike

Throwaway spike (`spike/`) proving the glass render path, frame metering, and the
Overview takeover before Sift's real overlay exists. Deleted in Task 2; only the
findings below survive.

## Host

- GNOME Shell 51.1, Wayland, `prefer-dark`.
- Intel WhiskeyLake-UHD Graphics 620 (WHL GT2), i915, Mesa 26.2.6, kernel 7.2.15-zen1.
- Displays: eDP-1 1920×1080 @ 1.25, HDMI-2 1920×1080 @ 1.
- Blur my Shell v78 active, Isle active, plus the user's usual extensions.
- Shell's `toggle-overview` binding is empty; Super reaches the shell as
  `overlay-key` → `Main.overview.toggle()`.

## Headless results

Method: `gnome-shell-test-tool --headless` at 1280×720 on the i915 render node
(`/dev/dri/renderD128`, gbm + high-priority EGL; not llvmpipe). The harness starts
with the native Overview visible; the fixed takeover closes it at enable. The
script draws a high-contrast test backdrop (6 colour bands + 3 px grid) under the
spike and opens each rect across ten cycles. The frame meter runs only while the
panel is open; `search` is 720×420, `grid` is 1040×70% of the monitor. Numbers
from the last run (ms between `BEFORE_REDRAW` ticks):

| rect | frames | p50 | p95 | max |
|---|---|---|---|---|
| search 720×420 | 37 | 16.67 | 16.75 | 21.78 |
| grid 1040×504 | 26 | 16.68 | 16.85 | 26.70 |

p50 16.67 ms = 60 Hz. This is a real GPU path, but the offscreen output is
1280×720 at scale 1, smaller than the 1920×1080 @ 1.25 session.

Visual checks, from screenshots of the same run:

- The `Clutter.ShaderEffect` (`vfunc_get_static_snippet` + `Cogl.Snippet`)
  compiles; forcing `tintAmount 0.8` with a red tint turns the panel red, so the
  fragment code really runs, and the rounded mask follows the panel corners.
- Backdrop clone stays aligned with the screen: the test bands continue across
  the glass, and the 40 px blur radius fully smooths the 3 px grid, as intended
  for frosted/liquid glass.
- The 40 px backdrop margin is clipped to the panel (`clip_to_allocation`), so
  the blur does not paint a rectangular halo outside the rounded panel.
- No GL/shader warnings and no `clutter_actor_allocate` NaN warnings after the
  fixes below.

## Takeover

The first live login with the orientation fix still had the old takeover
wrapper. The restored session started with the native Overview already up; the
wrapper's `hide()` only closed Sift's panel, so Escape could not dismiss the
stock Overview and the session was stuck. Recovery was moving the extension out
of the extensions directory.

Fix: on enable, close a pre-existing native Overview through the saved original
`hide`; every wrapper that opens Sift closes it first; `hide()` closes Sift and
then the native Overview if it is still visible. Disable does the same before
restoring.

Headless regression `spike takeover ok` covers: hide closes a natively shown
overview; enable closes an overview shown before enable; toggle and show replace
the native overview; disable leaves nothing visible. The pre-fix baseline logged
`overview=true`; the fixed baseline logs `overview=false`.

## Spike findings

- `St.BoxLayout` in Shell 51 has no `vertical` property; use
  `orientation: Clutter.Orientation.VERTICAL`.
- Installing a changed extension over a running shell keeps the already-imported
  module; re-enabling still runs the old code. Install before login (or restart)
  when the code changed. This caused the first live `vertical` error.
- Cloning `Main.layoutManager._backgroundGroup` while it is unmapped yields NaN
  positions and allocation warnings; skip the clone unless its transformed
  position is finite.
- Open must rebuild clones after `show()`; clones are skipped while hidden.
- `clip_to_allocation` on the panel plus a 40 px frame margin gives the blur
  real backdrop pixels at the panel edge without an outside halo.

## Not measured before removal

The spike is removed in Task 2, so these carry into M1's real overlay instead of
being collected here:

- search/grid p50/p95/max at 1080p @ 1.25 with BMS enabled and disabled.
- the same over a window, video, and a fullscreen app; clone correctness and lag
  when a window moves or restacks.
- open, typing, and close frame intervals (headless covers only steady open
  state).
- Super, Activities, hot corner, `showApps()`, Super+A, second Super, and
  disable restore behavior in the real session.
- 100% and 200% scaling, and the second monitor.
- starting blur radius, tint, saturation, lens, and rim values.

## Unit tests

`gjs -m extension/tests/unit/all.js` → `ok stats`. The 0.95 percentile is
compared with the float-tolerant `almost` helper because the linear
interpolation produces 3.8499999999999996.
