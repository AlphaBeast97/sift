# Sift — Isle-like Liquid Glass and Motion — Design

Date: 2026-11-17
Status: **Draft for approval.** No implementation starts until this document is approved.
Scope: the visible glass and motion of Sift on GNOME Shell 51. Search behavior,
shortcuts, the Rust daemon, and the app-grid feature set do not change.

---

## 1. Intent

Sift's glass currently works, but it does not look or move like Isle. It is darker
and flatter than Isle's glass, the backdrop is copied with plain clones that redraw
too much, and view changes scale the whole panel non-uniformly, stretching text and
icons. The compact search bar also jumps instantly to its expanded height on the
first keystroke.

The goal is to make Sift feel like Isle: a rich liquid-glass surface over an accurate,
bounded copy of the desktop; constant smoothness while open; and transitions that
grow, shrink, and fade rather than stretch. Glass becomes liquid-only. Its only user
control is **Brightness**, from dark smoked glass to clear bright glass.

Why: the user chose Isle's glass and motion as the reference and wants Sift to match
that quality. Every decision below serves either visual fidelity or the frame budget.

---

## 2. Goals, non-goals, anti-goals

### Goals

- One glass style: liquid. Remove Auto, Frosted, and Off from settings and UI.
- One glass control: **Brightness** (0 dark → 100 clear). No opacity, blur, or tint
  controls.
- A richer shader: Isle's tone band, saturation, chromatic edge lens, directional
  rim light, inner glow, and sheen, adapted to Sift's rounded rectangle.
- An accurate, bounded backdrop: windows stacked in their real order, dialogs
  included, following moves, restacks, and content changes.
- Clones cached and reused; repaints limited to the glass area; no clone rebuild
  during animation; no per-frame JS while idle.
- Isle-like motion: springs drive open, close, compact/expanded, and view changes;
  springs retarget mid-flight; content fades instead of stretching.
- Keep the existing behavior: shortcuts, overview takeover, focus, results, app grid,
  settings reset, and animations-off support.

### Non-goals

- No native code or Rust changes.
- No new preferences beyond Brightness (the existing Animations switch stays).
- No selectable glass modes, blur slider, tint slider, or opacity slider.
- No app-grid size presets or grid behavior changes.
- No shortcut or overview changes.
- No attempt to make the headless test suite measure frame rate.

### Anti-goals

- A prettier shader that drops frames.
- Rebuilding clones or walking windows every frame.
- Non-uniform scaling of text, icons, or the app grid.
- A brightness extreme that makes text unreadable on bright window content.

---

## 3. Constraints

- GNOME Shell 51.1, GJS, Clutter/Cogl. The visible UI stays inside the shell process;
  no native modules.
- On Shell 51 the shader is a `Clutter.ShaderEffect` with a Cogl fragment snippet
  (`Shell.GLSLEffect` is for 46–50 and is not used).
- Clutter enlarges an effect's offscreen texture by 3 px (2 px before the actor), so
  shader pixel coordinates need the same correction Isle uses.
- The glass must stay bounded to the panel plus padding. There is no fullscreen blur.
- `clip_to_allocation` on the shape actor clips the blurred frame after the blur has
  been rendered, so the padded blur still reads pixels outside the shape.
- GPL-3.0-or-later. Isle is also GPL-3.0-or-later; ported code keeps its license
  header and an attribution comment.
- There are no public users yet, so settings keys can be replaced without migration.

---

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A — chosen** | Port Isle's structure: shape actor with the mask/tone shader, padded child with the blur, `AreaClone` paint volumes, cached clones, coalesced sync, Isle's shader tone/lens/rim, and springs for motion. | Largest change, mostly `glass.js` and `overlay.js`. Gives the closest look and the only credible path to Isle-like smoothness. |
| B | Keep the single padded actor and the fixed-duration panel scale; add the richer shader, brightness, and clone caching. | Smaller, lower risk, but the backdrop still zooms during transitions and the glass does not track geometry cleanly. |
| C | Keep everything; map one brightness slider onto the existing shader and blur. | Fastest, but it would not materially improve the look or the smoothness. |

