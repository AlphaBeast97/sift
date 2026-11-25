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

Frame timing during the first warm open after the paint prewarm: median
16.7ms, p95 16.9ms, max 17.0ms. A build-only prewarm still spikes to
36.6-55.3ms on the first open, so building tiles is not enough; the first
paint is the cost.

## First-paint prewarm

The hidden grid is never allocated or painted, so its first real open still
builds theme nodes, icon textures and the glass shader. The prewarm now paints
one frame at `opacity = 1` while the overlay is hidden, then hides it again.
That moves the one-time first-paint cost out of the opening animation.

- The prewarm runs 100ms after enable, at low priority, so it does not compete
  with session startup.
- It finishes about 280-350ms after enable, including tile chunks.
- Opening before it finishes is still cold; the fix targets the normal case
  where the desktop is up before the user presses Super.
- The workspace cards are built during the same paint pass and kept until the
  view is opened once.
- The glass stays open until the first real close, so its clones and shader are
  not recreated on the first open. `close()` releases them afterwards.

The paint pass is invisible in practice (1/255 opacity for two frames), and the
overlay is not reactive during it.

The cold path only matters during the first five seconds after the extension
starts, before the idle prewarm runs. It still fills the grid in about half a
second, but now in small steps instead of one 89ms stall.

## Live updates

Installing, removing, or reordering apps used to mark the grid dirty, and the
next open destroyed and rebuilt every tile. A launch also marked it dirty even
though the tile set had not changed.

- `installed-changed` clears the app snapshot and refreshes the grid;
  `app-state-changed` only updates the running flag used by search ranking.
- The grid matches tiles to apps by id. It removes the tiles whose app is gone,
  creates tiles for new apps, and moves the rest to their new slots with
  `IconGrid.moveItem`. Existing `AppDisplay.AppIcon` actors are reused.
- A visible install or uninstall refreshes in place instead of waiting for the
  next open.

Measured on the open grid with 91 apps:

| Change | Cost |
| --- | --- |
| Remove one app | 1.4ms |
| Add one app | 6.0ms |
| Reverse all 91 (worst case) | 14.8ms |
| Rebuild all tiles (before) | 192ms in 23 chunks |

The first grid paint after the session starts is covered by the paint prewarm
above; it is no longer part of the first open.

## Reproduce

Run the smoke test's headless shell with a script that opens the grid through
`overlay.open('grid')` and measures:

- `api.apps.gridApps()` for the snapshot;
- `overlay.visible` and `overlay.view` for the first paint;
- `_addChunk`, `_layout`, and `_repage` calls for the build;
- `Meta.LaterType.BEFORE_REDRAW` laters for frame intervals.

Use `_prewarmGrid()` between opens to rebuild while hidden. The numbers above
come from that harness; it is intentionally not part of the extension.
