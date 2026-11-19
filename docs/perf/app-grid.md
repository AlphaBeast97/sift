# App-grid load performance

Measurements from a headless GNOME Shell 51 session at 1280x720 with 91
installed apps. Times are wall-clock from the main loop, so they include the
work that blocks a frame.

## Baseline

| Path | Cost |
| --- | --- |
| App snapshot (`gridApps()`) | 3.4ms |
| Cold open, first paint | 17.3ms |
| Cold open, all 91 tiles | 398ms |
| Cold tile chunks | 4x, 205ms total, worst 88.6ms |
| Cold layout | 10 calls, 22.5ms |
| Hidden prewarm | 134ms |
| First warm open | 25.5ms layout + 24.8ms repage |
| Second warm open | 5.2ms layout, no repage |

The hidden prewarm could not lay out because the grid's page size was still
zero. The first open therefore repaged every tile in the middle of the opening
animation, and each cold chunk added up to 89ms to a frame.

## Changes

- The overlay sizes the hidden grid to its target rectangle before prewarming,
  so the icon grid learns its real page size and capacity while hidden.
- The hidden capacity estimate uses the configured icon size plus the label
  height; the icon texture has no preferred size before the first allocation.
  The next layout after allocation replaces the estimate with the real tile
  size.
- Tile chunks shrink from 30 to 4. The cold fill takes slightly longer to
  finish, but no single frame carries a large chunk.

## After

| Path | Cost |
| --- | --- |
| App snapshot | 5.3ms |
| Cold open, first paint | 30.0ms |
| Cold open, all 91 tiles | 536ms |
| Cold tile chunks | 23x, 219ms total, worst 21.5ms |
| Cold layout | 42 calls, 24.6ms |
| Hidden prewarm | 179ms |
| First warm open | 0.4ms layout, no repage |
| Second warm open | 0.6ms layout, no repage |

Frame timing during the first warm open: median 16.7ms, p95 40.7ms. The
remaining long frame is the first allocation of all 91 `AppDisplay.AppIcon`
tiles (theme nodes, labels, icons). It is a one-time cost per session; the
second open stays at the frame clock.

The cold path only matters during the first five seconds after the extension
starts, before the idle prewarm runs. It still fills the grid in about half a
second, but now in small steps instead of one 89ms stall.

## Reproduce

Run the smoke test's headless shell with a script that opens the grid through
`overlay.open('grid')` and measures:

- `api.apps.gridApps()` for the snapshot;
- `overlay.visible` and `overlay.view` for the first paint;
- `_addChunk`, `_layout`, and `_repage` calls for the build;
- `Meta.LaterType.BEFORE_REDRAW` laters for frame intervals.

Use `_prewarmGrid()` between opens to rebuild while hidden. The numbers above
come from that harness; it is intentionally not part of the extension.