The user picked **A**.

---

## 5. Design

### 5.1 Settings and brightness

**Schema**

- Remove the `glass-mode` enum and the keys `glass-mode`, `glass-opacity`,
  `blur-radius`, and `glass-tint`.
- Add `glass-brightness`: integer, range 0–100, default 50.
  - 0 = dark smoked glass.
  - 100 = clear bright glass.
  - Higher values never mean "more white paint"; they mean "less darkening and more
    of the desktop showing through".
- Keep `animations`.
- Old dconf values for removed keys are ignored. No migration code.

**Preferences**

- Appearance → Glass group:
  - `Brightness` slider, 0–100, with a subtitle that reads `Dark` at the low end and
    `Clear` at the high end.
  - `Animations` switch (unchanged).
- Remove the Mode, Opacity, Blur radius, and Tint rows.
- Update `SETTINGS_KEYS` so Reset restores brightness and animations.

**Live updates**

- `GLASS_KEYS` in the overlay becomes `glass-brightness` and `animations`.
- A brightness change updates the blur radius and the shader uniforms in place. It
  does not change panel geometry, rebuild clones, or restart an animation.

**Brightness mapping**

`glassParams({brightness, dark})` stays a pure function. It blends between two
presets ported from Isle's `LOOKS.glass` and `DARK_GLASS`:

| Parameter | Dark (0) | Clear (100) | Meaning |
|---|---:|---:|---|
| `blurRadius` | 30 | 14 | Backdrop blur, px |
| `fill` alpha | 0.30 | 0.22 | Smoke over the toned backdrop |
| `fill` colour dark scheme | `[0.02, 0.025, 0.03]` | `[0.03, 0.04, 0.05]` | Isle's dark/clear fills |
| `lo` | 0.00 | 0.03 | Black point of the tone band |
| `span` | 0.48 | 0.64 | Tone range |
| `gamma` | 1.0 | 1.0 | Tone curve |
| `deep` | 0.25 | 0.52 | How much bright backdrops are held down |
| `knee` | 0.55 | 0.22 | Where the `deep` hold begins |
| `saturation` | 1.00 | 1.15 | Colour kept through the blur |
| `sheen` | 0.01 | 0.03 | Top-down light |
| `glow` | 0.02 | 0.05 | Light inside the edge |
| `lens` | 8 | 26 | Edge refraction, px |
| `band` | 20 | 24 | Depth of the lens band, px |
| `spread` | 0.30 | 0.70 | Chromatic split at the edge |
| `rim` | 0.15 | 0.50 | Edge catch-light strength |
| `rimWidth` | 1.1 | 1.1 | Edge light falloff, px |

- Blend from clear to dark using Isle's non-linear curves: with
  `tint = 1 - brightness / 100`, `early = sqrt(tint)` and `late = tint²`, so the
  slider only ever greys and settles instead of dipping darker halfway.
- **Early curve:** fill colour, fill alpha, sheen, and glow.
- **Late curve:** blur radius, `lo`, `span`, `gamma`, `deep`, `knee`, `saturation`,
  `lens`, `band`, `spread`, `rim`, and `rimWidth`.
- At brightness 50 (`tint = 0.5`) the late curve is 0.25, so blur is 18 px rather
  than the linear 22 px; the glass stays crisp and gains smoke first, then blur.
- A light system colour scheme uses a light fill palette (so Sift's existing dark
  text stays readable) with the same tone structure. A dark scheme uses the dark
  palette above.
- `GLASS_RADIUS` stays 18.
- `GLASS_PAD` becomes 32 (the maximum blur plus a small margin) and stays fixed while
  the slider moves, so geometry does not churn during a drag.
- `deep`/`knee` hold bright backdrops down even at brightness 100, preserving white
  text contrast over white windows.

### 5.2 Actor tree

```
panel (St.Widget, BinLayout, clip_to_allocation)
├── shape (St.Widget, FixedLayout, clip_to_allocation, mask/tone shader)  panel rect
│   └── frame (St.Widget, clip_to_allocation, Shell.BlurEffect)            rect + 2 × pad
│       └── layers (Clutter.Actor)
│           ├── wallpaper AreaClone
│           ├── window AreaClones (bottom → top, dialogs included)
│           └── top-bar AreaClone
└── content (entry, results, grid, footer…)
```

- `shape` is at 0,0 in the panel and is exactly the panel rect. It carries the mask
  and tone shader. The shader is the outermost glass effect, and it cuts the rounded
  corners.
- `frame` is at `-pad,-pad`, is `rect + 2 × pad`, and carries `Shell.BlurEffect`.
  Because it is larger than the shape, the blur reads the desktop around the panel;
  the parent's clip cuts the result to the shape.
- `layers` holds screen-anchored copies. It is offset by the negative frame origin so
  each clone can be positioned in stage coordinates.
- The panel stays transparent in CSS; the shader paints the fill, tone, and rim.
  Remove the Auto/Frosted/Off classes and the panel border. A single
  `sift-glass-fallback` class is kept for the failure case.
- The old `freeze()`/`thaw()` path and its timer are deleted. Incremental sync is
  cheap enough to run during animation.

### 5.3 Backdrop copies

Port Isle's `AreaClone` and adapt it to Sift:

- `AreaClone` extends `Clutter.Clone`.
  - `paintArea` declares the part of the clone that can be painted, so a change to a
    large window outside the panel does not repaint the glass.
  - Changing the area invalidates the paint volume.
  - Optional mirror bindings follow the source actor's `opacity`, `scale-x`,
    `scale-y`, `pivot-point`, `translation-x`, and `translation-y`.
- `surfaceOf(actor)` copies only the window's `MetaSurface` children. Copying the
  whole window actor would duplicate other extensions' blur (for example Blur my
  Shell) and flicker.
- The copied windows are every visible `MetaWindowActor` that intersects the padded
  frame and is not override-redirect, bottom-first, in the same order as
  `global.get_window_actors()`. Dialogs are included; the earlier "normal windows
  only" limit is removed.
- The wallpaper is `Main.layoutManager._backgroundGroup`. The top bar is
  `Main.panel`, positioned through `Main.layoutManager.panelBox` plus translations.

**Cached places.** A `_places` array stores each window actor with its x, y, width,
and height. It is invalidated by any watched change and rebuilt only on the next
sync. Window actors are watched once via `connectObject` for allocation, visibility,
surface child add/remove, and destroy.

**Coalesced sync.** These signals only queue one `Meta.LaterType.BEFORE_REDRAW`
callback:

- `global.window_group` child-added/removed
- `global.display` restacked
- `Main.layoutManager.panelBox` allocation/mapped/translation-y
- `Main.panel` allocation

The callback calls `_syncWindows()` once, however many changes arrived.

**`_syncWindows()`**

1. Read the cached places and filter those intersecting the current padded frame.
2. Destroy clones whose windows are no longer under the panel.
3. Recreate a clone only if its source surface changed (for example an X11 window
   going fullscreen).
4. Create clones for newly covered windows and connect their watchers.
5. Reorder the layer children: wallpaper, windows bottom-to-top, top bar last.
6. Call `_placeCopies()`.

**`_placeCopies()`**

- Set the layers offset to `-frameRect.x, -frameRect.y`.
- Wallpaper at stage 0,0.
- Each window at `actor.x + surface.x * scale`, `actor.y + surface.y * scale`; size
  the clone by the surface size times the window actor's scale (HiDPI).
- Top bar at `panelBox.x + translation-x + Main.panel.x`, and likewise for y.
- Set each clone's `paintArea` to the padded frame in clone-local coordinates.

**Geometry changes.** `setRect(rect)` updates the shape size, frame size/position,
shader width/height, and then re-filters and re-places the existing copies. It never
destroys and recreates the whole backdrop for a move or resize. This is what lets the
glass track a spring frame-by-frame.

**Spring sync area.** While a geometry spring runs, the clone set is filtered against
the union of the start and target padded frames, not the current frame. Windows that
will enter the glass are copied before the edge reaches them, so no clone is created
or destroyed mid-animation and there is no pop-in at the moving edge. Each clone's
`paintArea` still tracks the current frame. At rest, `setRect` prunes the set to the
final frame. Close clears the union set as usual.

**Close.** Destroy clones, clear the map and watchers, remove the before-redraw
callback, hide the glass.

### 5.4 Shader

Adapt Isle's rounded-rectangle subset. The shader stays in `glass.js`; no separate
shader module.

**Helpers**

- `siftInner(p)`: signed distance inside the rounded rectangle, with `radius` already
  clamped to half the shorter side.
- `siftNormal(p)`: finite-difference normal near the edge.
- `effectPoint(size)`: `uv * (size + 3) - 2`, correcting Clutter's enlarged texture.

**Fragment passes, in order**

1. Compute `p` from the corrected UV and the shape size.
2. Compute the body coverage from the SDF; keep one-pixel antialiasing.
3. If `lens > 0`, inside a `band`-wide edge region:
   - compute the inward normal;
   - shift UV inward by `lens * (1 - edgeIn / band)²`;
   - sample `cogl_sampler0` three times, offset by the chromatic `spread`;
   - use that as the glass colour.
4. Unpremultiply the colour with its alpha.
5. Tone-map:
   `lo + span * luma^gamma * (1 - deep * smoothstep(knee, 1, luma))`, then apply
   saturation to the colour difference.
6. Add `sheen` from the top, `glow` inside the edge, and the directional rim:
   brightest where the edge faces up-left, dimmer down-right, with two exponential
   falloffs across `rimWidth`.
7. Mix in the fill colour by its alpha.
8. Clamp, re-premultiply, and multiply by body coverage.
9. Preserve `cogl_color_in`'s alpha so the panel's open/close opacity fades the glass
   as well as the content.

**Uniforms:** `width`, `height`, `radius`, `fill` (vec4), `saturation`, `lo`, `span`,
`gamma`, `deep`, `knee`, `sheen`, `glow`, `reach`, `lens`, `band`, `spread`, `rim`,
`rimWidth`.

**Repaints:** uniforms are compared before being set; only a change queues a repaint.
The lens samples run only inside the edge band. If the shader cannot be created, log
once and use `sift-glass-fallback`; do not expose a mode.

### 5.5 Motion

**Spring engine**

- Port Isle's `Spring` as pure math in `extension/src/lib/spring.js`:
  - value, target, velocity, config `{stiffness, damping}`;
  - `setTarget` keeps velocity;
  - `reset` jumps;
  - `step(dt)` integrates in 1/240 s substeps, clamps dt to 0.25 s;
  - settled at 0.25 px and 2 px/s;
  - `settled` getter.
- `SpringDriver` in a shell-only module:
  - a looping `Clutter.Timeline` tied to the panel actor;
  - real monotonic dt per frame;
  - calls `onFrame` after stepping;
  - stops and frees the timeline when every spring settles;
  - no timeline while idle.

Configs (tunable after visual review):

- `MOVE = {stiffness: 180, damping: 22}` for panel y and view geometry.
- `FADE = {stiffness: 420, damping: 38}` for opacity and content fades.

**Open**

- The panel's final rect and view are set while hidden. Nothing reflows during the
  animation.
- `glass.open()` builds the backdrop once at the final rect.
- Show the panel at `y + 12` and opacity 0, with the glass at that shifted rect.
- Springs drive y → rect.y and opacity → 255. The glass tracks each frame; because
  the copies are screen-anchored, the panel slides over the desktop instead of
  zooming the desktop.
- Content is part of the panel opacity, so it fades in with the glass.

**Close**

- Springs drive y → rect.y + 8 and opacity → 0.
- Keep the modal grab and ignore input while closing; when the springs settle, hide
  the overlay, call `glass.close()`, clear the old view content, and emit `closed`.
- `SiftOverlay` gains a distinct `closing` state and a `closing` getter. `close()`
  is a no-op while closing. `open()` while closing cancels the close, keeps the
  existing grab, and retargets the springs.
- `OverviewBlocker.toggle()` and `toggleApps()` check `closing`: a second Super
  reopens search, and a second Super+A reopens the grid, instead of treating the
  still-visible fading overlay as already open. This is a small change to
  `overview.js`; it changes close/reopen behavior, not the keybindings.
- **Snap close.** Result activation and monitor changes use `close({immediate: true})`:
  no spring, pop the grab before the launched app or file needs focus, hide at once.
  Typing in a just-launched terminal must not wait for a fade.
- With animations off, close immediately as today.

**Compact ↔ expanded search**

- The compact bar (60 px) on open, the expanded search rect on the first keystroke,
  and the collapse on an emptied query all use the `MOVE` springs instead of jumping.
- Results update immediately; the panel clip reveals them as it grows.
- Changes to `search-height` use the same path while open. `max-results` does not
  change the panel rect today and does not start doing so: it only changes how many
  rows fit before the list scrolls, so result-count changes never retrigger geometry.

**View switch (search ↔ grid)**

- The geometry spring starts immediately on the toggle; the panel does not hold at
  the old rect first.
- The outgoing content fades to 0 over roughly 80 ms while the panel starts moving.
  At the end of that fade the new view state is set, but its content stays invisible.
- The single content layer is allocated at the current panel size each frame. Only
  the outgoing view can reflow during its short fade; the incoming view is invisible
  and held, so text and tiles never re-wrap through the whole morph.
- When the geometry spring reaches roughly the last fifth of its travel, the incoming
  view is shown and fades in over about 120 ms while the spring settles.
- For an incoming grid, `AppGrid` gets a layout hold: allocation notifications during
  the morph are ignored, and `open()` runs once when the grid is shown, at the final
  or near-final size. This avoids frame-by-frame `IconGrid` re-pagination, the main
  risk to 60 fps. The outgoing grid is also held while it fades, for the same reason.
- The middle of the morph shows empty glass over the desktop. That is the intended
  "the window grows over the desktop" moment, not a loading state.
- The glass follows every frame through `setRect`; its copies are re-filtered against
  the union area and re-placed, never destroyed and rebuilt.

**Animations off**

- If the `animations` setting is false or the shell's
  `enable-animations` is false, every transition snaps to the final state and no
  spring timeline is created.

**App grid pages**

- Page scrolling keeps its existing animated `IconGrid` step. It is not changed by
  this design.

### 5.6 Failures

- Shader creation failure → CSS fallback panel, log once.
- Blur effect failure → CSS fallback panel, log once.
- Clone failure → keep whatever copies work (wallpaper/bar), log once; never crash
  the overlay.
- No user-facing "frosted" or "off" state. Liquid is the only style.

### 5.7 Files to touch

- `extension/src/glass.js` — actor tree, AreaClone, sync/caching, shader, brightness.
- `extension/src/overlay.js` — springs, open/close, compact expansion, view switch,
  closing state, remove freeze/thaw, close deferral.
- `extension/src/overview.js` — reopen from the closing state in toggle/toggleApps.
- `extension/src/appGrid.js` — layout hold while hidden during a view morph.
- `extension/src/lib/glassParams.js` — presets, brightness mapping, pad/radius.
- `extension/src/lib/spring.js` — pure spring math.
- `extension/src/motion.js` — SpringDriver (new).
- `extension/src/lib/windowStack.js` — window place filtering, all non-override
  windows, intersects.
- `extension/prefs.js` — brightness row, remove mode/opacity/blur/tint.
- `extension/schemas/org.gnome.shell.extensions.sift.gschema.xml` — replace keys.
- `extension/stylesheet.css` — remove mode classes and border; fallback style.
- Unit tests: `glassParams`, `spring`, `windowStack`, `schema`.
- `tools/test/headless.js` — remove mode/off assertions; brightness live, clone
  count, open/view/close with animations on and off, a second toggle while closing
  reopens, and activation closes immediately.

### 5.8 Verification

Automated, in this order:

- `make lint`
- `make test-gjs` (including the new spring and brightness tests)
- `make test-schema`
- `make test-shell` (headless shell smoke, actor tree, live brightness, view switch)
- `make install`
- Reload the extension and check the journal for Sift errors.

Human, on the real session (the only valid judge of look and frame rate):

- Search opens compact, then expands smoothly on the first keystroke and collapses
  when cleared.
- Search ↔ grid grows/shrinks without stretching text or icons.
- Close fades/slides out; reopening during close is smooth.
- Brightness 0, 50, and 100 all look intentional; white text stays readable over a
  white window at 100.
- Overlapping windows and a dialog behind the panel appear in the right order.
- Moving a window while Sift is open updates the backdrop.
- Open, typing, view switches, and close feel like constant 60 fps at 1.25 scale.
- Light and dark system themes both look right.

If the real session misses 60 fps, the first lever is the fixed blur radius/pad and the
lens band, not a new user-facing mode. The user will verify this; the headless suite
cannot measure frame rate.

---

## 6. Calls made by the builder

These are implementation decisions, not things the user agreed to:

- Brightness is stored as an integer 0–100, default 50, displayed as a number.
- Blur radius is tied to brightness (30 dark → 14 clear) and pad is fixed at 32.
- Dark glass keeps a mild lens/rim (8 px / 0.15) instead of Isle's fully flat dark
  preset, so every brightness still reads as liquid.
- Dialogs and other non-override windows are included in the backdrop.
- The top bar is copied through `Main.panel` to avoid duplicating Blur my Shell.
- Open/close move the real panel by 8–12 px and fade it, rather than scaling it; view
  switches use full geometry springs.
- View switches fade the outgoing content out, morph with empty glass, then fade the
  incoming content in near the end; there is one content layer and no snapshot.
- The app grid waits until the panel is near its final size before it is laid out,
  with its layout held while hidden.
- A second Super or Super+A during the close fade reopens the requested view; result
  activation and monitor changes snap-close so the launched app gets focus at once.
- Close keeps the modal grab until the fade finishes, except for snap-close paths.
- During a geometry spring the clone set covers the union of the start and target
  frames, so nothing is created or destroyed mid-morph.
- Brightness uses the early curve for fill/sheen/glow and the late curve for blur and
  the tone/lens/rim parameters.
- Light scheme uses a light fill palette with the same tone structure.
- No settings migration, no new preference beyond brightness, no fallback mode.

## 7. Left to the builder

- Exact preset numbers and spring stiffness/damping after visual tuning.
- The exact fraction of the geometry spring at which the incoming view fades in.
- File/class layout for `SpringDriver` and the AreaClone class.
- Test details and headless assertions.
- How to express the long shader cleanly within the existing `glass.js` conventions.

## 8. Risks

- A large grid panel at 1.25 scale with a 30 px blur may still miss 60 fps on this
  hardware. The bounded frame, cached clones, paint volumes, and edge-only lens help;
  the fallback is a smaller blur/pad, not a user-visible mode.
- Deferring the grid layout until the end of the morph means the middle of a view
  switch shows empty glass. On slow machines that could feel slower than the current
  instant-but-broken layout; the user must judge it in motion.
- The union clone set keeps a few extra windows copied during a large morph. The cost
  is bounded by the union area and disappears at rest.
- Spring tuning is subjective; the first numbers are a starting point.
- High brightness with light text over a white window depends on the `deep`/`knee`
  tone hold; this needs visual checking.
- The wallpaper uses the private `Main.layoutManager._backgroundGroup`, as Isle does.
  This is acceptable on Shell 51 but is a shell-internal dependency.
- Removing the old settings keys resets those values. There are no public users yet.
